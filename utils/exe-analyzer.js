const path = require('path');
const { execSync } = require('child_process');

async function getExeDetails(filePath) {
    if (!filePath.toLowerCase().endsWith('.exe')) {
        return null;
    }

    try {
        // Escapar comillas y barras invertidas en la ruta
        const escapedPath = filePath.replace(/"/g, '\\"').replace(/\\/g, '\\\\');

        // Obtener información del archivo usando PowerShell sin depender de JSON
        const psScript = `
            $ErrorActionPreference = "Stop"
            Write-Output "EXEINFO_START"
            try {
                $file = Get-Item -LiteralPath "${escapedPath}" -ErrorAction Stop
                if ($file.Extension -eq '.exe') {
                    $fileVersion = $file.VersionInfo.FileVersion
                    $productVersion = $file.VersionInfo.ProductVersion
                    $description = $file.VersionInfo.FileDescription
                    $company = $file.VersionInfo.CompanyName
                    $product = $file.VersionInfo.ProductName

                    if ([string]::IsNullOrEmpty($description)) {
                        $description = $file.BaseName
                    }

                    Write-Output "Description: $description"
                    if ($fileVersion) { Write-Output "FileVersion: $fileVersion" }
                    if ($productVersion) { Write-Output "ProductVersion: $productVersion" }
                    if ($company) { Write-Output "Company: $company" }
                    if ($product) { Write-Output "Product: $product" }
                } else {
                    Write-Output "Description: $($file.BaseName)"
                }
            } catch {
                Write-Output "Description: $([System.IO.Path]::GetFileNameWithoutExtension('${escapedPath}'))"
            }
            Write-Output "EXEINFO_END"
        `;

        // Ejecutar PowerShell y capturar la salida
        const output = execSync(`powershell -NoProfile -NonInteractive -Command "${psScript}"`, {
            encoding: 'utf8',
            windowsHide: true
        });

        // Procesar la salida línea por línea
        const lines = output.split('\n').map(l => l.trim());
        const startIndex = lines.indexOf('EXEINFO_START');
        const endIndex = lines.indexOf('EXEINFO_END');

        if (startIndex === -1 || endIndex === -1) {
            throw new Error('Invalid output format');
        }

        const details = {};
        for (let i = startIndex + 1; i < endIndex; i++) {
            const line = lines[i];
            const separatorIndex = line.indexOf(':');
            if (separatorIndex !== -1) {
                const key = line.substring(0, separatorIndex).trim();
                const value = line.substring(separatorIndex + 1).trim();
                details[key] = value;
            }
        }

        return {
            description: details.Description || path.basename(filePath, '.exe'),
            version: details.FileVersion || details.ProductVersion || '',
            publisher: details.Company || '',
            product: details.Product || '',
            path: filePath,
            type: 'PROGRAMA'
        };
    } catch (error) {
        // Si hay un error, devolver información básica
        console.error('Error getting exe details:', error);
        return {
            description: path.basename(filePath, '.exe'),
            version: '',
            publisher: '',
            product: '',
            path: filePath,
            type: 'PROGRAMA'
        };
    }
}

module.exports = { getExeDetails };