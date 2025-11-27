// Shared type definitions for WarpLaunch

export interface AppItem {
    kind: 'app';
    title: string;
    subtitle: string;
    tag: string;
    run: string;
    path?: string;
    openPath?: string;
    iconDataUrl?: string;
    data?: any;
}

export interface CommandItem {
    id?: string;
    key?: string;
    title: string;
    subtitle?: string;
    description?: string;
    tag?: string;
    run?: string;
    open?: string;
    kind?: 'command';
}

export interface FileItem {
    kind: 'file';
    title: string;
    subtitle?: string;
    path: string;
    tag?: string;
}

export interface ExeDetails {
    description: string;
    version: string;
    publisher: string;
    product: string;
    path: string;
    type: string;
}

export interface IconCacheInfo {
    totalFiles: number;
    totalSize: number;
    formattedSize: string;
    cacheDir: string;
}

export interface BootstrapData {
    commands: CommandItem[];
    apps: AppItem[];
}

export interface OpenItemPayload {
    kind: 'command' | 'file' | 'app';
    data: any;
}

// Window.warp API exposed by preload
export interface WarpAPI {
    bootstrap: () => Promise<BootstrapData>;
    openItem: (payload: OpenItemPayload) => Promise<void>;
    executeCommand: (command: CommandItem) => Promise<boolean>;
    searchFiles: (query: string) => Promise<FileItem[]>;
    focusInput: (callback: (...args: any[]) => void) => () => void;
    playerShow: () => Promise<boolean>;
    spotifyLaunch: () => Promise<void>;
    mediaControl: (action: 'playpause' | 'next' | 'prev') => Promise<boolean>;
    hideWindow: () => Promise<void>;
    onShow: (handler: () => void) => void;
    getIcon: (path: string) => Promise<string | null>;
    onAppsUpdate: (handler: (apps: AppItem[]) => void) => void;
    scanApps: () => Promise<AppItem[]>;
    openCmd: (path: string) => Promise<void>;
}

declare global {
    interface Window {
        warp: WarpAPI;
    }
}
