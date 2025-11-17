// ===== refs principales =====
const resultsEl = document.getElementById("results");
const inputEl = document.getElementById("search");

// estado de búsqueda
let staticModel = [];      // comandos + apps
let fuse;
let cursor = 0;
let liveFiles = [];
let currentView = 'search';  // <- lista renderizada vigente (para Enter)
let currentResults = [];

let currentQuery = "";
let currentFilterKind = null; // "app" | "file" | "command" | null

// ===== Favoritos y recientes =====
let favorites = [];
let recents = [];
let usage = {};
const RECENTS_LIMIT = 30;
const STORAGE_KEY = 'warplaunch_state_v1';

// ===== Dock / vistas =====
const dockEl = document.getElementById('dock');
const wrapEl = document.getElementById('wrap');
const viewCalc = document.getElementById('view-calc');
const viewIA = document.getElementById('view-ia');

const views = ['search', 'calc', 'ia'];


// utilidades para mostrar/ocultar...
function showEl(el)  { if (el) { el.hidden = false; el.style.display = ''; } }
function hideEl(el)  { if (el) { el.hidden = true;  el.style.display = 'none'; } }

function switchView(name) {
  currentView = name;   // <- nuevo

  views.forEach(v => {
    const panel = (v === 'search')
      ? document.getElementById('wrap')
      : document.getElementById(`view-${v}`);
    const btn   = document.querySelector(`#dock [data-view="${v}"]`);

    if (!panel) return;

    if (v === name) {
      showEl(panel);
    } else {
      hideEl(panel);
    }

    if (btn) {
      btn.classList.toggle('active', v === name);
    }
  });

  if (name === 'search') {
    const input = document.getElementById('search');
    if (input) {
      input.focus();
      input.select?.();
    }
  }
}

function buildStaticModel(commands = [], apps = []) {
  const out = [];

  commands.forEach((cmd) => {
    out.push({
      kind: 'command',
      title: cmd.title,
      subtitle: cmd.subtitle || cmd.description || '',
      tag: cmd.tag || 'CMD',
      data: cmd
    });
  });

  apps.forEach((app) => {
    out.push({
      kind: 'app',
      title: app.title,
      subtitle: app.subtitle || app.path || '',
      tag: 'APP',
      run: app.run || app.path,
      data: app
    });
  });

  return out;
}

function canBePinned(item) {
  return !!item && (item.kind === 'app' || item.kind === 'file' || item.kind === 'command');
}

function getItemKey(item) {
  if (!item) return '';

  if (item.kind === 'file') {
    return `file:${item.path || item.subtitle || item.title}`;
  }
  if (item.kind === 'app') {
    return `app:${item.run || item.subtitle || item.title}`;
  }
  if (item.kind === 'command') {
    const id = item.data?.id || item.data?.key || item.title;
    return `cmd:${id}`;
  }

  // No guardamos calc-inline ni info
  if (item.kind === 'calc-inline' || item.kind === 'info') {
    return '';
  }

  return `${item.kind}:${item.title}:${item.subtitle || ''}`;
}

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed.favorites)) {
      favorites = parsed.favorites;
    }
    if (Array.isArray(parsed.recents)) {
      recents = parsed.recents;
    }
    if (parsed.usage && typeof parsed.usage === "object") {
      usage = parsed.usage;
    }
  } catch (err) {
    console.warn("No se pudo cargar favoritos/recientes/uso:", err);
  }
}

function saveState() {
  try {
    const payload = { favorites, recents, usage };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("No se pudo guardar favoritos/recientes/uso:", err);
  }
}

function bumpUsage(item) {
  if (!canBePinned(item)) return;

  const key = getItemKey(item);
  if (!key) return;

  const now = Date.now();

  if (!usage[key]) {
    usage[key] = { count: 0, lastUsed: 0 };
  }

  usage[key].count += 1;
  usage[key].lastUsed = now;

  // No pasa nada si guardamos aquí, son objetos pequeñitos
  saveState();
}

