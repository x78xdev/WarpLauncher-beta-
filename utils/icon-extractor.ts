import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as ws from 'windows-shortcuts';
import { IconCacheInfo } from '../types';
import { getIconCacheManager } from './icon-cache-manager';
import { shortcutResolver } from './shortcut-resolver';

let ICON_CACHE_DIR: string;
const MAX_CACHE_SIZE = 100 * 1024 * 1024;

export function initIconCache(): void {
    if (!ICON_CACHE_DIR) {
        ICON_CACHE_DIR = path.join(app.getPath('userData'), 'icon-cache');
        if (!fs.existsSync(ICON_CACHE_DIR)) {
            fs.mkdirSync(ICON_CACHE_DIR, { recursive: true });
        }
    }
}

function getCacheSizeBytes(): number {
    try {
        if (!ICON_CACHE_DIR) return 0;
        const files = fs.readdirSync(ICON_CACHE_DIR);
        return files.reduce((total, file) => {
            const filePath = path.join(ICON_CACHE_DIR, file);
            const stats = fs.statSync(filePath);
            return total + stats.size;
        }, 0);
    } catch (error) {
        return 0;
    }
}

/**
 * Extrae icono usando PowerShell con mejor manejo
 */
function extractIconPowerShell(filePath: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
        try {
            // Escapar comillas en la ruta
            const escapedPath = filePath.replace(/'/g, "''");

            const script = `
                Add-Type -AssemblyName System.Drawing
                try {
                    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${escapedPath}')
                    if ($icon -and $icon.Handle -ne 0) {
                        $tempFile = [System.IO.Path]::GetTempFileName() + '.png'
                        $bitmap = $icon.ToBitmap()
                        $bitmap.Save($tempFile, [System.Drawing.Imaging.ImageFormat]::Png)
                        Write-Host $tempFile
                        $bitmap.Dispose()
                        $icon.Dispose()
                    }
                } catch {
                    # Silenciar errores
                }
            `;

            const result = execSync(
                `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`,
                { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
            ).trim();

            if (result && fs.existsSync(result)) {
                try {
                    const iconData = fs.readFileSync(result);
                    fs.unlinkSync(result);
                    resolve(iconData);
                } catch (error) {
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        } catch (error) {
            resolve(null);
        }
    });
}

/**
 * Extrae icono usando Electron API
 */
async function extractIconElectron(filePath: string): Promise<Buffer | null> {
    try {
        if (!app.isReady()) {
            await app.whenReady();
        }

        const icon = await app.getFileIcon(filePath, {
            size: 'large'
        });

        if (!icon || icon.isEmpty()) {
            return null;
        }

        const png = icon.toPNG();
        return png && png.length > 0 ? png : null;
    } catch (error) {
        return null;
    }
}

/**
 * Obtiene la ruta del ejecutable principal de la aplicación
 */
function findAppExecutable(appPath: string): string {
    try {
        // Si es .exe o .dll, devolverlo
        if (appPath.toLowerCase().endsWith('.exe') || appPath.toLowerCase().endsWith('.dll')) {
            if (fs.existsSync(appPath)) {
                return appPath;
            }
        }

        // Si es un directorio, buscar el ejecutable principal
        if (fs.statSync(appPath).isDirectory()) {
            const appName = path.basename(appPath);
            const exePath = path.join(appPath, `${appName}.exe`);

            if (fs.existsSync(exePath)) {
                return exePath;
            }

            // Buscar cualquier .exe en el directorio
            const files = fs.readdirSync(appPath);
            const exeFile = files.find(f => f.toLowerCase().endsWith('.exe'));
            if (exeFile) {
                return path.join(appPath, exeFile);
            }
        }
    } catch (error) {
        // No hacer nada
    }

    return appPath;
}

/**
 * Extrae información del icono del archivo .lnk
 */
async function extractFromLnkProperties(lnkPath: string): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            ws.query(lnkPath, (error: Error | null, options?: any) => {
                if (error || !options) {
                    resolve(null);
                    return;
                }

                // Buscar icono especificado en el .lnk
                if (options.icon) {
                    let iconPath = options.icon;

                    // El icono puede venir con índice: "C:\path\file.exe,0"
                    if (iconPath.includes(',')) {
                        iconPath = iconPath.split(',')[0];
                    }

                    iconPath = path.normalize(iconPath);

                    // Expandir variables de entorno
                    iconPath = iconPath.replace(/%([^%]+)%/g, (_: string, varName: string) => {
                        return process.env[varName] || `%${varName}%`;
                    });

                    if (fs.existsSync(iconPath)) {
                        resolve(iconPath);
                        return;
                    }
                }

                // Si no hay icono definido, devolver null
                resolve(null);
            });
        } catch (error) {
            resolve(null);
        }
    });
}

