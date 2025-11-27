const fs = require('fs');
const path = require('path');
const os = require('os');
const { getWinInstalledApps } = require('get-installed-apps');

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const CACHE_FILE = path.join(APPDATA, 'warplaunch', 'apps-cache.json');

const EXCLUDED_KEYWORDS = [
    'uninstall',
    'desinstalar',
    'unins',
    'remove',
    'repair',
    'modify',
    'install',
    'setup',
    'help',
    'ayuda',
    'readme',
    'leeme',
    'license',
    'licencia',
    'url',
    'website',
    'eliminar'
];

async function test() {
    // 1. Clear cache
    if (fs.existsSync(CACHE_FILE)) {
        console.log('Deleting cache file:', CACHE_FILE);
        fs.unlinkSync(CACHE_FILE);
    } else {
        console.log('Cache file not found:', CACHE_FILE);
    }

    // 2. Simulate scan and filter
    console.log('Scanning...');
    const rawApps = await getWinInstalledApps();
    console.log(`Found ${rawApps.length} raw apps.`);

    let filteredCount = 0;
    const badApps = [];

    for (const app of rawApps) {
        const name = app.appName || app.DisplayName || '';
        const exePath = app.DisplayIcon || app.InstallLocation || ''; // Approximation for test

        const lowerName = name.toLowerCase();
        const lowerPath = exePath.toLowerCase();

        const isExcludedName = EXCLUDED_KEYWORDS.some(k => lowerName.includes(k));
        const isExcludedPath = EXCLUDED_KEYWORDS.some(k => lowerPath.includes(k));

        if (isExcludedName || isExcludedPath) {
            filteredCount++;
            badApps.push({ name, exePath });
        }
    }

    console.log(`Filtered ${filteredCount} apps.`);
    if (badApps.length > 0) {
        console.log('Examples of filtered apps:');
        badApps.slice(0, 5).forEach(a => console.log(`- ${a.name} (${a.exePath})`));
    }
}

test();