function getUsageScore(item) {
  const key = getItemKey(item);
  if (!key) return 0;

  const u = usage[key];
  if (!u) return 0;

  return u.count || 0;
}

function sortByUsageDescThenTitle(a, b) {
  const da = getUsageScore(a);
  const db = getUsageScore(b);

  if (db !== da) {
    return db - da; // más usados primero
  }

  const ta = (a.title || "").toLowerCase();
  const tb = (b.title || "").toLowerCase();

  return ta.localeCompare(tb);
}



function isFavorite(item) {
  if (!canBePinned(item)) return false;
  const key = getItemKey(item);
  if (!key) return false;
  return favorites.some((f) => getItemKey(f) === key);
}

function toggleFavorite(item) {
  if (!canBePinned(item)) return;
  const key = getItemKey(item);
  if (!key) return;

  if (favorites.some((f) => getItemKey(f) === key)) {
    favorites = favorites.filter((f) => getItemKey(f) !== key);
  } else {
    favorites.unshift(item);
  }
  saveState();
}

function addToRecents(item) {
  if (!canBePinned(item)) return;
  const key = getItemKey(item);
  if (!key) return;

  recents = recents.filter((r) => getItemKey(r) !== key);
  recents.unshift(item);
  if (recents.length > RECENTS_LIMIT) {
    recents.length = RECENTS_LIMIT;
  }
  saveState();
}

function matchesText(item, text) {
  if (!text) return true;
  const q = text.toLowerCase();

  return (
    (item.title && item.title.toLowerCase().includes(q)) ||
    (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
    (item.path && item.path.toLowerCase().includes(q))
  );
}


// Un SOLO handler del dock (elimínalo si tienes otro)
document.getElementById('dock')?.addEventListener('click', (e) => {
  const b = e.target.closest('.dock-btn');
  if (!b) return;
  const target = b.getAttribute('data-view');
  if (views.includes(target)) switchView(target);
});

// Vista inicial
switchView('search');

document.getElementById('showMiniBtn')?.addEventListener('click', () => {
  window.warp.playerShow();
});

// tooltips (title -> data-tip) para el CSS
document.querySelectorAll('.dock-btn[title]').forEach(btn => {
  const t = btn.getAttribute('title');
  if (t) btn.setAttribute('data-tip', t);
});


// ===== Calculadora simple =====

// ===== Calculadora avanzada (con historial) =====
const calcDisplay = document.getElementById('calc-display');
const calcGrid = document.getElementById('calc-grid');
const calcHistoryEl = document.getElementById('calc-history');

let calc = { cur: '0', prev: null, op: null, justEq: false };
let calcHistory = [];





function inputDigit(d) {
  if (calc.justEq) {
    calc.cur = '0';
    calc.justEq = false;
  }

  if (d === '.') {
    if (!calc.cur.includes('.')) {
      calc.cur += '.';
    }
  } else {
    calc.cur = calc.cur === '0' ? d : calc.cur + d;
  }

}

function compute(a, b, op) {
  if (op === '+') return a + b;
  if (op === '−') return a - b;
  if (op === '×') return a * b;
  if (op === '÷') return b === 0 ? NaN : a / b;
  return b;
}

function setOperator(op) {
  const currentValue = parseFloat(calc.cur);

  if (calc.prev === null) {
    calc.prev = currentValue;
  } else if (!calc.justEq && calc.op) {
    calc.prev = compute(calc.prev, currentValue, calc.op);
    setDisp(String(calc.prev));
  }

  calc.cur = '0';
  calc.op = op;
  calc.justEq = false;
}



// Permite colocar el resultado de una expresión externa (desde el launcher)
function setCalcFromExpression(expr, result) {
  if (typeof result !== 'number' || !Number.isFinite(result)) return;
  calc.cur = String(result);
  calc.prev = null;
  calc.op = null;
  calc.justEq = true;
  appendHistory(expr, result);
}





// Copiar al portapapeles al hacer clic en el display
if (calcDisplay) {
  calcDisplay.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(calc.cur);
      calcDisplay.classList.add('copied');
      setTimeout(() => calcDisplay.classList.remove('copied'), 300);
    } catch (err) {
      console.warn('No se pudo copiar el resultado', err);
    }
  });
}


