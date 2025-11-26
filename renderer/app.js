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
// proyectos de tareas
let taskProjects = []; // [{id, name, createdAt}]
let tasksByProject = {}; // { [projectId]: {idea:[], doing:[], done:[]} }
let currentProjectId = null;

// ===== Favoritos y recientes =====
let favorites = [];
let recents = [];
let usage = {};
let tasks = {
  idea: [],
  doing: [],
  done: []
};
const RECENTS_LIMIT = 30;
const STORAGE_KEY = 'warplaunch_state_v1';

// ===== Dock / vistas =====
const dockEl = document.getElementById('dock');
const wrapEl = document.getElementById('wrap');
const viewCalc = document.getElementById('view-calc');
const viewIA = document.getElementById('view-ia');
const viewTasks = document.getElementById('view-tareas');
const tasksBoardEl = document.getElementById('tasks-board');
const addTaskBtn = document.getElementById('btn-add-task');
const taskForm = document.getElementById('task-form');
const taskTitleInput = document.getElementById('task-title-input');
const taskBodyInput = document.getElementById('task-body-input');

// elementos de Tareas
const tasksViewTitle = document.getElementById('tasks-view-title');
const tasksViewSubtitle = document.getElementById('tasks-view-subtitle');
const btnTasksBack = document.getElementById('btn-tasks-back');
const btnAddProject = document.getElementById('btn-add-project');
const btnAddTask = document.getElementById('btn-add-task');

const tasksProjectsView = document.getElementById('tasks-projects-view');
const projectsGridEl = document.getElementById('projects-grid');

const tasksBoardView = document.getElementById('tasks-board-view');

const projectCreateBar = document.getElementById('project-create-bar');
const projectForm = document.getElementById('project-form');
const projectNameInput = document.getElementById('project-name-input');
const btnCancelProject = document.getElementById('btn-cancel-project');

// Modal añadir tarea
const addTaskModal = document.getElementById('add-task-modal');
const btnCancelAddTask = document.getElementById('btn-cancel-add-task');



const views = ['search', 'calc', 'ia', 'tareas'];


// utilidades para mostrar/ocultar...
function showEl(el) { if (el) { el.hidden = false; el.style.display = ''; } }
function hideEl(el) { if (el) { el.hidden = true; el.style.display = 'none'; } }

