import { shortcutResolver } from './shortcut-resolver';
import { getIconCacheManager } from './icon-cache-manager';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import fg from 'fast-glob';

export async function runDeepDebug() {
    const logPath = path.join(process.cwd(), 'debug-output.txt');
    const log = (msg: string) => fs.appendFileSync(logPath, msg + '\n');

    fs.writeFileSync(logPath, `--- INICIO DIAGNÓSTICO ${new Date().toISOString()} ---\n`);
    log('Iniciando análisis de colisiones...');

    try {
        const cacheManager = getIconCacheManager();
        const programData = 'C:/ProgramData/Microsoft/Windows/Start Menu/Programs';

        const patterns = [
            '**/Steam.lnk',
            '**/Access.lnk',
            '**/AMD*.lnk',
            '**/Node.js.lnk'
        ];

        const files = await fg(patterns, {
            cwd: programData,
            absolute: true,
            caseSensitiveMatch: false
        });

        log(`Encontrados ${files.length} archivos.`);

        for (const file of files) {
            log(`\n📄 Archivo: ${path.basename(file)}`);
            log(`   Path: ${file}`);

            // 1. Verificar Hash
            const hash = cacheManager.generateHash(file);
            log(`   🔑 Hash (Original): ${hash}`);

            // 2. Resolver Target
            const start = Date.now();
            const resolved = await shortcutResolver.resolve(file);
            log(`   🎯 Target: ${resolved || 'NULL'} (${Date.now() - start}ms)`);

            if (resolved) {
                const targetHash = cacheManager.generateHash(resolved);
                log(`   🔑 Hash (Target):   ${targetHash}`);
            }
        }
        log('\n--- FIN DIAGNÓSTICO ---');
    } catch (error: any) {
        log(`\n❌ ERROR FATAL: ${error.message}\n${error.stack}`);
    }
}