function inputDigit(d) {
  if (calc.justEq) { calc.cur = '0'; calc.justEq = false; }
  if (d === '.') {
    if (!calc.cur.includes('.')) calc.cur += '.';
  } else {
    calc.cur = calc.cur === '0' ? d : calc.cur + d;
  }
  setDisp(calc.cur);
}

function compute(a, b, op) {
  if (op === '+') return a + b;
  if (op === '−') return a - b;
  if (op === '×') return a * b;
  if (op === '÷') return b === 0 ? NaN : a / b;
  return b;
}

function setOp(op) {
  if (calc.prev === null) {
    calc.prev = parseFloat(calc.cur);
  } else if (!calc.justEq) {
    calc.prev = compute(calc.prev, parseFloat(calc.cur), calc.op);
    setDisp(String(calc.prev));
  }
  calc.cur = '0';
  calc.op = op;
  calc.justEq = false;
}

function equals() {
  if (calc.op === null || calc.prev === null) return;
  const res = compute(calc.prev, parseFloat(calc.cur), calc.op);
  calc.cur = String(res);
  calc.prev = null;
  calc.op = null;
  calc.justEq = true;
  setDisp(calc.cur);
}

function percent() { calc.cur = String(parseFloat(calc.cur) / 100); setDisp(calc.cur); }
function negate()  { if (calc.cur !== '0') { calc.cur = calc.cur.startsWith('-') ? calc.cur.slice(1) : '-' + calc.cur; setDisp(calc.cur); } }
function clearAll(){ calc = { cur: '0', prev: null, op: null, justEq: false }; setDisp(calc.cur); }



// ===== Búsqueda & render =====
async function liveSearchFiles(q) {
  const query = (q || "").trim();

  if (!query || query.length < 2) {
    liveFiles = [];
    renderMerged();
    return;
  }

  try {
    const results = await window.warp.searchFiles(query);
    liveFiles = results || [];
  } catch (err) {
    console.error("Error buscando archivos:", err);
    liveFiles = [];
  }

  renderMerged();
}


function tryEvalExpression(raw) {
  if (!raw) return null;

  const expr = raw
    .replace(/,/g, ".")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .trim();

  if (!expr) return null;
  if (!/[0-9]/.test(expr)) return null;
  if (!/[+\-*/]/.test(expr)) return null;
  if (/[^0-9+\-*/().\s]/.test(expr)) return null;

  try {
    const fn = new Function(`return (${expr})`);
    const result = fn();
    if (typeof result !== "number" || !Number.isFinite(result)) return null;
    return Number(result.toFixed(6));
  } catch {
    return null;
  }
}

function buildInlineCalcItem(q) {
  const res = tryEvalExpression(q);
  if (res === null) return null;

  return {
    kind: "calc-inline",
    title: String(res),
    subtitle: `Resultado de ${q}`,
    data: { expr: q, result: res },
    tag: "CALC"
  };
}


// Parsea el texto de búsqueda y detecta prefijos como app:, file:, cmd:
// Parsea el texto de búsqueda y detecta prefijos como app:, file:, cmd:, fav:, recent:
function parseQuery(raw) {
  let q = (raw || "").trim();
  let filterKind = null;

  const lower = q.toLowerCase();

  const patterns = [
    { prefix: "app:", kind: "app" },
    { prefix: "apps:", kind: "app" },
    { prefix: "file:", kind: "file" },
    { prefix: "files:", kind: "file" },
    { prefix: "cmd:", kind: "command" },
    { prefix: "cmds:", kind: "command" },
    { prefix: "fav:", kind: "favorite" },
    { prefix: "favs:", kind: "favorite" },
    { prefix: "favorite:", kind: "favorite" },
    { prefix: "recent:", kind: "recent" },
    { prefix: "recents:", kind: "recent" }
  ];

  for (const { prefix, kind } of patterns) {
    if (lower.startsWith(prefix)) {
      filterKind = kind;
      q = q.slice(prefix.length).trim();
      break;
    }
  }

  return { text: q, filterKind };
}



