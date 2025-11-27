import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, shell, screen, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync, spawn, execFile, ChildProcess } from 'child_process';
import { getExeDetails } from './utils/exe-analyzer';
import { scanStartMenu } from './utils/app-scanner';
import { clearIconCache } from './utils/icon-extractor';
import { AppItem, CommandItem, FileItem, OpenItemPayload, BootstrapData } from './types';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

let cachedApps: AppItem[] = [];

let mainWindow: BrowserWindow | null = null;

let miniWin: BrowserWindow | null = null;
let miniHideTimer: NodeJS.Timeout | null = null;

// Envía teclas multimedia a nivel del sistema (Windows)
function sendMediaKey(vkHex: string): Promise<boolean> {
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
}
"@;
[byte]$VK = ${vkHex};
[K]::keybd_event($VK,0,0,0);       # keydown
[K]::keybd_event($VK,0,2,0);       # keyup
`;
    return new Promise((resolve, reject) => {
        const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
        p.on('exit', code => code === 0 ? resolve(true) : reject(new Error('media key failed')));
    });
}

// Lanza Spotify (si no está) usando el protocolo
function launchSpotify(): void {
    try { shell.openExternal('spotify:'); } catch { }
}

// Crea/posiciona la ventanita
function showMiniPlayer(): void {
    const WIDTH = 350, HEIGHT = 118, MARGIN = 16;
    if (!miniWin) {
        miniWin = new BrowserWindow({
            width: WIDTH,
            height: HEIGHT,
            frame: false,
            resizable: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            focusable: false,
            hasShadow: false,
            backgroundColor: '#00000000',
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true
            }
        });
        miniWin.setVisibleOnAllWorkspaces(true);
        // Cuando se compila, __dirname es dist/, necesitamos subir un nivel
        const rendererPath = path.join(__dirname, '..', 'renderer', 'mini.html');
        miniWin.loadFile(rendererPath);
    }

    // Posicionar en la esquina superior derecha
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const x = display.workArea.x + display.workArea.width - WIDTH - MARGIN;
    const y = display.workArea.y + MARGIN;
    miniWin.setPosition(Math.round(x), Math.round(y), false);
}

// IPC: mostrar el mini-player (lo llamaremos tras ejecutar un comando)
ipcMain.handle('player:show', async () => {
    console.log('🚀 showMiniPlayer() ejecutado');
    showMiniPlayer();
    return true;
});

// IPC: asegurar que Spotify esté lanzado
ipcMain.handle('spotify:launch', async () => {
    launchSpotify();
    return true;
});

// IPC: controles multimedia
ipcMain.handle('media:control', async (_e: IpcMainInvokeEvent, action: 'playpause' | 'next' | 'prev') => {
    // Códigos virtual key:
    // NEXT 0xB0, PREV 0xB1, PLAY/PAUSE 0xB3
    const VK: Record<string, string> = { playpause: '0xB3', next: '0xB0', prev: '0xB1' };
    if (!VK[action]) return false;
    await sendMediaKey(VK[action]);
    return true;
});

// === Everything Integration ===
function getFileIcon(filepath: string): string {
    const ext = path.extname(filepath).toLowerCase();
    // Asignar iconos basados en la extensión
    switch (ext) {
        case '.pdf':
            return '📄';
        case '.doc':
        case '.docx':
            return '📝';
        case '.xls':
        case '.xlsx':
            return '📊';
        case '.ppt':
        case '.pptx':
            return '📊';
        case '.txt':
            return '📝';
        case '.jpg':
        case '.jpeg':
        case '.png':
        case '.gif':
        case '.bmp':
            return '🖼️';
        case '.mp3':
        case '.wav':
        case '.ogg':
            return '🎵';
        case '.mp4':
        case '.avi':
        case '.mkv':
            return '🎬';
        case '.zip':
        case '.rar':
        case '.7z':
            return '📦';
        case '.exe':
        case '.msi':
            return '⚙️';
        default:
            return '📄';
    }
}

function findEverythingCLI(): string | null {
    const guesses = [
        'C:\\Program Files\\Everything\\es.exe',
        path.join(__dirname, 'es.exe'),
        path.join(process.cwd(), 'es.exe')
    ];
    for (const p of guesses) {
        if (fs.existsSync(p)) return p;
    }
    // Intentar desde PATH
    try {
        const t = spawnSync('where', ['es'], { shell: true, windowsHide: true });
        if (t.status === 0) {
            const found = t.stdout.toString().split(/\r?\n/).find(Boolean)?.trim();
            if (found && fs.existsSync(found)) return found;
        }
    } catch { }
    return null;
}

async function runAppPath(targetPath: string): Promise<void> {
    if (!targetPath) return;

    try {
        // shell.openPath abre .exe, .lnk, carpetas, etc., respetando espacios
        const result = await shell.openPath(targetPath);

        // Si result es string no vacío, Electron lo usa para pasar un mensaje de error
        if (result) {
            console.error('shell.openPath devolvió un error:', result);
        }
    } catch (err) {
        console.error('Failed to run app via shell.openPath:', err);
    }
}

// Handler para escaneo manual solicitado por el usuario
ipcMain.handle('scan-apps', async () => {
    return await scanStartMenuProgressive();
});

const ES_PATH = findEverythingCLI();
console.log('ES_PATH:', ES_PATH);

ipcMain.handle('files:search', async (_evt: IpcMainInvokeEvent, qRaw: string): Promise<FileItem[]> => {
    const q = (qRaw || '').trim();
    if (!q || q.length < 2) return [];
    if (!ES_PATH) return [];
    console.log('ES_PATH:', ES_PATH);

    // Argumentos simplificados para es.exe
    const args = [
        q,              // término de búsqueda
        '/n', '60'      // número máximo de resultados
    ];

    console.log('Everything search command:', `${ES_PATH} ${args.join(' ')}`);

    try {
        const results = await new Promise<string>((resolve, reject) => {
            execFile(ES_PATH!, args, { windowsHide: true, timeout: 3000 }, (err, stdout) => {
                if (err) {
                    console.warn('Everything search failed:', err.message);
                    reject(err);
                    return;
                }
                resolve(stdout);
            });
        });

        const lines = results.toString().split(/\r?\n/).filter(line => line.trim());
        const files = await Promise.all(lines.map(async line => {
            const filePath = line.trim();
            const ext = path.extname(filePath).toLowerCase();
            const iconMap: Record<string, string> = {
                '.mp3': '🎵', '.wav': '🎵', '.wma': '🎵', '.m4a': '🎵', '.ogg': '🎵',
                '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.wmv': '🎬', '.mov': '🎬',
                '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️', '.bmp': '🖼️',
                '.pdf': '📄', '.doc': '📝', '.docx': '📝', '.txt': '📄',
                '.xls': '📊', '.xlsx': '📊', '.ppt': '📊', '.pptx': '📊',
                '.exe': '⚙️', '.msi': '⚙️',
                '.zip': '📦', '.rar': '📦', '.7z': '📦'
            };

            // Determinar el tipo de archivo
            const fileType = (() => {
                if (ext.match(/\.(mp3|wav|wma|m4a|ogg)$/i)) return 'MÚSICA';
                if (ext.match(/\.(mp4|avi|mkv|wmv|mov)$/i)) return 'VIDEO';
                if (ext.match(/\.(jpg|jpeg|png|gif|bmp)$/i)) return 'IMAGEN';
                if (ext.match(/\.(pdf|doc|docx|txt|rtf)$/i)) return 'DOCUMENTO';
                if (ext.match(/\.(xls|xlsx|csv)$/i)) return 'HOJA DE CÁLCULO';
                if (ext.match(/\.(ppt|pptx)$/i)) return 'PRESENTACIÓN';
                if (ext.match(/\.(exe|msi)$/i)) return 'PROGRAMA';
                if (ext.match(/\.(zip|rar|7z)$/i)) return 'COMPRIMIDO';
                return 'ARCHIVO';
            })();

            // Si es un .exe, obtener detalles adicionales
            let details = null;
            if (ext === '.exe') {
                try {
                    details = await getExeDetails(filePath);
                } catch (error) {
                    console.error('Error analyzing exe:', filePath, error);
                }
            }

            // Construir el título y subtítulo
            let title = path.basename(filePath);
            let subtitle = filePath;
            let icon = iconMap[ext] || '📄';

            if (details) {
                title = details.description || title;

                const parts = [];
                if (details.publisher) parts.push(details.publisher);
                if (details.version) parts.push(`v${details.version}`);
                parts.push(filePath);

                subtitle = parts.join(' - ');
                icon = '⚙️';
            }

            return {
                kind: 'file' as const,
                title: title,
                subtitle: subtitle,
                path: filePath,
                tag: details ? details.type : fileType
            };
        }));

        console.log(`Found ${files.length} files for query: ${q}`);
        return files.slice(0, 50);

    } catch (error) {
        console.error('Search error:', error);
        return [];
    }
});

// === Static Data ===
// Cuando se compila, __dirname es dist/, necesitamos subir un nivel para config
const COMMANDS_PATH = path.join(__dirname, '..', 'config', 'commands.json');

function readCommands(): CommandItem[] {
    try {
        return JSON.parse(fs.readFileSync(COMMANDS_PATH, 'utf-8'));
    } catch {
        return [];
    }
}

// Manejador para ejecutar comandos
ipcMain.handle('command:execute', async (_event: IpcMainInvokeEvent, command: CommandItem): Promise<boolean> => {
    console.log('Received command:', command); // Debug
    try {
        if (command.run) {
            // Para comandos del sistema como 'control', 'ncpa.cpl', etc.
            if (command.run.includes('.cpl') || ['control', 'calc', 'notepad'].includes(command.run)) {
                console.log('Executing system command:', command.run); // Debug
                const cmd = spawn('cmd', ['/c', 'start', '', command.run], {
                    shell: true,
                    windowsHide: false
                });

                cmd.on('error', (err) => console.error('Command error:', err));
                cmd.on('exit', (code) => console.log('Command exit code:', code));
                toggleWindow();
            }
            // Para comandos de shutdown
            else if (command.run.startsWith('shutdown')) {
                console.log('Executing shutdown command:', command.run); // Debug
                const cmd = spawn('cmd', ['/c', command.run], {
                    shell: true,
                    windowsHide: false
                });

                cmd.on('error', (err) => console.error('Shutdown error:', err));
                cmd.on('exit', (code) => console.log('Shutdown exit code:', code));

            }
            // Para otros comandos
            else {
                console.log('Executing other command:', command.run); // Debug
                const cmd = spawn(command.run, [], {
                    shell: true,
                    windowsHide: false
                });

                cmd.on('error', (err) => console.error('Command error:', err));
                cmd.on('exit', (code) => console.log('Command exit code:', code));
                toggleWindow();
            }
            return true;
        } else if (command.open) {
            let target = command.open.replace(/%([^%]+)%/g, (_, n) => process.env[n] || '');
            console.log('Opening target:', target); // Debug
            if (target.startsWith('http')) {
                await shell.openExternal(target);
            } else {
                await shell.openPath(target);
            }
            toggleWindow();
            return true;
        }
        toggleWindow();
        return false;
    } catch (error) {
        console.error('Error executing command:', error);
        return false;
    }
});

function loadCommands(): CommandItem[] {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'config', 'commands.json'), 'utf8');
    return JSON.parse(raw);
}

ipcMain.handle('data:bootstrap', async (): Promise<BootstrapData> => {
    const commands = loadCommands();

    // Debug: verificar si los iconos están en cachedApps
    console.log('📦 Enviando al renderer:', cachedApps.length, 'apps');
    if (cachedApps.length > 0) {
        console.log('🔍 Primera app:', cachedApps[0].title, 'tiene iconDataUrl:', !!cachedApps[0].iconDataUrl);
    }

    return {
        commands,
        apps: cachedApps   // nuevo
    };
});

ipcMain.handle('open:item', async (_evt: IpcMainInvokeEvent, payload: OpenItemPayload): Promise<void> => {
    const { kind, data } = payload;
    if (kind === 'command') {
        if (data.run) {
            const { exec } = require('child_process');
            const command = process.platform === 'win32'
                ? `cmd /c ${data.run}`
                : data.run;
            exec(command, (error: Error | null) => {
                if (error) console.warn('Failed to run command:', error.message);
            });
        } else if (data.open) {
            let target = data.open;
            // Expandir %VAR% en Windows
            if (process.platform === 'win32') {
                target = data.open.replace(/%([^%]+)%/g, (match: string, name: string) => {
                    return process.env[name] || match;
                });
            }
            try {
                await shell.openPath(target);
            } catch (err: any) {
                console.warn('openPath failed, trying openExternal:', target, err.message);
                await shell.openExternal(data.open);
            }
        }
    } else if (kind === 'file') {
        await shell.openPath(data.path);
    } else if (kind === 'app') {
        const runPath =
            data.run ||
            data.openPath ||
            data.path;

        await runAppPath(runPath);
        toggleWindow();
        return;
    }
    if (win?.isVisible()) win.hide();
});



// === Window & Tray ===
function createWindow(): void {
    win = new BrowserWindow({
        width: 760,
        height: 900,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true, // Cambiado a false para debug
        roundedCorners: true,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            devTools: true,
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    if (process.platform === 'darwin') {
        try { (win as any).setVibrancy('under-window'); } catch { }
        try { (win as any).setVisualEffectState('active'); } catch { }
    }

    // Cuando se compila, __dirname es dist/, necesitamos subir un nivel
    const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
    win.loadFile(rendererPath);
}

function toggleWindow(): void {
    if (!win) return;
    if (win.isVisible()) {
        win.hide();
        miniWin?.hide();
    } else {
        const { width, height } = win.getBounds();
        const { bounds } = screen.getPrimaryDisplay();
        const x = Math.round(bounds.x + (bounds.width - width) / 2);
        const y = Math.round(bounds.y + (bounds.height - height) / 4);
        win.setPosition(x, y);
        win.show();
        win.focus();
        win.webContents.send('focus-input');
        win.webContents.send('launcher:show');

        //if (!miniWin || miniWin.isDestroyed()) {
        //    showMiniPlayer();
        //} else {
        //    miniWin.show();
        //}
    }
}

// Agregar manejador para Ctrl+Shift+I
function registerDevToolsShortcut(): void {
    globalShortcut.register('Control+Shift+I', () => {
        if (win) {
            win.webContents.openDevTools({ mode: 'detach' });
        }
    });
}

function registerGlobalHotkey(): void {
    const ok = globalShortcut.register('Control+Space', toggleWindow);
    if (!ok) console.error('No se pudo registrar Ctrl+Espacio');
}

function ensureEverythingRunning(): void {
    if (!ES_PATH) return;

    // Ruta típica de Everything.exe
    const everythingExe = ES_PATH.replace('es.exe', 'Everything.exe');

    if (!fs.existsSync(everythingExe)) {
        console.warn('Everything.exe no encontrado, no se puede iniciar.');
        return;
    }

    // Verificar si ya está en ejecución
    try {
        const result = spawnSync('tasklist', [], { encoding: 'utf-8', shell: true });
        if (result.stdout && result.stdout.includes('Everything.exe')) {
            console.log('Everything ya está en ejecución.');
            return;
        }
    } catch (e: any) {
        console.warn('No se pudo verificar procesos:', e.message);
    }

    // Iniciar Everything en segundo plano
    console.log('Iniciando Everything...');
    spawn(everythingExe, [], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
    });
}

// === IPC Handlers ===
// === IPC Handlers ===
ipcMain.handle('window:hide', () => {
    if (win) {
        win.hide();
        miniWin?.hide();
    }
});

// Handler para abrir CMD en una carpeta
ipcMain.handle('shell:open-cmd', async (_evt: IpcMainInvokeEvent, targetPath: string): Promise<void> => {
    if (!targetPath) return;

    try {
        let dirPath = targetPath;

        // Si es un archivo, obtener el directorio padre
        if (fs.existsSync(targetPath)) {
            const stats = fs.statSync(targetPath);
            if (stats.isFile()) {
                dirPath = path.dirname(targetPath);
            }
        } else {
            // Si no existe, asumir que es un archivo y obtener el directorio
            dirPath = path.dirname(targetPath);
        }

        // Abrir CMD en ese directorio usando 'start' para nueva ventana
        spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/K', `cd /d "${dirPath}"`], {
            detached: true,
            stdio: 'ignore',
            shell: true
        });
        if (win?.isVisible()) win.hide();

        console.log(`Opened CMD in: ${dirPath}`);
    } catch (error) {
        console.error('Error opening CMD:', error);
    }
});

// Handler para obtener iconos bajo demanda
import { getIconCacheManager } from './utils/icon-cache-manager';
import { extractIcon } from './utils/icon-extractor';

ipcMain.handle('icon:get', async (_evt, filePath: string) => {
    if (!filePath) return null;
    // Intentar obtener del caché primero (rápido)
    const cacheManager = getIconCacheManager();
    const cached = await cacheManager.get(filePath);
    if (cached) return cached;

    // Si no está, extraer (puede tardar un poco)
    return await extractIcon(filePath);
});

import { scanStartMenuProgressive } from './utils/app-scanner';

app.whenReady().then(async () => {
    ensureEverythingRunning();
    createWindow();
    registerGlobalHotkey();

    // Abrir DevTools automáticamente al inicio
    if (win) {
        win.webContents.openDevTools({ mode: 'detach' });
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Escaneo progresivo de apps en background
    console.log('🚀 Iniciando escaneo progresivo de apps...');
    try {
        cachedApps = await scanStartMenuProgressive((batch) => {
            // Enviar lote de apps encontradas al renderer si la ventana está lista
            if (win && !win.isDestroyed()) {
                win.webContents.send('apps:update', batch);
            }
        });
        console.log(`✅ Escaneo completado. Total apps: ${cachedApps.length}`);
    } catch (err) {
        console.error('Error en escaneo progresivo:', err);
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
