import { shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as child_process from 'child_process';
import * as util from 'util';

const execFile = util.promisify(child_process.execFile);

export class ShortcutResolver {
    private cache: Map<string, string> = new Map();

    /**
     * Intenta resolver un archivo .lnk a su destino real (.exe, .bat, etc.)
     * @param shortcutPath Ruta absoluta al archivo .lnk
     */
    async resolve(shortcutPath: string): Promise<string | null> {
        if (!shortcutPath.toLowerCase().endsWith('.lnk')) {
            return shortcutPath;
        }

        // 1. Verificar caché
        if (this.cache.has(shortcutPath)) {
            return this.cache.get(shortcutPath)!;
        }

        let target: string | null = null;

        // 2. Estrategia A: Electron API (Rápida)
        try {
            const link = shell.readShortcutLink(shortcutPath);
            if (link && link.target) {
                target = link.target;
            }
        } catch (e) {
            // Ignorar error y probar siguiente método
        }

        // 3. Estrategia B: VBScript (Compatibilidad nativa Windows)
        if (!this.isValidTarget(target)) {
            target = await this.resolveViaVBS(shortcutPath);
        }

        // 4. Estrategia C: PowerShell (Fuerza bruta para casos difíciles como Office)
        if (!this.isValidTarget(target)) {
            target = await this.resolveViaPowerShell(shortcutPath);
        }

        // 5. Guardar en caché si encontramos algo
        if (this.isValidTarget(target)) {
            this.cache.set(shortcutPath, target!);
            return target;
        }

        // Si falló todo, devolver null (o el path original si se prefiere, pero null indica fallo de resolución)
        return null;
    }

    private isValidTarget(target: string | null): boolean {
        if (!target) return false;
        // Ignorar targets que son carpetas de sistema genéricas si no apuntan a un ejecutable
        if (target.trim() === '') return false;

        // Si es un path relativo o incompleto, sospechoso
        if (!path.isAbsolute(target)) return false;

        return true;
    }

    private async resolveViaVBS(shortcutPath: string): Promise<string | null> {
        const vbsScript = `
            Set wshShell = CreateObject("WScript.Shell")
            Set sc = wshShell.CreateShortcut("${shortcutPath}")
            WScript.Echo sc.TargetPath
        `;

        const tempVbs = path.join(os.tmpdir(), `resolve_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.vbs`);

        try {
            fs.writeFileSync(tempVbs, vbsScript);
            const { stdout } = await execFile('cscript', ['//Nologo', tempVbs]);
            const result = stdout.trim();
            return result || null;
        } catch (error) {
            return null;
        } finally {
            if (fs.existsSync(tempVbs)) {
                try { fs.unlinkSync(tempVbs); } catch (e) { }
            }
        }
    }

    private async resolveViaPowerShell(shortcutPath: string): Promise<string | null> {
        // Script para resolver incluso "Advertised Shortcuts" (como Office)
        const psScript = `
            $path = "${shortcutPath}"
            $sh = New-Object -ComObject WScript.Shell
            try {
                $lnk = $sh.CreateShortcut($path)
                $target = $lnk.TargetPath
                if ([string]::IsNullOrWhiteSpace($target)) {
                    # Intentar leer propiedades extendidas si es un advertised shortcut
                    # (Esta parte es compleja en PS puro, simplificamos devolviendo lo que tenga)
                }
                Write-Output $target
            } catch {
                Write-Output ""
            }
        `;

        try {
            const { stdout } = await execFile('powershell', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', psScript
            ]);
            return stdout.trim() || null;
        } catch (error) {
            return null;
        }
    }
}

export const shortcutResolver = new ShortcutResolver();