function normalizeLiveFiles(list) {
  return (list || [])
    .map((f) => {
      if (typeof f === "string") {
        const pathVal = f;
        return {
          path: pathVal,
          isDir: guessIsDir(pathVal)
        };
      }

      if (f && typeof f === "object") {
        const pathVal = f.path || f.fullPath || "";
        if (!pathVal) return null;

        let isDir;

        if (f.isDir != null) {
          isDir = !!f.isDir;
        } else if (f.isDirectory != null) {
          isDir = !!f.isDirectory;
        } else {
          isDir = guessIsDir(pathVal);
        }

        return {
          path: pathVal,
          isDir
        };
      }

      return null;
    })
    .filter(Boolean);
}


function renderMerged() {
  const q = currentQuery.trim();
  const filterKind = currentFilterKind;
  let allItems = [];

  // === Vista especial: FAVORITOS ===
  if (filterKind === "favorite") {
    let base = favorites.slice();
    if (q) {
      base = base.filter((item) => matchesText(item, q));
    }
    allItems = base.slice(0, 50);

    if (allItems.length === 0) {
      allItems.push({
        kind: "info",
        title: q ? "No se encontraron favoritos con ese término" : "Aún no tienes favoritos",
        subtitle: q
          ? "Prueba con otro texto o quita el prefijo fav:."
          : "Selecciona un item y usa Ctrl+D para marcarlo como favorito.",
        tag: "INFO"
      });
    }

    render(allItems);
    return;
  }

  // === Vista especial: RECIENTES ===
  if (filterKind === "recent") {
    let base = recents.slice();
    if (q) {
      base = base.filter((item) => matchesText(item, q));
    }
    allItems = base.slice(0, 50);

    if (allItems.length === 0) {
      allItems.push({
        kind: "info",
        title: q ? "No hay recientes que coincidan" : "Todavía no has abierto nada",
        subtitle: q
          ? "Prueba con otro texto o quita el prefijo recent:."
          : "Cuando abras apps, archivos o comandos, aparecerán aquí.",
        tag: "INFO"
      });
    }

    render(allItems);
    return;
  }

  let staticItems = [];

  try {
    if (!fuse || !q) {
      // === Caso importante: sin texto y sin filtro -> secciones bonitas ===
      if (!q && !filterKind) {
      const favKeys = new Set(favorites.map(getItemKey));
      const recKeys = new Set(recents.map(getItemKey));

      const favItems = favorites
        .filter((f) => canBePinned(f))
        .slice(0, 10);

      const recentItems = recents
        .filter((r) => canBePinned(r) && !favKeys.has(getItemKey(r)))
        .slice(0, 15);

      const suggestedApps = staticModel
        .filter(
          (i) =>
            i.kind === "app" &&
            !favKeys.has(getItemKey(i)) &&
            !recKeys.has(getItemKey(i))
        )
        .sort(sortByUsageDescThenTitle)
        .slice(0, 10);

      const suggestedOthers = staticModel
        .filter(
          (i) =>
            i.kind !== "app" &&
            !favKeys.has(getItemKey(i)) &&
            !recKeys.has(getItemKey(i))
        )
        .sort(sortByUsageDescThenTitle)
        .slice(0, 15);

      const sections = [];

      if (favItems.length) {
        sections.push({ kind: "section", title: "Favoritos" }, ...favItems);
      }

      if (recentItems.length) {
        sections.push({ kind: "section", title: "Recientes" }, ...recentItems);
      }

      if (suggestedApps.length || suggestedOthers.length) {
        sections.push(
          { kind: "section", title: "Sugeridos" },
          ...suggestedApps,
          ...suggestedOthers
        );
      }

      if (!sections.length) {
        sections.push({
          kind: "info",
          title: "Empieza a usar WarpLaunch",
          subtitle: "Abre algunas apps o archivos para ver recientes y sugerencias aquí.",
          tag: "INFO"
        });
      }

      render(sections);
      return;
    }


      // Sin texto pero con filtro app/file/cmd
      staticItems = staticModel.filter((item) => {
        if (!filterKind) return true;
        return item.kind === filterKind;
      });
    } else {
      // Búsqueda con texto sobre el modelo estático
      const fuseResults = fuse.search(q).slice(0, 40);
      staticItems = fuseResults
        .map((r) => r.item)
        .filter((item) => {
          if (!filterKind) return true;
          return item.kind === filterKind;
        });
    }
  } catch (err) {
    console.error("Error en búsqueda estática:", err);
    staticItems = staticModel.slice(0, 20);
  }

  // Inline calc solo si no hay filtro
  if (!filterKind) {
    const calcInline = buildInlineCalcItem(q);
    if (calcInline) {
      allItems.push(calcInline);
    }
  }

  // Archivos en vivo
  let fileItems = [];
  if (!filterKind || filterKind === "file") {
    const normalizedFiles = normalizeLiveFiles(liveFiles);
    fileItems = normalizedFiles.slice(0, 40).map((f) => {
      const fullPath = f.path;
      const base = fullPath.split(/[\\/]/).pop();
      const isDir = !!f.isDir;

      return {
        kind: "file",
        title: base,
        subtitle: fullPath,
        path: fullPath,
        tag: isDir ? "DIR" : "FILE",
        isDir
      };
    });
  }

  // Composición final cuando sí hay texto o filtro
  if (filterKind === "file") {
    allItems = [...allItems, ...fileItems, ...staticItems];
  } else if (filterKind === "app" || filterKind === "command") {
    allItems = [...allItems, ...staticItems];
  } else {
    const apps = staticItems.filter((i) => i.kind === "app");
    const others = staticItems.filter((i) => i.kind !== "app");

    allItems = [...allItems, ...apps, ...fileItems, ...others];
  }

  if (allItems.length === 0 && q.length > 0) {
    allItems.push({
      kind: "info",
      title: "No se encontraron resultados",
      subtitle: "Prueba con otro término o revisa el filtro (app:, file:, cmd:, fav:, recent:).",
      tag: "INFO"
    });
  }

  render(allItems);
}





