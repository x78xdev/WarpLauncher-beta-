declare module 'windows-shortcuts' {
    export function query(
        path: string,
        callback: (error: Error | null, options?: {
            target?: string;
            icon?: string;
            [key: string]: any;
        }) => void
    ): void;
}
