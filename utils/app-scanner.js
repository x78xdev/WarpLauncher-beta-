// utils/app-scanner.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const fg = require('fast-glob');

/**
 * Escanea accesos directos del menú Inicio (Programas) y devuelve
 * una lista de apps con nombre y ruta.
 */


const EXCLUDED_KEYWORDS = [
  'uninstall',
  'desinstalar',
  'unins',      // típico de desinstaladores: unins000.exe
  'remove',
  'repair',
  'modify',
  'install',
  'setup'
];

async function scanStartMenu() {
  const apps = [];
  const seen = new Set();

  const programDataStart = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs';
  const userStart = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs'
  );

  const roots = [programDataStart, userStart];

  for (const root of roots) {
  if (!fs.existsSync(root)) continue;

  const files = await fg(['**/*.lnk', '**/*.exe'], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true
  });

    for (const fullPath of files) {
      const base = path.basename(fullPath);
      const nameWithoutExt = base.replace(/\.(lnk|exe)$/i, '');
      const lowerName = nameWithoutExt.toLowerCase();
      const lowerPath = fullPath.toLowerCase();

      // 1) Filtrar accesos de desinstalación / instalación y similares
      const isExcluded = EXCLUDED_KEYWORDS.some((word) =>
        lowerName.includes(word) || lowerPath.includes(word)
      );

      if (isExcluded) {
        continue; // saltamos esta "app"
      }

      // 2) Evitar duplicados por nombre
      const key = lowerName;
      if (seen.has(key)) continue;
      seen.add(key);

      apps.push({
        kind: 'app',
        title: nameWithoutExt,
        subtitle: fullPath,
        run: fullPath,
        tag: 'APP'
      });
    }
  }


  return apps;
}

module.exports = {
  scanStartMenu
};