function toItem(kind, obj) {
  if (kind === "command") {
    return { 
      kind,
      title: obj.title,
      subtitle: obj.subtitle || obj.run,
      data: obj,
      tag: "COMANDO",
      run: obj.run,
      open: obj.open
    };
  }
  if (kind === "file") {
    return {
      kind,
      title: obj.title,
      subtitle: obj.subtitle || obj.path,
      path: obj.path,
      icon: obj.icon,
      tag: obj.tag || "ARCHIVO"
    };
  }
  if (kind === "app") {
    return {
      kind: "app",
      type: "app",
      title: obj.title,
      subtitle: obj.subtitle,
      run: obj.run,
      open: obj.open,
      icon: obj.icon,
      tag: obj.tag || "APLICACIÓN"
    };
  }
}

function updateActiveItem() {
  const items = resultsEl.querySelectorAll('.item');
  items.forEach((item, index) => item.classList.toggle('active', index === cursor));
}

function isFolderItem(item) {
  if (!item || item.kind !== "file") return false;

  const fullPath = item.path || item.subtitle || "";
  if (!fullPath) return false;

  const parts = fullPath.split(/[\\/]/);
  const last = parts[parts.length - 1];

  // Si termina con separador, lo tratamos como carpeta
  if (!last) return true;

  // Heurística simple: si el último segmento no tiene punto, lo tomamos como carpeta
  return !last.includes(".");
}

// Intenta adivinar si una ruta es carpeta (no es perfecto, pero ayuda)
function guessIsDir(path) {
  if (!path) return false;
  const name = String(path).split(/[\\/]/).pop() || "";

  // Si termina en barra, seguro es carpeta
  if (/[\\/]/.test(path[path.length - 1])) return true;

  // Si no tiene punto en el último segmento, lo tratamos como carpeta
  // Ej: "Documentos", "Proyectos", "Tareas"
  return !name.includes(".");
}



