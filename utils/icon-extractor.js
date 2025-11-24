// utils/icon-extractor.js
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ws = require('windows-shortcuts');

let ICON_CACHE_DIR;
const MAX_CACHE_SIZE = 100 * 1024 * 1024;

function initIconCache() {
    if (!ICON_CACHE_DIR) {
        ICON_CACHE_DIR = path.join(app.getPath('userData'), 'icon-cache');
        if (!fs.existsSync(ICON_CACHE_DIR)) {
            fs.mkdirSync(ICON_CACHE_DIR, { recursive: true });
        }
    }
}

function generateCacheHash(filePath) {
    try {
        const stats = fs.statSync(filePath);
        const key = `${filePath}-${stats.mtimeMs}`;
        return Buffer.from(key).toString('base64')
            .replace(/[/+=]/g, '')
            .substring(0, 32);
    } catch (error) {
        return Buffer.from(filePath).toString('base64')
            .replace(/[/+=]/g, '')
            .substring(0, 32);
    }
}

function getCacheSizeBytes() {
    try {
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

function manageCacheSize() {
    try {
        if (getCacheSizeBytes() > MAX_CACHE_SIZE) {
            const files = fs.readdirSync(ICON_CACHE_DIR);
            const fileStats = files.map(file => {
                const filePath = path.join(ICON_CACHE_DIR, file);
                return {
                    path: filePath,
                    time: fs.statSync(filePath).mtime.getTime()
                };
            }).sort((a, b) => a.time - b.time);

            for (const file of fileStats) {
                if (getCacheSizeBytes() > MAX_CACHE_SIZE * 0.8) {
                    fs.unlinkSync(file.path);
                } else {
                    break;
                }
            }
        }
    } catch (error) {
        console.error('Error managing cache size:', error.message);
    }
}

/**
 * Resuelve un .lnk a su ruta real
 */
function resolveLnk(lnkPath) {
    return new Promise((resolve) => {
        try {
            ws.query(lnkPath, (error, options) => {
                if (error || !options) {
                    resolve(null);
                    return;
                }

                let targetPath = options.target || '';

                // Expandir variables de entorno
                targetPath = targetPath.replace(/%([^%]+)%/g, (_, varName) => {
                    return process.env[varName] || `%${varName}%`;
                });

                targetPath = path.normalize(targetPath);

                if (fs.existsSync(targetPath)) {
                    resolve(targetPath);
                    return;
                }

                // Si no existe el target, devolver null
                resolve(null);
            });
        } catch (error) {
            console.error(`Error resolving .lnk: ${error.message}`);
            resolve(null);
        }
    });
}

/**
 * Extrae icono usando PowerShell con mejor manejo
 */
function extractIconPowerShell(filePath) {
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
async function extractIconElectron(filePath) {
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
function findAppExecutable(appPath) {
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
async function extractFromLnkProperties(lnkPath) {
    return new Promise((resolve) => {
        try {
            ws.query(lnkPath, (error, options) => {
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
                    iconPath = iconPath.replace(/%([^%]+)%/g, (_, varName) => {
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
async function extractIcon(filePath) {
    if (!filePath || typeof filePath !== 'string') return null;

    try {
        initIconCache();

        let targetPath = path.normalize(filePath);

        console.log(`🔍 Procesando: ${path.basename(targetPath)}`);

        // Si es .lnk, resolverlo
        if (targetPath.toLowerCase().endsWith('.lnk')) {
            // Primero intentar obtener el icono del .lnk
            let iconFromLnk = await extractFromLnkProperties(targetPath);
            
            if (!iconFromLnk) {
                // Si no hay icono, resolver al ejecutable
                const resolved = await resolveLnk(targetPath);
                if (resolved) {
                    iconFromLnk = resolved;
                } else {
                    console.warn(`⚠️ No se pudo resolver: ${path.basename(targetPath)}`);
                    return null;
                }
            }

            targetPath = path.normalize(iconFromLnk);
        }

        if (!fs.existsSync(targetPath)) {
            console.warn(`⚠️ Archivo no existe: ${targetPath}`);
            return null;
        }

        // Si es un directorio, buscar el ejecutable
        if (fs.statSync(targetPath).isDirectory()) {
            targetPath = findAppExecutable(targetPath);
        }

        if (!fs.existsSync(targetPath)) {
            console.warn(`⚠️ No se encontró ejecutable en: ${targetPath}`);
            return null;
        }

        const hash = generateCacheHash(targetPath);
        const cacheFile = path.join(ICON_CACHE_DIR, `${hash}.png`);

        // Verificar caché
        if (fs.existsSync(cacheFile)) {
            try {
                const iconData = fs.readFileSync(cacheFile);
                return `data:image/png;base64,${iconData.toString('base64')}`;
            } catch (error) {
                fs.unlinkSync(cacheFile);
            }
        }

        let pngBuffer = null;

        // Método 1: PowerShell (mejor para extraer iconos reales)
        console.log(`  → Intentando PowerShell...`);
        pngBuffer = await extractIconPowerShell(targetPath);

        // Método 2: Electron (respaldo)
        if (!pngBuffer) {
            console.log(`  → Intentando Electron API...`);
            pngBuffer = await extractIconElectron(targetPath);
        }

        if (!pngBuffer || pngBuffer.length === 0) {
            console.warn(`⚠️ No se pudo extraer icono: ${path.basename(targetPath)}`);
            return null;
        }

        // Validar PNG
        if (!pngBuffer.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]))) {
            console.warn(`⚠️ No es PNG válido: ${path.basename(targetPath)}`);
            return null;
        }

        console.log(`  ✅ Icono extraído correctamente`);

        // Cachear
        try {
            fs.writeFileSync(cacheFile, pngBuffer);
            manageCacheSize();
        } catch (error) {
            console.error(`Error caching: ${error.message}`);
        }

        return `data:image/png;base64,${pngBuffer.toString('base64')}`;
    } catch (error) {
        console.error(`❌ Error: ${path.basename(filePath)} - ${error.message}`);
        return null;
    }
}

function clearIconCache() {
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
    } catch (error) {
        console.error('Error clearing cache:', error.message);
    }
}

function getCacheInfo() {
    try {
        initIconCache();
        const files = fs.readdirSync(ICON_CACHE_DIR);
        const sizeBytes = getCacheSizeBytes();

        return {
            fileCount: files.length,
            sizeBytes,
            sizeMB: (sizeBytes / (1024 * 1024)).toFixed(2),
            cacheDir: ICON_CACHE_DIR
        };
    } catch (error) {
        return null;
    }
}

module.exports = {
    extractIcon,
    clearIconCache,
    getCacheInfo,
    initIconCache
};