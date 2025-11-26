import { contextBridge, ipcRenderer } from 'electron';
import { WarpAPI, BootstrapData, OpenItemPayload, CommandItem } from './types';

// Solo exponemos funciones específicas y bien definidas
const warpAPI: WarpAPI = {
    // Carga inicial de comandos, apps y archivos base
    bootstrap: () => ipcRenderer.invoke('data:bootstrap') as Promise<BootstrapData>,

    // Abre un elemento (comando, archivo o app)
    openItem: (payload: OpenItemPayload) => ipcRenderer.invoke('open:item', payload),

    // Ejecuta un comando
    executeCommand: (command: CommandItem) => ipcRenderer.invoke('command:execute', command),

    // Busca archivos en tiempo real usando Everything
    searchFiles: (query: string) => ipcRenderer.invoke('files:search', query),

    // Maneja el enfoque del input desde el proceso principal
    focusInput: (callback: (...args: any[]) => void) => {
        const handler = (_: any, ...args: any[]) => callback(...args);
        ipcRenderer.on('focus-input', handler);
        // Opcional: devolver una función para limpiar el listener si se necesita
        return () => ipcRenderer.removeListener('focus-input', handler);
    },

    playerShow: () => ipcRenderer.invoke('player:show'),
    spotifyLaunch: () => ipcRenderer.invoke('spotify:launch'),
    mediaControl: (action: 'playpause' | 'next' | 'prev') => ipcRenderer.invoke('media:control', action),

    // Ocultar la ventana
    hideWindow: () => ipcRenderer.invoke('window:hide'),

    onShow: (handler: () => void) => {
        ipcRenderer.on('launcher:show', handler);
    },

    // === Nuevas APIs para optimización de iconos ===
    getIcon: (path: string) => ipcRenderer.invoke('icon:get', path),

    onAppsUpdate: (handler: (apps: any[]) => void) => {
        ipcRenderer.on('apps:update', (_event, apps) => handler(apps));
    },

    // API solicitada por el usuario
    scanApps: () => ipcRenderer.invoke('scan-apps')
};

contextBridge.exposeInMainWorld('warp', warpAPI);