function render(list) {
  currentResults = list;
  resultsEl.innerHTML = "";

  list.forEach((item, i) => {
    // Encabezados de sección
    if (item.kind === "section") {
      const li = document.createElement("li");
      li.className = "item section-header";
      const span = document.createElement("span");
      span.textContent = item.title;
      li.appendChild(span);
      resultsEl.appendChild(li);
      return;
    }

    const fav = isFavorite(item);

    // ===== Meta de archivos: carpeta / zip / pdf / imagen / video / audio / archivo normal =====
    const pathLike = item.path || item.subtitle || item.title || "";
    const lowerPath = String(pathLike).toLowerCase();

    const isDir =
      item.kind === "file"
        ? (item.isDir != null
            ? !!item.isDir
            : guessIsDir(pathLike))
        : false;

    // Inicializamos flags
    let isArchive = false;
    let isPdf = false;
    let isImage = false;
    let isVideo = false;
    let isAudio = false;

    if (item.kind === "file" && !isDir) {
      // Comprimidos
      if (
        lowerPath.endsWith(".zip") ||
        lowerPath.endsWith(".7z") ||
        lowerPath.endsWith(".rar") ||
        lowerPath.endsWith(".tar") ||
        lowerPath.endsWith(".gz") ||
        lowerPath.endsWith(".bz2")
      ) {
        isArchive = true;
      }

      // PDF
      if (lowerPath.endsWith(".pdf")) {
        isPdf = true;
      }

      // Imágenes
      if (
        lowerPath.endsWith(".png") ||
        lowerPath.endsWith(".jpg") ||
        lowerPath.endsWith(".jpeg") ||
        lowerPath.endsWith(".gif") ||
        lowerPath.endsWith(".bmp") ||
        lowerPath.endsWith(".webp") ||
        lowerPath.endsWith(".tif") ||
        lowerPath.endsWith(".tiff") ||
        lowerPath.endsWith(".svg") ||
        lowerPath.endsWith(".ico")
      ) {
        isImage = true;
      }

      // Videos
      if (
        lowerPath.endsWith(".mp4") ||
        lowerPath.endsWith(".mkv") ||
        lowerPath.endsWith(".avi") ||
        lowerPath.endsWith(".mov") ||
        lowerPath.endsWith(".wmv") ||
        lowerPath.endsWith(".flv") ||
        lowerPath.endsWith(".webm")
      ) {
        isVideo = true;
      }

      // Audios
      if (
        lowerPath.endsWith(".mp3") ||
        lowerPath.endsWith(".wav") ||
        lowerPath.endsWith(".flac") ||
        lowerPath.endsWith(".aac") ||
        lowerPath.endsWith(".ogg") ||
        lowerPath.endsWith(".m4a") ||
        lowerPath.endsWith(".wma")
      ) {
        isAudio = true;
      }
    }

    // Guardar de vuelta en el item para siguientes renders / recientes / favs (opcional)
    if (item.kind === "file") {
      if (item.isDir == null) item.isDir = isDir;
      if (item.isArchive == null) item.isArchive = isArchive;
      if (item.isPdf == null) item.isPdf = isPdf;
      if (item.isImage == null) item.isImage = isImage;
      if (item.isVideo == null) item.isVideo = isVideo;
      if (item.isAudio == null) item.isAudio = isAudio;
    }

    const li = document.createElement("li");
    li.className =
      `item${i === cursor ? " active" : ""}` +
      `${item.kind === 'command' ? " command" : ""}` +
      `${item.kind === 'file' ? " file" : ""}` +
      `${item.kind === 'app' ? " app" : ""}` +
      `${item.kind === 'calc-inline' ? " calc-inline" : ""}` +
      `${fav ? " favorite" : ""}`;

    li.dataset.index = i;

    const titleDiv = document.createElement("div");
    titleDiv.className = "title";

    // Icono
    if (item.kind === 'file' || item.kind === 'app' || item.kind === 'calc-inline') {
      const icon = document.createElement("span");
      icon.className = "icon";

      if (item.icon) {
        icon.textContent = item.icon;
      } else if (item.kind === 'file') {
        if (isDir) {
          icon.textContent = '📁';
        } else if (isArchive) {
          icon.textContent = '🗜️';
        } else if (isPdf) {
          icon.textContent = '📕';
        } else if (isImage) {
          icon.textContent = '🖼️';
        } else if (isVideo) {
          icon.textContent = '🎬';
        } else if (isAudio) {
          icon.textContent = '🎵';
        } else {
          icon.textContent = '📄';
        }
      } else if (item.kind === 'app') {
        icon.textContent = '⚙️';
      } else if (item.kind === 'calc-inline') {
        icon.textContent = '🧮';
      }

      titleDiv.appendChild(icon);
    }

    // Estrella de favorito
    if (fav) {
      const star = document.createElement("span");
      star.className = "fav-star";
      star.textContent = "★";
      titleDiv.appendChild(star);
    }

    // Título
    const titleText = document.createElement("span");
    titleText.textContent = item.title;
    titleDiv.appendChild(titleText);

    // Badge
    const badge = document.createElement("span");
    badge.className = "badge";

    let tagText = "";

    if (item.kind === "file") {
      if (isDir) {
        tagText = "CARPETA";
      } else if (isArchive) {
        tagText = "ZIP";
      } else if (isPdf) {
        tagText = "PDF";
      } else if (isImage) {
        tagText = "IMG";
      } else if (isVideo) {
        tagText = "VID";
      } else if (isAudio) {
        tagText = "AUD";
      } else {
        tagText = "FILE";
      }
    } else if (item.tag) {
      tagText = item.tag;
    } else if (item.kind === "command") {
      tagText = "CMD";
    } else if (item.kind === "app") {
      tagText = "APP";
    }

    badge.textContent = tagText;
    titleDiv.appendChild(badge);

    const subtitleDiv = document.createElement("div");
    subtitleDiv.className = "subtitle";
    subtitleDiv.textContent = item.subtitle || item.path || "";

    li.appendChild(titleDiv);
    li.appendChild(subtitleDiv);

    li.addEventListener("mouseenter", () => {
      cursor = i;
      updateActiveItem();
    });

    li.addEventListener("click", () => {
      cursor = i;
      updateActiveItem();
    });

    li.addEventListener("dblclick", () => runItem(item));

    resultsEl.appendChild(li);
  });
}








