import { extractIcon, clearIconCache } from '../utils/icon-extractor';
import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';

async function debugCollision() {
    console.log('--- Iniciando prueba de colisión (Mejorada) ---');

    // Limpiar caché para forzar extracción
    clearIconCache();
    console.log('🧹 Caché limpiado.');

    const programData = 'C:/ProgramData/Microsoft/Windows/Start Menu/Programs';

    // Buscar archivos reales
    const patterns = [
        '**/Steam.lnk',
        '**/Access.lnk',
        '**/AMD*.lnk'
    ];

    const files = await fg(patterns, {
        cwd: programData,
        absolute: true,
        caseSensitiveMatch: false
    });

    console.log(`📂 Encontrados ${files.length} archivos para probar:`);
    files.forEach(f => console.log(` - ${path.basename(f)}`));

    if (files.length < 2) {
        console.error('❌ Necesitamos al menos 2 archivos para probar colisión.');
        return;
    }

    // 1. Prueba Secuencial
    console.log('\n--- 1. Prueba Secuencial ---');
    for (const p of files) {
        const start = Date.now();
        const icon = await extractIcon(p);
        const hash = icon ? icon.substring(icon.length - 32) : 'null';
        console.log(`File: ${path.basename(p)}`);
        console.log(`  Hash: ${hash}`);
        console.log(`  Time: ${Date.now() - start}ms`);
    }

    // Limpiar caché de nuevo
    clearIconCache();

    // 2. Prueba Paralela
    console.log('\n--- 2. Prueba Paralela ---');
    const promises = files.map(async (p) => {
        const start = Date.now();
        const icon = await extractIcon(p);
        const hash = icon ? icon.substring(icon.length - 32) : 'null';
        console.log(`[Parallel] File: ${path.basename(p)} -> Hash: ${hash} (${Date.now() - start}ms)`);
        return { file: path.basename(p), hash };
    });

    const results = await Promise.all(promises);

    // Verificar colisiones
    const hashes = new Set(results.map(r => r.hash).filter(h => h !== 'null'));
    if (hashes.size < results.length && hashes.size > 0) {
        console.error('⚠️ ¡ALERTA! Posible colisión detectada.');
        console.table(results);
    } else {
        console.log('✅ No se detectaron colisiones obvias.');
    }
}

debugCollision();
