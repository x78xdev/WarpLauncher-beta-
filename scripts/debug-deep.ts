import { shortcutResolver } from '../utils/shortcut-resolver';
import { getIconCacheManager } from '../utils/icon-cache-manager';
import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';

async function deepDebug() {
    console.log('🕵️‍♂️ Iniciando Diagnóstico Profundo de Iconos...');

    const cacheManager = getIconCacheManager();
    // Acceder a método público
    const generateHash = cacheManager.generateHash.bind(cacheManager);

    const programData = 'C:/ProgramData/Microsoft/Windows/Start Menu/Programs';

    // Archivos sospechosos de colisión
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

    console.log(`\n📂 Analizando ${files.length} archivos:\n`);

    for (const file of files) {
        console.log(`📄 Archivo: ${path.basename(file)}`);
        console.log(`   Path: ${file}`);

        // 1. Verificar Hash de Caché
        const hash = generateHash(file);
        console.log(`   🔑 Cache Hash (Original): ${hash}`);

        // 2. Verificar Resolución de Target
        const start = Date.now();
        const resolved = await shortcutResolver.resolve(file);
        console.log(`   🎯 Target Resuelto: ${resolved || 'NULL'} (${Date.now() - start}ms)`);

        if (resolved) {
            const targetHash = generateHash(resolved);
            console.log(`   🔑 Cache Hash (Target):   ${targetHash}`);

            if (resolved.toLowerCase().endsWith('installer.exe') || resolved.toLowerCase().includes('msiexec')) {
                console.warn('   ⚠️ ALERTA: El target parece ser un instalador genérico.');
            }
        }

        console.log('---');
    }
}

deepDebug();