async function runItem(item) {
  try {
    if (!item) return;
    
    // No hacer nada si es encabezado de sección
    if (item.kind === 'section') {
      return;
    }

    // Cualquier app/archivo/comando que se ejecute se va a "recientes"
    if (canBePinned(item)) {
      addToRecents(item);
      bumpUsage(item);
    }

    if (item.kind === 'command') {
      await window.warp.executeCommand(item.data);
      return;
    }

    if (item.kind === 'file') {
      await window.warp.openItem({ kind: 'file', data: { path: item.path } });
      return;
    }

    if (item.kind === 'app' || item.type === 'app') {
      await window.warp.openItem({
        kind: 'app',
        data: {
          run: item.run ?? item.data?.run,
          openPath: item.open ?? item.data?.open
        }
      });
      return;
    }

    if (item.kind === 'calc-inline') {
      const expr = item.data?.expr || inputEl.value.trim();
      const result = item.data?.result;

      
      if (typeof result === 'number' && typeof setCalcFromExpression === 'function') {
        setCalcFromExpression(expr, result);
      }

      try {
        if (typeof result === 'number') {
          await navigator.clipboard.writeText(String(result));
        }
      } catch (err) {
        console.warn('No se pudo copiar el resultado', err);
      }

      return;
    }

    console.warn('Tipo de item no manejado:', item);
  } catch (error) {
    console.error('Error al ejecutar item:', error);
  }
}

function resetHome() {
  // dejar todo en modo "inicio"
  currentQuery = "";
  currentFilterKind = null;
  liveFiles = [];

  if (inputEl) {
    inputEl.value = "";
  }

  // esto dispara el seccionado: Favoritos / Recientes / Sugeridos
  renderMerged();
}

