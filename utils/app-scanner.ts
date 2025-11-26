import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { getWinInstalledApps, InstalledApp } from 'get-installed-apps';
import { AppItem } from '../types';

// Helper to parse DisplayIcon: "C:\path\file.exe,0"
function parseDisplayIcon(displayIcon: string | undefined): { file: string | null, index: number } {
    if (!displayIcon) {
        return { file: null, index: 0 };
    }

    const cleaned = displayIcon.replace(/^"|"$/g, '');
    const parts = cleaned.split(',');

    const file = parts[0];
    const index = parts[1] ? parseInt(parts[1], 10) || 0 : 0;

    return { file, index };
}

// Helper to guess executable
async function guessExeForApp(appInfo: InstalledApp): Promise<string | null> {
    // 1. Try DisplayIcon
    if (appInfo.DisplayIcon) {
        const { file } = parseDisplayIcon(appInfo.DisplayIcon);

        if (
            file &&
            !file.startsWith('@{') && // ignore UWP weird paths
            fs.existsSync(file)
        ) {
            return file;
        }
    }

    // 2. Fallback: InstallLocation
    const installDir = appInfo.InstallLocation;
    if (installDir && fs.existsSync(installDir)) {
        try {
            const files = fs
                .readdirSync(installDir)
                .filter(f => f.toLowerCase().endsWith('.exe'));

            if (files.length > 0) {
                // Simplistic: use the first .exe found
                return path.join(installDir, files[0]);
            }
        } catch (e) {
            // ignore access errors
        }
    }

    return null;
}

// Helper to get icon base64
async function getIconBase64ForFile(filePath: string): Promise<string | null> {
    if (!filePath) return null;
    if (!fs.existsSync(filePath)) return null;

    try {
        const icon = await app.getFileIcon(filePath, { size: 'normal' });
        if (!icon) return null;

        const pngBuffer = icon.toPNG();
        return pngBuffer.toString('base64');
    } catch (e) {
        console.warn('getFileIcon failed for', filePath, e);
        return null;
    }
}

export async function scanStartMenuProgressive(onProgress?: (apps: AppItem[]) => void): Promise<AppItem[]> {
    console.log('🔄 Starting registry app scan...');
    const rawApps = await getWinInstalledApps();
    console.log(`Found ${rawApps.length} raw apps from registry.`);

    const apps: AppItem[] = [];
    const BATCH_SIZE = 5;
    let currentBatch: AppItem[] = [];

    // Filter and process
    for (const info of rawApps) {
        const name = info.appName || info.DisplayName;
        if (!name) continue;

        const exePath = await guessExeForApp(info);
        if (!exePath) continue;

        // Create AppItem
        const appItem: AppItem = {
            kind: 'app',
            title: name,
            subtitle: exePath,
            run: exePath,
            tag: 'APP',
            iconDataUrl: undefined // Will be filled below
        };

        // Extract icon
        const iconBase64 = await getIconBase64ForFile(exePath);
        if (iconBase64) {
            appItem.iconDataUrl = `data:image/png;base64,${iconBase64}`;
        } else {
            // Optional: Provide a fallback or leave undefined for frontend fallback
        }

        apps.push(appItem);
        currentBatch.push(appItem);

        if (currentBatch.length >= BATCH_SIZE) {
            if (onProgress) onProgress([...currentBatch]);
            currentBatch = [];
            // Small delay to prevent UI freeze
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    // Send remaining
    if (currentBatch.length > 0 && onProgress) {
        onProgress([...currentBatch]);
    }

    console.log(`✅ Registry scan complete. Total valid apps: ${apps.length}`);
    return apps;
}

// Backwards compatibility
export async function scanStartMenu(): Promise<AppItem[]> {
    return scanStartMenuProgressive();
}
