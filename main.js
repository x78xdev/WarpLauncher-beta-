const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, shell, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync, spawn, execFile } = require("child_process");
const { getExeDetails } = require("./utils/exe-analyzer");
const { scanStartMenu } = require('./utils/app-scanner');   // nuevo


let win;
let tray;

let cachedApps = [];

let mainWindow;

let miniWin = null;
let miniHideTimer = null;

// Envía teclas multimedia a nivel del sistema (Windows)
function sendMediaKey(vkHex) {
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
    const p = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true });
    p.on("exit", code => code === 0 ? resolve(true) : reject(new Error("media key failed")));
  });
}

// Lanza Spotify (si no está) usando el protocolo
function launchSpotify() {
  try { shell.openExternal("spotify:"); } catch {}
}

// Crea/posiciona la ventanita
function showMiniPlayer() {
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
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    miniWin.setVisibleOnAllWorkspaces(true);
    miniWin.loadFile(path.join(__dirname, "renderer", "mini.html"));
  }

  // Posicionar en la esquina superior derecha
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const x = display.workArea.x + display.workArea.width - WIDTH - MARGIN;
  const y = display.workArea.y + MARGIN;
  miniWin.setPosition(Math.round(x), Math.round(y), false);
  
 
  
}

// IPC: mostrar el mini-player (lo llamaremos tras ejecutar un comando)
ipcMain.handle("player:show", async () => {
  console.log("🚀 showMiniPlayer() ejecutado");
  showMiniPlayer();
  return true;
});

// IPC: asegurar que Spotify esté lanzado
ipcMain.handle("spotify:launch", async () => {
  launchSpotify();
  return true;
});

// IPC: controles multimedia
ipcMain.handle("media:control", async (_e, action) => {
  // Códigos virtual key:
  // NEXT 0xB0, PREV 0xB1, PLAY/PAUSE 0xB3
  const VK = { playpause: "0xB3", next: "0xB0", prev: "0xB1" };
  if (!VK[action]) return false;
  await sendMediaKey(VK[action]);
  return true;
});