// ===== Bootstrap =====
async function bootstrap() {
  loadState();
  try {
    const data = await window.warp.bootstrap();

    const commands = (data.commands || []).map(c => toItem("command", c));
    const apps = (data.apps || []).map(a => toItem("app", a));
    staticModel = [...commands, ...apps];

    if (typeof Fuse === 'undefined') throw new Error('Fuse.js no está cargado');

    fuse = new Fuse(staticModel, {
      includeScore: true,
      threshold: 0.4,
      ignoreLocation: true,
      keys: ["title", "subtitle", "tag"]
    });

    resetHome();

    render(staticModel.slice(0, 12));
  } catch (error) {
    console.error('Bootstrap error:', error);
    resultsEl.innerHTML = `
      <li class="item error">
        <div class="title">Error al cargar</div>
        <div class="subtitle">${error.message}</div>
      </li>`;
  }
}



if (window.warp && typeof window.warp.onShow === "function") {
  window.warp.onShow(() => {
    resetHome();
  });
}




// ===== eventos =====
function handleSearchInput(raw) {
  const { text, filterKind } = parseQuery(raw);

  currentQuery = text;
  currentFilterKind = filterKind;

  // Lanzamos búsqueda de archivos solo con el texto (sin el prefijo)
  liveSearchFiles(text);
  // Recalcular resultados combinados
  renderMerged();
}

inputEl.addEventListener("input", () => {
  handleSearchInput(inputEl.value);
});

window.addEventListener("keydown", (e) => {

  if (currentView !== 'search') {
    return;
  }

  const visibleItems = resultsEl.children.length;
  const item = currentResults[cursor] || null;

  // Ctrl + D: alternar favorito del item actual  
  if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    if (item && canBePinned(item)) {
      toggleFavorite(item);
      renderMerged();
    }
    return;
  }

  // Ctrl + F: ir a vista de favoritos (prefijo fav:)
  if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    currentFilterKind = 'favorite';
    currentQuery = '';
    inputEl.value = 'fav:';
    renderMerged();
    return;
  }

  // Ctrl + R: ir a vista de recientes (prefijo recent:)
  if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    currentFilterKind = 'recent';
    currentQuery = '';
    inputEl.value = 'recent:';
    renderMerged();
    return;
  }

  if (visibleItems === 0) return;


  if (e.key === "ArrowDown") {
    e.preventDefault();
    cursor = Math.min(cursor + 1, visibleItems - 1);
    updateActiveItem();
    resultsEl.children[cursor]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    cursor = Math.max(cursor - 1, 0);
    updateActiveItem();
    resultsEl.children[cursor]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === "Enter") {
    e.preventDefault();
    const selected = resultsEl.children[cursor];
    if (!selected) return;
    const index = parseInt(selected.dataset.index, 10);
    const item = currentResults[index];
    if (!item) return;
    inputEl.value = "";
    runItem(item);
  } else if (e.key === "Escape") {
    window.close();
  }
});

// Teclado para la calculadora (solo cuando la vista calc está activa)
window.addEventListener('keydown', (e) => {
  if (currentView !== 'calc') return;

  const key = e.key;

  if ((key >= '0' && key <= '9') || key === '.') {
    e.preventDefault();
    inputDigit(key);
    return;
  }

  if (key === '+' || key === '-' || key === '*' || key === '/') {
    e.preventDefault();
    const map = { '+': '+', '-': '−', '*': '×', '/': '÷' };
    setOperator(map[key]);
    return;
  }

  if (key === 'Enter' || key === '=') {
    e.preventDefault();
    equals();
    return;
  }

  if (key === '%') {
    e.preventDefault();
    percent();
    return;
  }

  if (key === 'Backspace') {
    e.preventDefault();
    if (!calc.justEq && calc.cur.length > 1) {
      calc.cur = calc.cur.slice(0, -1);
    } else {
      calc.cur = '0';
    }
    setDisp(calc.cur);
  }
});


window.warp.focusInput(() => {
  inputEl.focus();
  inputEl.select();
});

// iniciar
bootstrap();
