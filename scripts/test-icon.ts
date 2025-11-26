import { shortcutResolver } from '../utils/shortcut-resolver';
import { extractIcon } from '../utils/icon-extractor';
import * as path from 'path';
import * as fs from 'fs';

async function testIcon(shortcutPath: string) {
    console.log(`🔍 Probando: "${shortcutPath}"`);

    if (!fs.existsSync(shortcutPath)) {
        console.error('❌ El archivo no existe.');
        return;
    }

    // 1. Probar Resolución
    console.log('\n--- 1. Resolución de Shortcut ---');
    const start = Date.now();
    const resolved = await shortcutResolver.resolve(shortcutPath);
    const duration = Date.now() - start;

    if (resolved) {
        console.log(`✅ Resuelto en ${duration}ms`);
        console.log(`   Target: "${resolved}"`);
    } else {
        console.error(`❌ Falló la resolución.`);
    }

    // 2. Probar Extracción (usando el extractor actual, que luego actualizaremos)
    console.log('\n--- 2. Extracción de Icono ---');
    try {
        const iconStart = Date.now();
        const icon = await extractIcon(shortcutPath);
        const iconDuration = Date.now() - iconStart;

        if (icon) {
            console.log(`✅ Icono extraído en ${iconDuration}ms`);
            console.log(`   Longitud dataURL: ${icon.length} chars`);
            console.log(`   Preview: ${icon.substring(0, 50)}...`);
        } else {
            console.error('❌ Falló la extracción de icono.');
        }
    } catch (error) {
        console.error('❌ Error fatal en extracción:', error);
    }
}

// Tomar argumento de línea de comandos
const target = process.argv[2];
if (target) {
    testIcon(target);
} else {
    console.log('Uso: npm run test-icon "C:\\path\\to\\shortcut.lnk"');
    // Prueba default si no hay argumentos
    const defaultTest = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Visual Studio Code.lnk');
    if (fs.existsSync(defaultTest)) {
        testIcon(defaultTest);
    }
}