function switchView(name) {
  currentView = name;

  views.forEach(v => {
    const panel =
      v === 'search'
        ? document.getElementById('wrap')
        : document.getElementById(`view-${v}`);
    const btn = document.querySelector(`#dock [data-view="${v}"]`);

    if (panel) {
      if (v === name) {
        showEl(panel);
      } else {
        hideEl(panel);
      }
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

  if (name === 'tareas') {
    openProjectsView();
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

  console.log('🏗️ Construyendo modelo con', apps.length, 'apps');
  apps.forEach((app, index) => {
    if (index === 0) {
      console.log('🔍 Primera app en buildStaticModel:', app.title, 'iconDataUrl:', !!app.iconDataUrl);
    }
    out.push({
      kind: 'app',
      title: app.title,
      subtitle: app.subtitle || app.path || '',
      tag: 'APP',
      run: app.run || app.path,
      iconDataUrl: app.iconDataUrl,  // Incluir el icono directamente
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

    favorites = Array.isArray(parsed.favorites) ? parsed.favorites : [];
    recents = Array.isArray(parsed.recents) ? parsed.recents : [];
    usage = parsed.usage && typeof parsed.usage === 'object' ? parsed.usage : {};

    if (Array.isArray(parsed.taskProjects)) {
      taskProjects = parsed.taskProjects;
    }

    if (parsed.tasksByProject && typeof parsed.tasksByProject === 'object') {
      tasksByProject = parsed.tasksByProject;
    } else if (parsed.tasks && typeof parsed.tasks === 'object') {
      // migración simple de versión anterior: un proyecto "General"
      const defaultId = 'general';
      taskProjects = [
        {
          id: defaultId,
          name: 'General',
          createdAt: Date.now()
        }
      ];
      tasksByProject = {
        [defaultId]: {
          idea: parsed.tasks.idea || [],
          doing: parsed.tasks.doing || [],
          done: parsed.tasks.done || []
        }
      };
    }
  } catch (err) {
    console.warn('No se pudo cargar el estado:', err);
  }
}

function saveState() {
  try {
    const payload = {
      favorites,
      recents,
      usage,
      taskProjects,
      tasksByProject
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('No se pudo guardar el estado:', err);
  }
}

// ===== Utilidades Tareas / Proyectos =====

const TASK_STATUSES = ['idea', 'doing', 'done'];

function ensureProjectTasks(projectId) {
  if (!tasksByProject[projectId]) {
    tasksByProject[projectId] = {
      idea: [],
      doing: [],
      done: []
    };
  }
  return tasksByProject[projectId];
}

function getCurrentTaskGroups() {
  if (!currentProjectId) return null;
  return ensureProjectTasks(currentProjectId);
}

// ---- Proyectos ----

function createProject(name) {
  const trimmed = (name || '').trim();

  // Validar que el nombre no esté vacío
  if (!trimmed) {
    alert('El nombre del proyecto no puede estar vacío');
    return;
  }

  const project = {
    id:
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8),
    name: trimmed,
    createdAt: Date.now()
  };

  taskProjects.push(project);
  ensureProjectTasks(project.id);
  saveState();
  renderProjects();
  openProjectBoard(project.id);
}

function deleteProject(id) {
  if (!confirm('¿Estás seguro de eliminar este proyecto y todas sus tareas?')) return;
  taskProjects = taskProjects.filter(p => p.id !== id);
  delete tasksByProject[id];
  saveState();
  renderProjects();
}

function renderProjects() {
  if (!projectsGridEl) return;

  projectsGridEl.innerHTML = '';

  // Si no hay proyectos, mostrar mensaje de bienvenida
  if (taskProjects.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 40px 20px;';

    projectsGridEl.appendChild(emptyState);
  } else {
    // cards de proyectos existentes
    taskProjects.forEach(p => {
      const groups = tasksByProject[p.id] || { idea: [], doing: [], done: [] };
      const total =
        (groups.idea?.length || 0) +
        (groups.doing?.length || 0) +
        (groups.done?.length || 0);

      const card = document.createElement('article');
      card.className = 'project-card';
      card.dataset.projectId = p.id;
      card.innerHTML = `
        <div class="project-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div class="project-name" style="margin:0;">${escapeHtml(p.name)}</div>
          <button class="project-delete-btn" data-role="project-delete" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:16px;padding:0 4px;">&times;</button>
        </div>
        <div class="project-meta" style="margin-top:4px;">${total} ${total === 1 ? 'tarea' : 'Proyectos'}</div>
      `;
      projectsGridEl.appendChild(card);
    });
  }

  // card para crear nuevo (siempre visible)
  const newCard = document.createElement('article');
  newCard.className = 'project-card project-card-new';
  newCard.dataset.role = 'project-new';
  newCard.innerHTML = `
    <div class="project-name">＋ Crear nuevo proyecto</div>
    <div class="project-meta">Empieza un tablero vacío</div>
  `;
  projectsGridEl.appendChild(newCard);
}

function openProjectsView() {
  currentProjectId = null;

  if (tasksViewTitle) tasksViewTitle.textContent = 'Proyectos';
  if (tasksViewSubtitle)
    tasksViewSubtitle.textContent = 'Elige un proyecto o crea uno nuevo';

  if (btnTasksBack) btnTasksBack.hidden = true;
  if (btnAddTask) btnAddTask.hidden = true;
  if (btnAddProject) btnAddProject.hidden = false;

  if (tasksProjectsView) {
    tasksProjectsView.hidden = false;
    tasksProjectsView.style.display = ''; // Limpiar estilo inline
  }
  if (tasksBoardView) {
    tasksBoardView.hidden = true;
    tasksBoardView.style.display = ''; // Limpiar estilo inline
  }

  hideProjectCreateBar();
  renderProjects();
}


function showProjectCreateBar() {
  if (!projectCreateBar) return;
  projectCreateBar.hidden = false;
  if (projectNameInput) {
    projectNameInput.focus();
    projectNameInput.select?.();
  }
}

function hideProjectCreateBar() {
  if (!projectCreateBar) return;
  projectCreateBar.hidden = true;
  if (projectNameInput) projectNameInput.value = '';
}


function openProjectBoard(projectId) {
  currentProjectId = projectId;
  const project = taskProjects.find(p => p.id === projectId);

  if (tasksViewTitle) {
    tasksViewTitle.textContent = project ? project.name : 'Proyecto';
  }
  if (tasksViewSubtitle) {
    tasksViewSubtitle.textContent =
      'Arrastra las tareas entre columnas para organizar tu proyecto';
  }

  if (btnTasksBack) btnTasksBack.hidden = false;
  if (btnAddTask) btnAddTask.hidden = false;
  if (btnAddProject) btnAddProject.hidden = true;

  if (tasksProjectsView) {
    tasksProjectsView.hidden = true;
    tasksProjectsView.style.display = ''; // Limpiar estilo inline
  }
  if (tasksBoardView) {
    tasksBoardView.hidden = false;
    tasksBoardView.style.display = ''; // Limpiar estilo inline
  }

  renderTasksBoard();
}

// ---- Tareas dentro de un proyecto ----

function createTask(title, body) {
  const groups = getCurrentTaskGroups();
  if (!groups) return; // sin proyecto no hacemos nada

  const task = {
    id:
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8),
    title: (title || '').trim() || 'Nueva tarea',
    body: (body || '').trim(),
    status: 'idea',
    createdAt: Date.now()
  };

  groups.idea.unshift(task);
  saveState();
  renderTasksBoard();
}

function deleteTask(id) {
  const groups = getCurrentTaskGroups();
  if (!groups) return;

  for (const key of TASK_STATUSES) {
    const list = groups[key];
    if (!Array.isArray(list)) continue;
    const idx = list.findIndex(t => t.id === id);
    if (idx !== -1) {
      list.splice(idx, 1);
      break;
    }
  }
  saveState();
  renderTasksBoard();
}

function moveTaskToStatus(id, status) {
  if (!TASK_STATUSES.includes(status)) return;
  const groups = getCurrentTaskGroups();
  if (!groups) return;

  let task = null;

  for (const key of TASK_STATUSES) {
    const list = groups[key];
    if (!Array.isArray(list)) continue;
    const idx = list.findIndex(t => t.id === id);
    if (idx !== -1) {
      task = list.splice(idx, 1)[0];
      break;
    }
  }

  if (!task) return;

  task.status = status;
  groups[status].unshift(task);

  saveState();
  renderTasksBoard();
}

function editTask(id) {
  const groups = getCurrentTaskGroups();
  if (!groups) return;

  let task = null;
  for (const key of TASK_STATUSES) {
    const list = groups[key];
    if (!Array.isArray(list)) continue;
    const t = list.find(x => x.id === id);
    if (t) {
      task = t;
      break;
    }
  }

  if (!task) return;

  // Usar modal en lugar de prompt
  const modal = document.getElementById('edit-task-modal');
  const titleInput = document.getElementById('edit-task-title');
  const bodyInput = document.getElementById('edit-task-body');
  const btnSave = document.getElementById('btn-save-edit');
  const btnCancel = document.getElementById('btn-cancel-edit');

  if (!modal || !titleInput || !bodyInput || !btnSave || !btnCancel) return;

  titleInput.value = task.title;
  bodyInput.value = task.body || '';
  modal.hidden = false;
  titleInput.focus();
  titleInput.select();

  const save = () => {
    const newTitle = titleInput.value.trim();
    const newBody = bodyInput.value.trim();

    if (newTitle) {
      task.title = newTitle;
      task.body = newBody;
      saveState();
      renderTasksBoard();
    }
    close();
  };

  const close = () => {
    modal.hidden = true;
    btnSave.onclick = null;
    btnCancel.onclick = null;
    modal.onclick = null;
    document.removeEventListener('keydown', handleKeyDown);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      save();
    }
  };

  btnCancel.onclick = close;
  btnSave.onclick = save;

  // Close on click outside modal-content
  modal.onclick = (e) => {
    if (e.target === modal) {
      close();
    }
  };

  // ESC key to close, Ctrl+Enter to save
  document.addEventListener('keydown', handleKeyDown);
}

function renderTasksBoard() {
  const colIdea = document.getElementById('tasks-idea');
  const colDoing = document.getElementById('tasks-doing');
  const colDone = document.getElementById('tasks-done');
  if (!colIdea || !colDoing || !colDone) return;

  const groups = getCurrentTaskGroups();
  if (!groups) {
    colIdea.innerHTML = '';
    colDoing.innerHTML = '';
    colDone.innerHTML = '';
    return;
  }

  colIdea.innerHTML = '';
  colDoing.innerHTML = '';
  colDone.innerHTML = '';

  function makeCard(task) {
    const el = document.createElement('article');
    el.className = 'task-card';
    el.dataset.id = task.id;
    el.draggable = true;
    el.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${task.body ? `<div class="task-body">${escapeHtml(task.body)}</div>` : ''}
      <div class="task-footer">
        <span class="task-footer-hint">Arrastra para cambiar</span>
        <div style="display:flex;gap:4px;">
          <button class="task-edit" data-role="task-edit" style="font-size:10px;padding:2px 6px;">Editar</button>
          <button class="task-delete" data-role="task-delete" style="font-size:10px;padding:2px 6px;">Eliminar</button>
        </div>
      </div>
    `;
    return el;
  }

  function makeEmptyHint(text) {
    const el = document.createElement('div');
    el.className = 'task-empty-hint';
    el.style.cssText = 'padding: 16px; text-align: center; opacity: 0.5; font-size: 12px;';
    el.textContent = text;
    return el;
  }

  const ideaTasks = groups.idea || [];
  const doingTasks = groups.doing || [];
  const doneTasks = groups.done || [];

  if (ideaTasks.length === 0) {
    colIdea.appendChild(makeEmptyHint('Arrastra tareas aquí o crea nuevas ideas'));
  } else {
    ideaTasks.forEach(t => colIdea.appendChild(makeCard(t)));
  }

  if (doingTasks.length === 0) {
    colDoing.appendChild(makeEmptyHint('Arrastra tareas en progreso aquí'));
  } else {
    doingTasks.forEach(t => colDoing.appendChild(makeCard(t)));
  }

  if (doneTasks.length === 0) {
    colDone.appendChild(makeEmptyHint('Arrastra tareas completadas aquí'));
  } else {
    doneTasks.forEach(t => colDone.appendChild(makeCard(t)));
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
function negate() { if (calc.cur !== '0') { calc.cur = calc.cur.startsWith('-') ? calc.cur.slice(1) : '-' + calc.cur; setDisp(calc.cur); } }
function clearAll() { calc = { cur: '0', prev: null, op: null, justEq: false }; setDisp(calc.cur); }



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
    console.log('📦 toItem para app:', obj.title, 'iconDataUrl:', !!obj.iconDataUrl);
    return {
      kind: "app",
      type: "app",
      title: obj.title,
      subtitle: obj.subtitle,
      run: obj.run,
      open: obj.open,
      icon: obj.icon,
      iconDataUrl: obj.iconDataUrl,  // ¡IMPORTANTE! Preservar el iconDataUrl
      tag: obj.tag || "APLICACIÓN",
      data: obj  // También preservar el objeto completo por si acaso
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
      const iconContainer = document.createElement("span");
      iconContainer.className = "icon";

      // Para apps, intentar usar el icono real primero
      if (item.kind === 'app') {
        if (item.iconDataUrl || item.data?.iconDataUrl) {
          // Caso 1: Icono ya disponible (caché o precargado)
          const url = item.iconDataUrl || item.data?.iconDataUrl;
          const img = document.createElement("img");
          img.src = url;
          img.alt = item.title;
          img.style.width = "22px";
          img.style.height = "22px";
          img.style.objectFit = "contain";
          iconContainer.appendChild(img);
        } else {
          // Caso 2: Lazy Loading
          const img = document.createElement("img");
          // Placeholder transparente o spinner
          img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3C/svg%3E";
          img.dataset.path = item.path || item.run;
          img.alt = item.title;
          img.style.width = "22px";
          img.style.height = "22px";
          img.style.objectFit = "contain";
          img.className = "lazy-icon";
          iconContainer.appendChild(img);

          if (iconObserver) iconObserver.observe(img);
        }
      } else if (item.icon) {
        iconContainer.textContent = item.icon;
      } else if (item.kind === 'file') {
        if (isDir) {
          iconContainer.textContent = '📁';
        } else if (isArchive) {
          iconContainer.textContent = '🗜️';
        } else if (isPdf) {
          iconContainer.textContent = '📕';
        } else if (isImage) {
          iconContainer.textContent = '🖼️';
        } else if (isVideo) {
          iconContainer.textContent = '🎬';
        } else if (isAudio) {
          iconContainer.textContent = '🎵';
        } else {
          iconContainer.textContent = '📄';
        }
      } else if (item.kind === 'app') {
        // Fallback a emoji si no hay icono
        console.log('⚠️ Sin icono para app:', item.title, 'iconDataUrl:', item.iconDataUrl);
        iconContainer.textContent = '⚙️';
      } else if (item.kind === 'calc-inline') {
        iconContainer.textContent = '🧮';
      }

      titleDiv.appendChild(iconContainer);
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
// ===== Bootstrap =====
let iconObserver;

async function bootstrap() {
  loadState();

  // Configurar Lazy Loading de iconos
  iconObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const appPath = img.dataset.path;

        if (appPath && !img.dataset.loaded) {
          img.dataset.loaded = "true"; // Evitar múltiples llamadas

          window.warp.getIcon(appPath).then(icon => {
            if (icon) {
              img.src = icon;
              img.classList.remove('lazy-icon');

              // Actualizar modelo para cachear en memoria del renderer
              const item = staticModel.find(i => i.path === appPath || i.run === appPath);
              if (item) item.iconDataUrl = icon;
            } else {
              // Fallback visual mejorado: Mostrar iniciales
              const item = staticModel.find(i => i.path === appPath || i.run === appPath);
              const initials = item ? (item.title || '??').substring(0, 2).toUpperCase() : '??';

              img.style.display = 'none'; // Ocultar imagen rota
              const fallback = document.createElement('div');
              fallback.className = 'icon-fallback';
              fallback.textContent = initials;
              fallback.style.cssText = `
                width: 100%; height: 100%;
                display: flex; align-items: center; justify-content: center;
                background: #444; color: #fff; border-radius: 4px;
                font-size: 10px; font-weight: bold;
              `;
              img.parentElement.appendChild(fallback);
            }
          }).catch(err => {
            console.error('Error pidiendo icono:', err);
            img.style.display = 'none';
            const fallback = document.createElement('div');
            fallback.className = 'icon-fallback';
            fallback.textContent = '⚠️';
            fallback.style.cssText = `
                width: 100%; height: 100%;
                display: flex; align-items: center; justify-content: center;
                font-size: 12px;
              `;
            img.parentElement.appendChild(fallback);
          });

          iconObserver.unobserve(img);
        }
      }
    });
  }, { root: null, rootMargin: "100px" });

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

    // Escuchar actualizaciones progresivas de apps
    if (window.warp.onAppsUpdate) {
      window.warp.onAppsUpdate((newApps) => {
        console.log(`📦 Recibidas ${newApps.length} apps nuevas`);
        const mappedApps = newApps.map(a => toItem("app", a));

        // Añadir solo las que no estén ya (por path)
        const currentPaths = new Set(staticModel.map(i => i.path || i.run));
        let addedCount = 0;

        mappedApps.forEach(app => {
          const key = app.path || app.run;
          if (!currentPaths.has(key)) {
            staticModel.push(app);
            currentPaths.add(key);
            addedCount++;
          }
        });

        if (addedCount > 0) {
          fuse.setCollection(staticModel);
          // Si estamos en Home o buscando, refrescar si es pertinente
          // (Opcional: solo refrescar si el usuario no está escribiendo activamente para no saltar)
          if (!currentQuery) {
            renderMerged();
          }
        }
      });
    }

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

// ===== Eventos de TAREAS =====

// ---- Eventos de PROYECTOS ----

// Botón "Nuevo proyecto" en la cabecera
if (btnAddProject) {
  btnAddProject.addEventListener('click', () => {
    showProjectCreateBar();
  });
}

// Clicks en el grid de proyectos
if (projectsGridEl) {
  projectsGridEl.addEventListener('click', (e) => {
    const newCard = e.target.closest('[data-role="project-new"]');
    if (newCard) {
      showProjectCreateBar();
      return;
    }

    const deleteBtn = e.target.closest('[data-role="project-delete"]');
    if (deleteBtn) {
      e.stopPropagation();
      const card = deleteBtn.closest('.project-card');
      if (card && card.dataset.projectId) {
        deleteProject(card.dataset.projectId);
      }
      return;
    }

    const card = e.target.closest('.project-card');
    if (!card || !card.dataset.projectId) return;
    openProjectBoard(card.dataset.projectId);
  });
}


if (btnTasksBack) {
  btnTasksBack.addEventListener('click', () => {
    openProjectsView();
  });
}

// ---- Eventos de TAREAS (formulario) ----

// Formulario de creación de proyecto
if (projectForm && projectNameInput) {
  projectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = projectNameInput.value.trim();
    if (!name) {
      projectNameInput.focus();
      return;
    }
    createProject(name);
    hideProjectCreateBar();
  });
}

if (btnCancelProject) {
  btnCancelProject.addEventListener('click', () => {
    hideProjectCreateBar();
  });
}


// Helper para cerrar modal de añadir tarea
function closeAddTaskModal() {
  if (addTaskModal) addTaskModal.hidden = true;
  if (taskTitleInput) taskTitleInput.value = '';
  if (taskBodyInput) taskBodyInput.value = '';
}

if (taskForm && taskTitleInput) {
  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = taskTitleInput.value.trim();
    const body = taskBodyInput ? taskBodyInput.value : '';
    if (!title || !currentProjectId) {
      taskTitleInput.focus();
      return;
    }
    createTask(title, body);
    closeAddTaskModal();
  });
}

if (btnAddTask) {
  btnAddTask.addEventListener('click', () => {
    if (!currentProjectId) return;
    if (addTaskModal) {
      addTaskModal.hidden = false;
      // Limpiar inputs anteriores
      if (taskTitleInput) taskTitleInput.value = '';
      if (taskBodyInput) taskBodyInput.value = '';
      setTimeout(() => taskTitleInput?.focus(), 50);
    }
  });
}

if (btnCancelAddTask) {
  btnCancelAddTask.addEventListener('click', closeAddTaskModal);
}

if (addTaskModal) {
  addTaskModal.addEventListener('click', (e) => {
    if (e.target === addTaskModal) closeAddTaskModal();
  });
}

// ---- Drag & drop en el tablero de tareas ----

if (tasksBoardEl) {
  // eliminar tarea
  // eliminar / editar tarea
  tasksBoardEl.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-role="task-delete"]');
    if (deleteBtn) {
      const card = deleteBtn.closest('.task-card');
      if (card) deleteTask(card.dataset.id);
      return;
    }

    const editBtn = e.target.closest('[data-role="task-edit"]');
    if (editBtn) {
      const card = editBtn.closest('.task-card');
      if (card) editTask(card.dataset.id);
      return;
    }
  });

  // drag start
  tasksBoardEl.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.task-card');
    if (!card) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
    card.classList.add('dragging');
  });

  // drag end
  tasksBoardEl.addEventListener('dragend', (e) => {
    const card = e.target.closest('.task-card');
    if (card) card.classList.remove('dragging');
    document
      .querySelectorAll('.tasks-column.drag-over')
      .forEach(col => col.classList.remove('drag-over'));
  });

  // drag over
  tasksBoardEl.addEventListener('dragover', (e) => {
    const column = e.target.closest('.tasks-column');
    if (!column) return;
    e.preventDefault();
    document
      .querySelectorAll('.tasks-column.drag-over')
      .forEach(col => col.classList.remove('drag-over'));
    column.classList.add('drag-over');
  });

  // drop
  tasksBoardEl.addEventListener('drop', (e) => {
    if (!(e.target instanceof Element)) return;
    const column = e.target.closest('.tasks-column');
    if (!column) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const status = column.dataset.status;
    document
      .querySelectorAll('.tasks-column.drag-over')
      .forEach(col => col.classList.remove('drag-over'));
    moveTaskToStatus(id, status);
  });
}





window.addEventListener("keydown", (e) => {

  // ESC en vista de tareas: volver atrás
  if (currentView === 'tareas') {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Si estamos en el board, volver a proyectos
      if (currentProjectId && tasksBoardView && !tasksBoardView.hidden) {
        openProjectsView();
      }
      // Si estamos en proyectos, volver al launcher
      else {
        switchView('search');
      }
      return;
    }
  }

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
