// utils/icon-cache-manager.ts
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

interface IconCacheEntry {
    hash: string;
    dataUrl: string;
    size: number;
    timestamp: number;
    hits: number;
    filePath: string;
}

interface CacheMetadata {
    entries: Map<string, IconCacheEntry>;
    totalSize: number;
    lastCleanup: number;
}

export class IconCacheManager {
    private memoryCache: Map<string, string> = new Map();
    private diskCacheMetadata: Map<string, IconCacheEntry> = new Map();
    private cacheDir: string = '';
    private metadataFile: string = '';
    private readonly MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100 MB
    private readonly MAX_MEMORY_CACHE = 50; // Máximo de iconos en memoria
    private extractionQueue: Set<string> = new Set();
    private readonly MAX_CONCURRENT_EXTRACTIONS = 6;
    private activeExtractions = 0;

    constructor() {
        this.initCache();
    }

    private initCache(): void {
        this.cacheDir = path.join(app.getPath('userData'), 'icon-cache-v2');
        this.metadataFile = path.join(this.cacheDir, 'metadata.json');

        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }

        this.loadMetadata();
    }

    private loadMetadata(): void {
        try {
            if (fs.existsSync(this.metadataFile)) {
                const data = fs.readFileSync(this.metadataFile, 'utf-8');
                const parsed = JSON.parse(data);

                // Convertir array a Map
                if (parsed.entries && Array.isArray(parsed.entries)) {
                    this.diskCacheMetadata = new Map(parsed.entries);
                }
            }
        } catch (error: any) {
            console.error('Error loading cache metadata:', error.message);
            this.diskCacheMetadata = new Map();
        }
    }

    private saveMetadata(): void {
        try {
            const data = {
                entries: Array.from(this.diskCacheMetadata.entries()),
                totalSize: this.getTotalCacheSize(),
                lastCleanup: Date.now()
            };
            fs.writeFileSync(this.metadataFile, JSON.stringify(data, null, 2));
        } catch (error: any) {
            console.error('Error saving cache metadata:', error.message);
        }
    }

    public generateHash(filePath: string): string {
        try {
            const stats = fs.statSync(filePath);
            const key = `${filePath}-${stats.mtimeMs}`;
            return require('crypto').createHash('md5').update(key).digest('hex');
        } catch (error) {
            return require('crypto').createHash('md5').update(filePath).digest('hex');
        }
    }

    private getTotalCacheSize(): number {
        let total = 0;
        for (const entry of this.diskCacheMetadata.values()) {
            total += entry.size;
        }
        return total;
    }

    private cleanupOldEntries(): void {
        const entries = Array.from(this.diskCacheMetadata.entries());

        // Ordenar por hits (menos usado primero) y luego por timestamp
        entries.sort((a, b) => {
            if (a[1].hits !== b[1].hits) {
                return a[1].hits - b[1].hits;
            }
            return a[1].timestamp - b[1].timestamp;
        });

        let currentSize = this.getTotalCacheSize();
        const targetSize = this.MAX_CACHE_SIZE * 0.7; // Reducir a 70%

        for (const [hash, entry] of entries) {
            if (currentSize <= targetSize) break;

            try {
                const cacheFile = path.join(this.cacheDir, `${hash}.png`);
                if (fs.existsSync(cacheFile)) {
                    fs.unlinkSync(cacheFile);
                }
                this.diskCacheMetadata.delete(hash);
                currentSize -= entry.size;
            } catch (error) {
                console.error('Error deleting cache file:', error);
            }
        }

        this.saveMetadata();
    }

    /**
     * Obtiene un icono del caché (memoria o disco)
     */
    async get(filePath: string): Promise<string | null> {
        // 1. Verificar caché en memoria (más rápido)
        if (this.memoryCache.has(filePath)) {
            return this.memoryCache.get(filePath)!;
        }

        // 2. Verificar caché en disco
        const hash = this.generateHash(filePath);
        const cacheFile = path.join(this.cacheDir, `${hash}.png`);

        if (fs.existsSync(cacheFile)) {
            try {
                const iconData = fs.readFileSync(cacheFile);
                const dataUrl = `data:image/png;base64,${iconData.toString('base64')}`;

                // Actualizar metadata
                const entry = this.diskCacheMetadata.get(hash);
                if (entry) {
                    entry.hits++;
                    entry.timestamp = Date.now();
                    this.saveMetadata();
                }

                // Guardar en memoria (con límite)
                this.addToMemoryCache(filePath, dataUrl);

                return dataUrl;
            } catch (error) {
                console.error('Error reading cached icon:', error);
                // Si hay error, eliminar del caché
                try {
                    fs.unlinkSync(cacheFile);
                    this.diskCacheMetadata.delete(hash);
                } catch { }
            }
        }

        return null;
    }

    /**
     * Guarda un icono en el caché
     */
    async set(filePath: string, pngBuffer: Buffer): Promise<string> {
        const hash = this.generateHash(filePath);
        const cacheFile = path.join(this.cacheDir, `${hash}.png`);
        const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

        try {
            // Guardar en disco
            fs.writeFileSync(cacheFile, pngBuffer);

            // Actualizar metadata
            this.diskCacheMetadata.set(hash, {
                hash,
                dataUrl,
                size: pngBuffer.length,
                timestamp: Date.now(),
                hits: 1,
                filePath
            });

            // Guardar en memoria
            this.addToMemoryCache(filePath, dataUrl);

            // Verificar si necesitamos limpiar
            if (this.getTotalCacheSize() > this.MAX_CACHE_SIZE) {
                this.cleanupOldEntries();
            } else {
                this.saveMetadata();
            }

            return dataUrl;
        } catch (error: any) {
            console.error('Error saving to cache:', error.message);
            return dataUrl;
        }
    }

    private addToMemoryCache(filePath: string, dataUrl: string): void {
        // Si el caché de memoria está lleno, eliminar el más antiguo
        if (this.memoryCache.size >= this.MAX_MEMORY_CACHE) {
            const firstKey = this.memoryCache.keys().next().value;
            if (firstKey) {
                this.memoryCache.delete(firstKey);
            }
        }
        this.memoryCache.set(filePath, dataUrl);
    }

    /**
     * Limpia todo el caché
     */
    clear(): void {
        try {
            this.memoryCache.clear();

            const files = fs.readdirSync(this.cacheDir);
            for (const file of files) {
                if (file !== 'metadata.json') {
                    try {
                        fs.unlinkSync(path.join(this.cacheDir, file));
                    } catch (error) {
                        console.error('Error deleting file:', file);
                    }
                }
            }

            this.diskCacheMetadata.clear();
            this.saveMetadata();

            console.log('✅ Icon cache cleared');
        } catch (error: any) {
            console.error('Error clearing cache:', error.message);
        }
    }

    /**
     * Obtiene estadísticas del caché
     */
    getStats() {
        return {
            memoryEntries: this.memoryCache.size,
            diskEntries: this.diskCacheMetadata.size,
            totalSize: this.getTotalCacheSize(),
            formattedSize: (this.getTotalCacheSize() / (1024 * 1024)).toFixed(2) + ' MB',
            cacheDir: this.cacheDir
        };
    }

    /**
     * Precarga iconos de una lista de rutas
     */
    async preload(filePaths: string[], onProgress?: (loaded: number, total: number) => void): Promise<void> {
        let loaded = 0;
        const total = filePaths.length;

        for (const filePath of filePaths) {
            const cached = await this.get(filePath);
            if (cached) {
                loaded++;
                if (onProgress) onProgress(loaded, total);
            }
        }
    }
}

// Singleton instance
let instance: IconCacheManager | null = null;

export function getIconCacheManager(): IconCacheManager {
    if (!instance) {
        instance = new IconCacheManager();
    }
    return instance;
}
