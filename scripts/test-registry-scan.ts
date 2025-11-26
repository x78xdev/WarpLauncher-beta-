import { getWinInstalledApps } from 'get-installed-apps';

async function test() {
    console.log('Testing getWinInstalledApps...');
    try {
        const apps = await getWinInstalledApps();
        console.log(`Found ${apps.length} apps.`);
        if (apps.length > 0) {
            console.log('Sample app:', apps[0]);
        }
    } catch (err) {
        console.error('Error:', err);
    }
}

test();