// === Everything Integration ===
function getFileIcon(filepath) {
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

function findEverythingCLI() {
  const guesses = [
    "C:\\Program Files\\Everything\\es.exe",
    path.join(__dirname, "es.exe"),
    path.join(process.cwd(), "es.exe")
  ];
  for (const p of guesses) {
    if (fs.existsSync(p)) return p;
  }
  // Intentar desde PATH
  try {
    const t = spawnSync("where", ["es"], { shell: true, windowsHide: true });
    if (t.status === 0) {
      const found = t.stdout.toString().split(/\r?\n/).find(Boolean)?.trim();
      if (found && fs.existsSync(found)) return found;
    }
  } catch {}
  return null;
}

async function runAppPath(targetPath) {
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


const ES_PATH = findEverythingCLI();
console.log("ES_PATH:", ES_PATH);
ipcMain.handle("files:search", async (_evt, qRaw) => {
  const q = (qRaw || "").trim();
  if (!q || q.length < 2) return [];
  if (!ES_PATH) return [];
  console.log("ES_PATH:", ES_PATH);

  // Argumentos simplificados para es.exe
  const args = [
    q,              // término de búsqueda
    "/n", "60"      // número máximo de resultados
  ];

  console.log("Everything search command:", `${ES_PATH} ${args.join(" ")}`);

  try {
    const results = await new Promise((resolve, reject) => {
      execFile(ES_PATH, args, { windowsHide: true, timeout: 3000 }, (err, stdout) => {
        if (err) {
          console.warn("Everything search failed:", err.message);
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
      const iconMap = {
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
        if (ext.match(/\.(mp3|wav|wma|m4a|ogg)$/i)) return "MÚSICA";
        if (ext.match(/\.(mp4|avi|mkv|wmv|mov)$/i)) return "VIDEO";
        if (ext.match(/\.(jpg|jpeg|png|gif|bmp)$/i)) return "IMAGEN";
        if (ext.match(/\.(pdf|doc|docx|txt|rtf)$/i)) return "DOCUMENTO";
        if (ext.match(/\.(xls|xlsx|csv)$/i)) return "HOJA DE CÁLCULO";
        if (ext.match(/\.(ppt|pptx)$/i)) return "PRESENTACIÓN";
        if (ext.match(/\.(exe|msi)$/i)) return "PROGRAMA";
        if (ext.match(/\.(zip|rar|7z)$/i)) return "COMPRIMIDO";
        return "ARCHIVO";
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
        kind: "file",
        title: title,
        subtitle: subtitle,
        path: filePath,
        icon: icon,
        tag: details ? details.type : fileType,
        version: details?.version,
        publisher: details?.publisher
      };
    }));

    console.log(`Found ${files.length} files for query: ${q}`);
    return files.slice(0, 50);

  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
});

// === Static Data ===
const COMMANDS_PATH = path.join(__dirname, "config", "commands.json");

function readCommands() {
  try {
    return JSON.parse(fs.readFileSync(COMMANDS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

// Manejador para ejecutar comandos
ipcMain.handle("command:execute", async (_event, command) => {
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
      let target = command.open.replace(/%([^%]+)%/g, (_, n) => process.env[n]);
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

function indexUserFiles(limit = 100) {
  const homes = [
    path.join(os.homedir(), "Documents"),
    path.join(os.homedir(), "Downloads"),
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "Music"),
    path.join(os.homedir(), "Videos"),
    path.join(os.homedir(), "Pictures")
  ];
  const exts = {
    // Documentos
    ".pdf": "📄",
    ".doc": "📝",
    ".docx": "📝",
    ".txt": "📄",
    ".rtf": "📄",
    // Hojas de cálculo
    ".xls": "📊",
    ".xlsx": "📊",
    // Presentaciones
    ".ppt": "📊",
    ".pptx": "📊",
    // Imágenes
    ".jpg": "🖼️",
    ".jpeg": "🖼️",
    ".png": "🖼️",
    ".gif": "🖼️",
    ".bmp": "🖼️",
    // Audio
    ".mp3": "🎵",
    ".wav": "🎵",
    ".wma": "🎵",
    ".m4a": "🎵",
    ".ogg": "🎵",
    // Video
    ".mp4": "🎬",
    ".avi": "🎬",
    ".mkv": "🎬",
    ".wmv": "🎬",
    ".mov": "🎬",
    // Ejecutables
    ".exe": "⚙️",
    ".msi": "⚙️",
    // Comprimidos
    ".zip": "📦",
    ".rar": "📦",
    ".7z": "📦"
  };
  const items = [];

  for (const base of homes) {
    if (!fs.existsSync(base)) continue;
    try {
      const files = fs.readdirSync(base).slice(0, 300);
      for (const f of files) {
        const full = path.join(base, f);
        try {
          const stat = fs.statSync(full);
          const ext = path.extname(full).toLowerCase();
          if (stat.isFile() && ext in exts) {
            items.push({
              type: "file",
              title: path.basename(full),
              subtitle: full,
              path: full,
              icon: exts[ext],
              scoreHint: stat.mtimeMs
            });
          }
        } catch {
          // skip inaccessible files
        }
      }
    } catch {
      // skip folder
    }
  }

  return items
    .sort((a, b) => b.scoreHint - a.scoreHint)
    .slice(0, limit);
}

function appsQuickList() {
  const isWin = process.platform === "win32";
  const list = [];
  if (isWin) {
    // Aplicaciones del sistema
    list.push({ type: "app", title: "Notepad", subtitle: "Abrir Bloc de notas", run: "notepad", icon: "📝", tag: "APLICACIÓN" });
    list.push({ type: "app", title: "Calculator", subtitle: "Abrir Calculadora", run: "calc", icon: "🔢", tag: "APLICACIÓN" });
    list.push({ type: "app", title: "Command Prompt", subtitle: "Abrir CMD", run: "cmd", icon: "⌨️", tag: "APLICACIÓN" });
    list.push({ type: "app", title: "Paint", subtitle: "Abrir Paint", run: "mspaint", icon: "🎨", tag: "APLICACIÓN" });
    list.push({ type: "app", title: "Windows Media Player", subtitle: "Abrir Reproductor", run: "wmplayer", icon: "🎵", tag: "APLICACIÓN" });
    list.push({ type: "app", title: "Task Manager", subtitle: "Administrador de tareas", run: "taskmgr", icon: "📊", tag: "APLICACIÓN" });
    list.push({ type: "app", title: "File Explorer", subtitle: "Explorador de archivos", run: "explorer", icon: "📂", tag: "APLICACIÓN" });
    
    // Carpetas especiales
    const specialFolders = [
      { title: "Música", path: "%USERPROFILE%\\Music", icon: "🎵" },
      { title: "Documentos", path: "%USERPROFILE%\\Documents", icon: "📄" },
      { title: "Imágenes", path: "%USERPROFILE%\\Pictures", icon: "🖼️" },
      { title: "Videos", path: "%USERPROFILE%\\Videos", icon: "🎬" },
      { title: "Descargas", path: "%USERPROFILE%\\Downloads", icon: "⬇️" }
    ];

    specialFolders.forEach(folder => {
      list.push({
        type: "app",
        title: folder.title,
        subtitle: `Abrir carpeta ${folder.title}`,
        open: folder.path,
        icon: folder.icon,
        tag: "CARPETA"
      });
    });
  }
  return list;
}

// === IPC Handlers ===
ipcMain.handle("window:hide", () => {
  if (win) {
    win.hide();
    miniWin.hide();
  }
});

function loadCommands() {
  const raw = fs.readFileSync(path.join(__dirname, 'config', 'commands.json'), 'utf8');
  return JSON.parse(raw);
}

ipcMain.handle('data:bootstrap', async () => {
  const commands = loadCommands();

  return {
    commands,
    apps: cachedApps   // nuevo
  };
});


ipcMain.handle("open:item", async (_evt, payload) => {
  const { kind, data } = payload;
  if (kind === "command") {
    if (data.run) {
      const { exec } = require("child_process");
      const command = process.platform === "win32"
        ? `cmd /c ${data.run}`
        : data.run;
      exec(command, (error) => {
        if (error) console.warn("Failed to run command:", error.message);
      });
    } else if (data.open) {
      let target = data.open;
      // Expandir %VAR% en Windows
      if (process.platform === "win32") {
        target = data.open.replace(/%([^%]+)%/g, (match, name) => {
          return process.env[name] || match;
        });
      }
      try {
        await shell.openPath(target);
      } catch (err) {
        console.warn("openPath failed, trying openExternal:", target, err.message);
        await shell.openExternal(data.open);
      }
    }
  } else if (kind === "file") {
    await shell.openPath(data.path);
  } if (kind === 'app') {
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

function hideMainWindow() {
  if (win && !win.isDestroyed()) {
    win.hide();
  }
}
// === Window & Tray ===
function createWindow() {
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
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      devTools: true,
      nodeIntegration: true,
      contextIsolation: true
    }
  });

  if (process.platform === "darwin") {
    try { win.setVibrancy("under-window"); } catch {}
    try { win.setVisualEffectState("active"); } catch {}
  }

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}




function toggleWindow() {
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
    win.webContents.send("focus-input");
    win.webContents.send('launcher:show');

    if (!miniWin || miniWin.isDestroyed()) {
      showMiniPlayer();
    } else {
      miniWin.show();
    }
  }
}

// Agregar manejador para Ctrl+Shift+I
function registerDevToolsShortcut() {
  globalShortcut.register('Control+Shift+I', () => {
    if (win) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });
}

function registerGlobalHotkey() {
  const ok = globalShortcut.register("Control+Space", toggleWindow);
  if (!ok) console.error("No se pudo registrar Ctrl+Espacio");
}

function ensureEverythingRunning() {
  if (!ES_PATH) return;

  // Ruta típica de Everything.exe
  const everythingExe = ES_PATH.replace("es.exe", "Everything.exe");

  if (!fs.existsSync(everythingExe)) {
    console.warn("Everything.exe no encontrado, no se puede iniciar.");
    return;
  }

  // Verificar si ya está en ejecución
  try {
    const result = spawnSync("tasklist", [], { encoding: "utf-8", shell: true });
    if (result.stdout && result.stdout.includes("Everything.exe")) {
      console.log("Everything ya está en ejecución.");
      return;
    }
  } catch (e) {
    console.warn("No se pudo verificar procesos:", e.message);
  }

  // Iniciar Everything en segundo plano
  console.log("Iniciando Everything...");
  spawn(everythingExe, [], {
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
}

app.whenReady().then(async () => {
  try {
    cachedApps = await scanStartMenu();
    console.log(`WarpLaunch: detectadas ${cachedApps.length} aplicaciones del menú Inicio`);
  } catch (err) {
    console.error('Error escaneando aplicaciones:', err);
    cachedApps = [];
  }
    ensureEverythingRunning();
    createWindow();
    registerGlobalHotkey();
    //registerDevToolsShortcut();
    
    // Abrir DevTools automáticamente al inicio
    //if (win) {
    //  win.webContents.openDevTools({ mode: 'detach' });
    ///}

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});



app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});