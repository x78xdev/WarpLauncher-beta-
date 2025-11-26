declare module 'get-installed-apps' {
    export interface InstalledApp {
        appName: string;
        DisplayName?: string;
        DisplayIcon?: string;
        InstallLocation?: string;
        UninstallString?: string;
        [key: string]: any;
    }

    export function getWinInstalledApps(): Promise<InstalledApp[]>;
}