/**
 * Extrae el icono de un archivo
 */
export async function extractIcon(filePath: string): Promise<string | null> {
    if (!filePath || typeof filePath !== 'string') return null;

    try {
        const cacheManager = getIconCacheManager();

        // 1. Verificar caché con el path original (más rápido)
        const cached = await cacheManager.get(filePath);
        if (cached) {
            return cached;
        }

        let targetPath = path.normalize(filePath);
        // console.log(`🔍 Procesando: ${path.basename(targetPath)}`);

        // 2. Resolver el destino real si es un .lnk
        // 2. Resolver el destino real si es un .lnk
        if (targetPath.toLowerCase().endsWith('.lnk')) {
            // Primero intentar obtener el icono del .lnk (propiedad iconLocation)
            const iconFromLnk = await extractFromLnkProperties(targetPath);

            if (iconFromLnk && fs.existsSync(iconFromLnk)) {
                targetPath = iconFromLnk;
            } else {
                // Si no tiene icono explícito, resolver el target real
                const resolved = await shortcutResolver.resolve(targetPath);
                if (resolved) {
                    targetPath = resolved;
                }
            }
        }

        // Asegurar que apuntamos al ejecutable si es un directorio (o si el target resuelto es un directorio)
        targetPath = findAppExecutable(targetPath);

        let pngBuffer: Buffer | null = null;

        // 3. Estrategia de Extracción por Niveles

        // Nivel 1: Electron API sobre el target (Rápido y generalmente bueno)
        try {
            pngBuffer = await extractIconElectron(targetPath);
        } catch (e) { /* Ignorar y seguir */ }

        // Nivel 2: PowerShell sobre el target (Más robusto para ciertos EXEs)
        if (!pngBuffer || pngBuffer.length === 0) {
            try {
                pngBuffer = await extractIconPowerShell(targetPath);
            } catch (e) { /* Ignorar */ }
        }

        // Nivel 3: Si falló con el target, intentar con el archivo original (.lnk)
        // A veces Electron saca mejor el icono del .lnk que del .exe destino
        if ((!pngBuffer || pngBuffer.length === 0) && targetPath !== filePath) {
            try {
                pngBuffer = await extractIconElectron(filePath);
            } catch (e) { /* Ignorar */ }

            if (!pngBuffer) {
                try {
                    pngBuffer = await extractIconPowerShell(filePath);
                } catch (e) { /* Ignorar */ }
            }
        }

        // 4. Guardar y retornar
        if (pngBuffer && pngBuffer.length > 0) {
            // Validar PNG
            if (pngBuffer.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]))) {
                // Guardar asociado al path original Y al target
                const iconDataUrl = await cacheManager.set(filePath, pngBuffer);
                if (targetPath !== filePath && fs.existsSync(targetPath)) {
                    await cacheManager.set(targetPath, pngBuffer);
                }
                // console.log(`  ✅ Icono extraído correctamente`);
                return iconDataUrl;
            }
        }

        console.warn(`❌ No se pudo extraer icono para: ${path.basename(filePath)}`);
        return null;

    } catch (error: any) {
        console.error(`❌ Error: ${path.basename(filePath)} - ${error.message}`);
        return null;
    }
}

export function clearIconCache(): void {
    try {
        initIconCache();
        if (fs.existsSync(ICON_CACHE_DIR)) {
            const files = fs.readdirSync(ICON_CACHE_DIR);
            files.forEach(file => {
                try {
                    fs.unlinkSync(path.join(ICON_CACHE_DIR, file));
                } catch (error) {
                    console.error(`Error deleting: ${file}`);
                }
            });
            console.log('✅ Cache cleared');
        }
    } catch (error: any) {
        console.error('Error clearing cache:', error.message);
    }
}

export function getCacheInfo(): IconCacheInfo | null {
    try {
        initIconCache();
        const files = fs.readdirSync(ICON_CACHE_DIR);
        const sizeBytes = getCacheSizeBytes();

        return {
            totalFiles: files.length,
            totalSize: sizeBytes,
            formattedSize: (sizeBytes / (1024 * 1024)).toFixed(2) + ' MB',
            cacheDir: ICON_CACHE_DIR
        };
    } catch (error) {
        return null;
    }
}
