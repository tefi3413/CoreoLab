/* ============================================================
   CHOREO PLANNER — app.js  (Part 1/2: State, Canvas, Dancers)
   ============================================================ */

// ── PALETTE ──────────────────────────────────────────────
const COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#06b6d4',
  '#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f43f5e',
  '#84cc16','#a855f7','#0ea5e9','#fb923c','#4ade80',
  '#facc15','#38bdf8','#c084fc','#fb7185','#34d399',
  '#fbbf24'
];

// ── STATE ─────────────────────────────────────────────────
const state = {
  dancers: [],      // [{id,name,color}]
  moments: [],      // [{id,name,timestamp,positions:{dancerId:{x,y}}}]
  currentMoment: 0,
  editingDancerId: null,
  editingMomentIdx: null,
  dragging: null,   // {dancerId, ox, oy}
  audio: {
    ctx: null, buffer: null, source: null, gainNode: null,
    startTime: 0, pauseOffset: 0, isPlaying: false, duration: 0,
    animFrameId: null
  },
  anim: {
    running: false, frameId: null,
    fromPositions: {}, toPositions: {},
    toIndex: 0, progress: 0, duration: 2000, startTs: 0
  },
  waveformData: null,
  // ── Library navigation ──
  currentFolder: null,   // grupo abierto (referencia)
  currentChoreo: null,   // coreografía abierta (referencia)
  // ── Path (recorridos) ──
  pathMode: false,
  pathSubMode: 'curve',       // 'curve' | 'via'
  activePathDancer: null,     // dancerId en edición
  draggingPath: null,         // {dancerId, kind:'curve'|'via', index}
  dragMomentFrom: null,       // índice del momento que se está arrastrando
  syncMode: true              // reproducir animando en sync con los pins de audio (por defecto ON)
};

let nextId = 1;
const uid = () => String(nextId++);

// ── CANVAS ────────────────────────────────────────────────
const canvas   = document.getElementById('stage-canvas');
const ctx      = canvas.getContext('2d');
const wCanvas  = document.getElementById('waveform-canvas');
const wCtx     = wCanvas.getContext('2d');

let stageZoom = 1;
function applyZoom() {
  const base = canvas.width;                 // tamaño real del dibujo
  canvas.style.width  = (base * stageZoom) + 'px';   // lo MOSTRAMOS más grande
  canvas.style.height = (base * stageZoom) + 'px';
  const lvl = document.getElementById('zoom-level');
  if (lvl) lvl.textContent = Math.round(stageZoom * 100) + '%';
}
function setZoom(z) {
  stageZoom = Math.max(1, Math.min(4, z));   // entre 100% y 400%
  applyZoom();
}

function resizeCanvas() {
  const wrap = document.getElementById('stage-wrapper');
  const r    = wrap.getBoundingClientRect();
  const size = Math.min(r.width - 20, r.height - 10);
  canvas.width  = size;
  canvas.height = size;
  drawStage();
  applyZoom();
}

function drawStage() {
  const w = canvas.width, h = canvas.height;
  // Background
  ctx.fillStyle = '#111128';
  ctx.fillRect(0, 0, w, h);
  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const step = w / 10;
  for (let x = step; x < w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = step; y < h; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  // Column index labels (0 at center, 1-4 each side)
  ctx.font = `bold ${Math.max(10, w * 0.022)}px Inter,sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (let i = 1; i <= 9; i++) {
    const lx = i * step;
    const label = String(Math.abs(i - 5));
    const isCenter = i === 5;
    ctx.fillStyle = isCenter ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.28)';
    ctx.fillText(label, lx, 5);
  }
  // Center cross
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
  ctx.setLineDash([]);
  // Stage border gradient
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, 'rgba(124,58,237,0.12)');
  grad.addColorStop(1, 'rgba(6,182,212,0.05)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Center stage markers
  drawCenterMarkers(ctx, w, h);
  // Dancers
  drawDancers(getCurrentPositions());
  // Capa de recorridos (edición)
  if (state.pathMode) drawPathsLayer();
}

// Draws 3 X markers on center line: fondo (h*0.3), centro (h*0.5), frente (h*0.7)
// Symmetric: 2 grid squares above and below center
function drawCenterMarkers(ctx, w, h) {
  const cx = w / 2;
  const markers = [
    { y: h * 0.30 },  // Centro Fondo  — 2 cuadros arriba
    { y: h * 0.50 },  // Centro Centro — mitad exacta
    { y: h * 0.70 },  // Centro Frente — 2 cuadros abajo
  ];
  const arm = Math.max(6, w * 0.016);
  markers.forEach(({ y }) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,220,80,0.80)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - arm, y - arm); ctx.lineTo(cx + arm, y + arm); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + arm, y - arm); ctx.lineTo(cx - arm, y + arm); ctx.stroke();
    ctx.restore();
  });
}

function drawDancers(positions) {
  const R = Math.max(18, canvas.width * 0.038);
  state.dancers.forEach(d => {
    const pos = positions[d.id];
    if (!pos) return;
    const x = pos.x * canvas.width;
    const y = pos.y * canvas.height;
    // Glow
    const grd = ctx.createRadialGradient(x, y, 0, x, y, R * 1.8);
    grd.addColorStop(0, d.color + '55');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, R * 1.8, 0, Math.PI * 2); ctx.fill();
    // Circle
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Initial
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${R * 0.75}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.name.charAt(0).toUpperCase(), x, y);
    // Name label
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `500 ${R * 0.55}px Inter,sans-serif`;
    ctx.fillText(d.name, x, y + R + 10);
  });
}

function getCurrentPositions() {
  const m = state.moments[state.currentMoment];
  if (!m) return {};
  // Merge: fill missing dancers from earlier moments
  const pos = {};
  state.dancers.forEach(d => {
    if (m.positions[d.id]) { pos[d.id] = m.positions[d.id]; return; }
    for (let i = state.currentMoment - 1; i >= 0; i--) {
      if (state.moments[i].positions[d.id]) { pos[d.id] = state.moments[i].positions[d.id]; return; }
    }
    // Default center
    pos[d.id] = { x: 0.5, y: 0.5 };
  });
  return pos;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpPositions(from, to, t) {
  const result = {};
  state.dancers.forEach(d => {
    const f = from[d.id] || { x: 0.5, y: 0.5 };
    const r = to[d.id]   || { x: 0.5, y: 0.5 };
    result[d.id] = { x: lerp(f.x, r.x, t), y: lerp(f.y, r.y, t) };
  });
  return result;
}

// ── DRAG & DROP ───────────────────────────────────────────
function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - r.left) / r.width,
           y: (src.clientY - r.top)  / r.height };
}

function hitDancer(px, py, positions) {
  const R = Math.max(18, canvas.width * 0.038) / canvas.width;
  for (let i = state.dancers.length - 1; i >= 0; i--) {
    const d = state.dancers[i];
    const p = positions[d.id];
    if (!p) continue;
    const dx = px - p.x, dy = py - p.y;
    if (Math.sqrt(dx*dx + dy*dy) < R * 1.2) return d.id;
  }
  return null;
}

canvas.addEventListener('pointerdown', e => {
  if (state.anim.running) return;
  if (state.pathMode) { handlePathDown(e); return; }
  const p   = canvasPos(e);
  const pos = getCurrentPositions();
  const hit = hitDancer(p.x, p.y, pos);
  if (hit){
	pushUndo();
	state.dragging = { dancerId: hit };
	}
     });
canvas.addEventListener('pointermove', e => {
  if (state.pathMode) { handlePathMove(e); return; }
  if (!state.dragging) return;
  const p = canvasPos(e);
  const cx = Math.max(0.01, Math.min(0.99, p.x));
  const cy = Math.max(0.01, Math.min(0.99, p.y));
  ensureCurrentMoment();
  state.moments[state.currentMoment].positions[state.dragging.dancerId] = { x: cx, y: cy };
  drawStage();
});

canvas.addEventListener('pointerup', () => {
  if (state.pathMode) { handlePathUp(); return; }
  if (state.dragging) { state.dragging = null; save(); }
});
canvas.addEventListener('pointercancel', () => {
  if (state.pathMode) { handlePathUp(); return; }
  if (state.dragging) { state.dragging = null; save(); }
});

function ensureCurrentMoment() {
  if (!state.moments[state.currentMoment]) return;
  // positions already writable
}

// ── DANCERS ───────────────────────────────────────────────
function renderDancerPanel() {
  const list = document.getElementById('dancer-list');
  if (!state.dancers.length) {
    list.innerHTML = `<div class="dancer-empty">Ningún bailarín aún.<br>Presiona <b>+</b> para agregar.</div>`;
    return;
  }
  list.innerHTML = '';
  state.dancers.forEach(d => {
    const el = document.createElement('div');
    el.className = 'dancer-item';
    el.dataset.id = d.id;
    el.innerHTML = `
      <div class="dancer-dot" style="background:${d.color}">${d.name.charAt(0).toUpperCase()}</div>
      <span class="dancer-name">${d.name}</span>
      <div class="dancer-actions">
        <button class="dancer-btn edit" data-id="${d.id}" title="Editar">✎</button>
        <button class="dancer-btn" data-del="${d.id}" title="Eliminar">✕</button>
      </div>`;
    list.appendChild(el);
  });
  list.querySelectorAll('.dancer-btn.edit').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); openEditDancer(b.dataset.id); }));
  list.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); deleteDancer(b.dataset.del); }));
}

function addDancer(name, color) {
  const d = { id: uid(), name, color };
  state.dancers.push(d);
  // Place at center offset
  const off = state.dancers.length * 0.07;
  state.moments.forEach(m => {
    if (!m.positions[d.id]) m.positions[d.id] = { x: 0.5 + off - 0.15, y: 0.5 + off - 0.15 };
  });
  renderDancerPanel(); drawStage(); renderTimeline(); save();
}

function deleteDancer(id) {
  const i = state.dancers.findIndex(d => d.id === id);
  if (i > -1) state.dancers.splice(i, 1);
  const clean = m => { delete m.positions[id]; if (m.paths) delete m.paths[id]; };
  if (state.currentFolder) {
    // Plantel compartido: quitar sus posiciones/recorridos de TODAS las coreos del grupo
    state.currentFolder.choreos.forEach(c => c.moments.forEach(clean));
  } else {
    state.moments.forEach(clean);
  }
  if (state.activePathDancer === id) state.activePathDancer = state.dancers[0] ? state.dancers[0].id : null;
  renderDancerPanel(); drawStage(); save();
}

function openAddDancer() {
  state.editingDancerId = null;
  document.getElementById('modal-dancer-title').textContent = 'Agregar bailarín';
  document.getElementById('dancer-name-input').value = '';
  buildColorGrid(COLORS[Math.floor(Math.random() * COLORS.length)]);
  document.getElementById('modal-dancer').style.display = 'flex';
  document.getElementById('dancer-name-input').focus();
}

function openEditDancer(id) {
  const d = state.dancers.find(x => x.id === id);
  if (!d) return;
  state.editingDancerId = id;
  document.getElementById('modal-dancer-title').textContent = 'Editar bailarín';
  document.getElementById('dancer-name-input').value = d.name;
  buildColorGrid(d.color);
  document.getElementById('modal-dancer').style.display = 'flex';
  document.getElementById('dancer-name-input').focus();
}

function buildColorGrid(selected) {
  const grid = document.getElementById('color-picker-grid');
  grid.innerHTML = '';
  COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'color-swatch' + (c === selected ? ' selected' : '');
    s.style.background = c;
    s.dataset.color = c;
    s.addEventListener('click', () => {
      grid.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      s.classList.add('selected');
    });
    grid.appendChild(s);
  });
}

function getSelectedColor() {
  const s = document.querySelector('.color-swatch.selected');
  return s ? s.dataset.color : COLORS[0];
}

// ── MOMENTS ───────────────────────────────────────────────
function addMoment(name) {
	pushUndo();
  const prev = state.moments[state.moments.length - 1];
  const positions = prev ? JSON.parse(JSON.stringify(prev.positions)) : {};
  // If no prev, place all dancers at center
  state.dancers.forEach(d => {
    if (!positions[d.id]) positions[d.id] = { x: 0.5, y: 0.5 };
  });
  state.moments.push({ id: uid(), name: name || `Momento ${state.moments.length + 1}`, timestamp: null, positions });
  state.currentMoment = state.moments.length - 1;
  renderTimeline(); drawStage(); save();
}

function selectMoment(idx) {
  state.currentMoment = idx;
  renderTimeline(); drawStage();
  if (state.pathMode) renderPathBar();
}

// Inserta un momento nuevo en la posición `at` (0..length)
function insertMoment(at) {
	pushUndo();
  at = Math.max(0, Math.min(state.moments.length, at));
  const refPrev = state.moments[at - 1];   // hereda del momento anterior al punto de inserción
  const positions = refPrev ? JSON.parse(JSON.stringify(refPrev.positions)) : {};
  state.dancers.forEach(d => { if (!positions[d.id]) positions[d.id] = { x: 0.5, y: 0.5 }; });
  const m = { id: uid(), name: `Momento ${state.moments.length + 1}`, timestamp: null, positions };
  state.moments.splice(at, 0, m);
  state.currentMoment = at;
  renderTimeline(); drawStage(); save();
  if (state.pathMode) renderPathBar();
}

// Mueve el momento `from` a la posición `to` (0..length)
function reorderMoment(from, to) {
	pushUndo();
  if (from == null || to == null) return;
  const arr = state.moments;
  if (from < 0 || from >= arr.length) return;
  const curObj = arr[state.currentMoment];
  const [m] = arr.splice(from, 1);
  let insertAt = from < to ? to - 1 : to;
  insertAt = Math.max(0, Math.min(arr.length, insertAt));
  arr.splice(insertAt, 0, m);
  state.currentMoment = arr.indexOf(curObj);
  if (state.currentMoment < 0) state.currentMoment = insertAt;
  renderTimeline(); drawStage(); save();
  if (state.pathMode) renderPathBar();
}

// Título del momento actual, arriba del escenario
function updateMomentLabel() {
  const el = document.getElementById('stage-moment-name');
  if (!el) return;
  const m = state.moments[state.currentMoment];
  el.textContent = m ? `M${state.currentMoment + 1} · ${m.name}` : '—';
}

// Duración (segundos) del traslado para LLEGAR al momento `idx` (propia o valor por defecto)
function momentDurSec(idx) {
  const own = state.moments[idx] && state.moments[idx].duration;
  return (own && own > 0) ? own : parseFloat(document.getElementById('speed-slider').value);
}
// Duración (ms) del traslado hacia `toIndex` (usa la duración propia de ESE momento)
function transitionDurationMs(toIndex) {
  return momentDurSec(toIndex) * 1000;
}

function deleteMoment(idx) {
	pushUndo();
  if (state.moments.length <= 1) return;
  state.moments.splice(idx, 1);
  state.currentMoment = Math.min(state.currentMoment, state.moments.length - 1);
  renderTimeline(); drawStage(); save();
}

function renderTimeline() {
  const container = document.getElementById('timeline-moments');
  container.innerHTML = '';

  const addDivider = at => {
    const dv = document.createElement('div');
    dv.className = 'moment-insert';
    dv.title = 'Insertar un momento aquí';
    dv.innerHTML = '<span>+</span>';
    dv.addEventListener('click', () => insertMoment(at));
    container.appendChild(dv);
  };

  state.moments.forEach((m, i) => {
    addDivider(i);   // separador para insertar antes de esta tarjeta
    const isFirst = i === 0;
    const defSec = parseFloat(document.getElementById('speed-slider').value);
    const card = document.createElement('div');
    card.className = 'moment-card' + (i === state.currentMoment ? ' active' : '');
    const timeStr = m.timestamp !== null ? formatTime(m.timestamp) : '';
    const durHtml = isFirst ? '' : `
      <div class="moment-dur" title="Cuánto dura el traslado para llegar a este momento (arranca en el pin de este momento)">
        <span>⏱</span>
        <input type="number" class="moment-dur-input" min="0.5" step="0.5" value="${m.duration != null ? m.duration : ''}" placeholder="${defSec}">
        <span>s</span>
      </div>`;
    card.innerHTML = `
      <span class="moment-drag" title="Arrastrar para reordenar">⠿</span>
      <span class="moment-number">M${i + 1}</span>
      <span class="moment-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>
      ${durHtml}
      <button class="moment-pin-btn ${m.timestamp !== null ? 'pinned' : ''}" title="${m.timestamp !== null ? 'Quitar el pin (clic en la ✕)' : 'Marcar el tiempo actual de la música'}">
        ${m.timestamp !== null ? `📍 ${timeStr} <span class="pin-x">✕</span>` : '📍 Marcar aquí'}
      </button>
      <button class="moment-del" title="Eliminar todo el momento">🗑</button>`;
    card.addEventListener('click', e => {
      if (e.target.closest('.moment-del') || e.target.closest('.moment-pin-btn') || e.target.closest('.moment-dur')) return;
      if (e.detail === 2) { openEditMoment(i); return; }
      selectMoment(i);
    });
    card.querySelector('.moment-del').addEventListener('click', e => { e.stopPropagation(); deleteMoment(i); });
    card.querySelector('.moment-pin-btn').addEventListener('click', e => { e.stopPropagation(); togglePin(i); });

    // Campo de duración
    const durInput = card.querySelector('.moment-dur-input');
    if (durInput) {
      ['pointerdown', 'click', 'dblclick'].forEach(ev => durInput.addEventListener(ev, e => e.stopPropagation()));
      durInput.addEventListener('change', e => {
        e.stopPropagation();
	      pushUndo();
        const v = parseFloat(e.target.value);
        if (isNaN(v) || v <= 0) delete m.duration; else m.duration = v;
        save();
      });
    }

    // Arrastrar para reordenar (desde la manija ⠿, para no interferir con el input)
    const handle = card.querySelector('.moment-drag');
    handle.draggable = true;
    handle.addEventListener('dragstart', e => {
      state.dragMomentFrom = i;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {}
      try { e.dataTransfer.setDragImage(card, 20, 20); } catch (_) {}
    });
    handle.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      container.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
      state.dragMomentFrom = null;
    });
    card.addEventListener('dragover', e => {
      if (state.dragMomentFrom == null) return;
      e.preventDefault();
      const before = e.offsetX < card.offsetWidth / 2;
      card.classList.toggle('drop-before', before);
      card.classList.toggle('drop-after', !before);
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      const before = card.classList.contains('drop-before');
      card.classList.remove('drop-before', 'drop-after');
      reorderMoment(state.dragMomentFrom, before ? i : i + 1);
    });

    container.appendChild(card);
  });

  // + al final
  const addBtn = document.createElement('div');
  addBtn.className = 'moment-add-btn';
  addBtn.innerHTML = `<span class="moment-add-icon">+</span><span>Momento</span>`;
  addBtn.addEventListener('click', () => addMoment());
  container.appendChild(addBtn);

  document.getElementById('btn-animate').disabled = state.moments.length < 2;
  updateMomentLabel();
  const active = container.querySelector('.moment-card.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center' });
}

function openEditMoment(idx) {
  state.editingMomentIdx = idx;
  document.getElementById('moment-name-input').value = state.moments[idx].name;
  document.getElementById('modal-moment').style.display = 'flex';
  document.getElementById('moment-name-input').focus();
}

function togglePin(idx) {
	pushUndo();
  const m = state.moments[idx];
  if (m.timestamp !== null) {
    m.timestamp = null;
  } else {
    m.timestamp = getCurrentAudioTime();
  }
  renderTimeline(); save();
}

function formatTime(s) {
  if (s === null || s === undefined) return '';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── AUDIO ─────────────────────────────────────────────────
function getCurrentAudioTime() {
  const a = state.audio;
  if (!a.buffer) return 0;
  if (!a.isPlaying) return a.pauseOffset;
  return Math.min(a.ctx.currentTime - a.startTime + a.pauseOffset, a.duration);
}

// ── Persistencia de audio (IndexedDB, para archivos grandes) ──
const AUDIO_DB = 'choreo-audio', AUDIO_STORE = 'tracks';
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(AUDIO_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(AUDIO_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    tx.objectStore(AUDIO_STORE).put(val, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(AUDIO_STORE, 'readonly');
    const rq = tx.objectStore(AUDIO_STORE).get(key);
    rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    tx.objectStore(AUDIO_STORE).delete(key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

async function loadAudioFile(file) {
  const a = state.audio;
  if (a.source) { try { a.source.stop(); } catch(_){} }
  a.isPlaying = false; a.pauseOffset = 0;
  if (!a.ctx) a.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await file.arrayBuffer();
  const bytes = buf.slice(0);                    // copia cruda para guardar (decode "consume" el buffer)
  a.buffer   = await a.ctx.decodeAudioData(buf);
  a.duration = a.buffer.duration;
  a.gainNode = a.ctx.createGain();
  a.gainNode.connect(a.ctx.destination);
  document.getElementById('audio-filename').textContent = file.name;
  document.getElementById('audio-total-time').textContent = formatTime(a.duration);
  document.getElementById('btn-audio-play').disabled = false;
  document.getElementById('btn-audio-stop').disabled = false;
  document.getElementById('waveform-empty').classList.add('hidden');
  buildWaveform();
  updatePlayhead();
  // Guardar la pista dentro de la coreo (IndexedDB) para que persista al salir
  if (state.currentChoreo) {
    try {
      await idbPut('audio:' + state.currentChoreo.id, bytes);
      state.currentChoreo.audioName = file.name;
      persistLibrary();
    } catch (_) {}
  }
}

// Restaura la pista guardada de una coreo (si tiene)
async function loadAudioFromStore(choreo) {
  try {
    const bytes = await idbGet('audio:' + choreo.id);
    if (!bytes || state.currentChoreo !== choreo) return;
    const a = state.audio;
    if (!a.ctx) a.ctx = new (window.AudioContext || window.webkitAudioContext)();
    a.buffer   = await a.ctx.decodeAudioData(bytes.slice(0));
    a.duration = a.buffer.duration;
    a.gainNode = a.ctx.createGain();
    a.gainNode.connect(a.ctx.destination);
    document.getElementById('audio-filename').textContent = choreo.audioName || 'Audio guardado';
    document.getElementById('audio-total-time').textContent = formatTime(a.duration);
    document.getElementById('btn-audio-play').disabled = false;
    document.getElementById('btn-audio-stop').disabled = false;
    document.getElementById('waveform-empty').classList.add('hidden');
    buildWaveform();
    drawWaveform(0);
  } catch (_) {}
}

// Limpia el audio en memoria/UI al cambiar de coreo
function resetAudioForChoreo() {
  const a = state.audio;
  try { if (a.source) a.source.stop(); } catch(_) {}
  cancelAnimationFrame(a.animFrameId);
  a.buffer = null; a.source = null; a.isPlaying = false; a.pauseOffset = 0; a.duration = 0;
  document.getElementById('audio-filename').textContent = 'Sin audio cargado';
  document.getElementById('audio-total-time').textContent = '0:00';
  document.getElementById('audio-current-time').textContent = '0:00';
  document.getElementById('btn-audio-play').disabled = true;
  document.getElementById('btn-audio-stop').disabled = true;
  document.getElementById('waveform-empty').classList.remove('hidden');
  state.waveformData = null;
  const wc = document.getElementById('waveform-canvas');
  if (wc) { const c = wc.getContext('2d'); if (c) c.clearRect(0, 0, wc.width, wc.height); }
}

function buildWaveform() {
  const raw    = state.audio.buffer.getChannelData(0);
  const count  = 600;
  const block  = Math.floor(raw.length / count);
  const data   = [];
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = 0; j < block; j++) sum += Math.abs(raw[i * block + j]);
    data.push(sum / block);
  }
  const max = Math.max(...data) || 1;
  state.waveformData = data.map(v => v / max);
  drawWaveform(0);
}

function drawWaveform(currentTime) {
  const data = state.waveformData;
  if (!data) return;
  const W = wCanvas.width, H = wCanvas.height;
  wCtx.clearRect(0, 0, W, H);

  const dur   = state.audio.duration || 1;
  const playX = (currentTime / dur) * W;
  const barW  = Math.max(1, W / data.length - 0.5);

  data.forEach((v, i) => {
    const x    = (i / data.length) * W;
    const barH = v * H * 0.85;
    const y    = (H - barH) / 2;
    // Color: played vs unplayed
    const played = x < playX;
    const grd = wCtx.createLinearGradient(0, y, 0, y + barH);
    if (played) {
      grd.addColorStop(0, '#a78bfa');
      grd.addColorStop(1, '#06b6d4');
    } else {
      grd.addColorStop(0, 'rgba(100,80,180,0.4)');
      grd.addColorStop(1, 'rgba(30,50,90,0.4)');
    }
    wCtx.fillStyle = grd;
    wCtx.fillRect(x, y, barW, barH);
  });

  // Moment markers
  state.moments.forEach((m, i) => {
    if (m.timestamp === null) return;
    const mx = (m.timestamp / dur) * W;
    const active = i === state.currentMoment;
    wCtx.strokeStyle = active ? '#a78bfa' : 'rgba(167,139,250,0.5)';
    wCtx.lineWidth   = active ? 2 : 1;
    wCtx.beginPath(); wCtx.moveTo(mx, 0); wCtx.lineTo(mx, H); wCtx.stroke();
    // Label
    wCtx.fillStyle = active ? '#a78bfa' : 'rgba(167,139,250,0.6)';
    wCtx.font = '10px Inter,sans-serif';
    wCtx.textAlign = 'center';
    wCtx.fillText(`M${i+1}`, mx, 10);
  });

  // Playhead
  wCtx.strokeStyle = '#fff';
  wCtx.lineWidth   = 1.5;
  wCtx.beginPath(); wCtx.moveTo(playX, 0); wCtx.lineTo(playX, H); wCtx.stroke();
}

function updatePlayhead() {
  const t = getCurrentAudioTime();
  drawWaveform(t);
  document.getElementById('audio-current-time').textContent = formatTime(t);
  if (state.audio.isPlaying) {
    if (state.syncMode) renderSyncedFrame(t);   // animar suave siguiendo los pins
    else                syncMomentToAudio(t);    // saltar de formación (modo clásico)
    state.audio.animFrameId = requestAnimationFrame(updatePlayhead);
  }
}

function syncMomentToAudio(t) {
  // Find latest moment whose timestamp <= t
  let best = -1, bestT = -1;
  state.moments.forEach((m, i) => {
    if (m.timestamp !== null && m.timestamp <= t && m.timestamp > bestT) {
      best = i; bestT = m.timestamp;
    }
  });
  if (best !== -1 && best !== state.currentMoment) {
    selectMoment(best);
  }
}

// Interpola las posiciones para el tiempo de audio `t`.
// Modelo: el traslado HACIA un momento arranca EN el pin de ese momento (no antes),
// dura lo que definiste, y al llegar espera en esa formación hasta el pin del próximo.
function computeSyncPositions(t) {
  const pins = [];
  state.moments.forEach((m, i) => { if (m.timestamp != null) pins.push({ i, t: m.timestamp }); });
  pins.sort((a, b) => a.t - b.t);
  if (!pins.length) return null;
  const holdAt = idx => ({ activeIdx: idx, positions: getFullPositions(idx), holding: true });

  if (t < pins[0].t) return holdAt(pins[0].i);   // antes del primer pin: en la formación de arranque

  // último pin alcanzado
  let k = 0;
  for (let i = 0; i < pins.length; i++) { if (pins[i].t <= t) k = i; else break; }
  if (k === 0) return holdAt(pins[0].i);          // primer pin = arranque, sin traslado previo

  const src = pins[k - 1], dest = pins[k];        // el pin de dest DISPARÓ el traslado src→dest
  const nextT = (k + 1 < pins.length) ? pins[k + 1].t : Infinity;
  const D = Math.min(momentDurSec(dest.i), nextT - dest.t);  // dura lo definido, sin pisar el próximo pin
  const moveEnd = dest.t + D;
  const fromPos = getFullPositions(src.i), toPos = getFullPositions(dest.i);
  const adjacent = dest.i === src.i + 1;          // respeta el recorrido si son consecutivos
  const polys = adjacent ? buildTransitionPaths(fromPos, toPos, dest.i) : straightPolys(fromPos, toPos);

  if (t >= moveEnd) {
    // Ya llegó a dest; espera ahí hasta el próximo pin
    return { activeIdx: dest.i, positions: positionsAlongPaths(polys, 1), polys, holding: true };
  }
  const prog = D > 0 ? (t - dest.t) / D : 1;       // arranca en dest.t (el pin de dest)
  return { activeIdx: dest.i, positions: positionsAlongPaths(polys, Math.max(0, Math.min(1, prog))), polys };
}
function straightPolys(fromPos, toPos) {
  const out = {};
  state.dancers.forEach(d => { out[d.id] = [fromPos[d.id] || { x: .5, y: .5 }, toPos[d.id] || { x: .5, y: .5 }]; });
  return out;
}
function renderSyncedFrame(t) {
  const r = computeSyncPositions(t);
  if (!r) { syncMomentToAudio(t); return; }   // sin pins: caer al modo clásico
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawStageBackground();
  drawDancers(r.positions);
  document.querySelectorAll('.moment-card').forEach((c, i) => c.classList.toggle('animating', i === r.activeIdx));
  const el = document.getElementById('stage-moment-name');
  if (el && state.moments[r.activeIdx]) el.textContent = `M${r.activeIdx + 1} · ${state.moments[r.activeIdx].name}`;
}

function playAudio() {
  const a = state.audio;
  if (!a.buffer) return;
  if (a.ctx.state === 'suspended') a.ctx.resume();
  if (a.source) { try { a.source.stop(); } catch(_){} }
  a.source = a.ctx.createBufferSource();
  a.source.buffer = a.buffer;
  a.source.connect(a.gainNode);
  a.startTime  = a.ctx.currentTime;
  a.source.start(0, a.pauseOffset);
  a.isPlaying  = true;
  a.source.onended = () => {
    if (a.isPlaying) { a.pauseOffset = 0; a.isPlaying = false; updateAudioUI(); }
  };
  updateAudioUI();
  updatePlayhead();
}

function pauseAudio() {
  const a = state.audio;
  if (!a.isPlaying) return;
  a.pauseOffset = getCurrentAudioTime();
  try { a.source.stop(); } catch(_) {}
  a.isPlaying = false;
  cancelAnimationFrame(a.animFrameId);
  updateAudioUI();
  drawWaveform(a.pauseOffset);
}

function stopAudio() {
  const a = state.audio;
  try { a.source.stop(); } catch(_) {}
  a.isPlaying = false; a.pauseOffset = 0;
  cancelAnimationFrame(a.animFrameId);
  updateAudioUI();
  drawWaveform(0);
  document.getElementById('audio-current-time').textContent = '0:00';
  if (state.syncMode) { renderTimeline(); drawStage(); }   // limpiar resaltados de sync
}

function updateAudioUI() {
  const btn = document.getElementById('btn-audio-play');
  btn.textContent = state.audio.isPlaying ? '⏸' : '▶';
}

wCanvas.addEventListener('click', e => {
  const a = state.audio;
  if (!a.buffer) return;
  const r  = wCanvas.getBoundingClientRect();
  const px = (e.clientX - r.left) / wCanvas.width;
  const t  = px * a.duration;
  const wasPlaying = a.isPlaying;
  if (wasPlaying) { try { a.source.stop(); } catch(_){} a.isPlaying = false; }
  a.pauseOffset = t;
  if (wasPlaying) playAudio(); else drawWaveform(t);
  document.getElementById('audio-current-time').textContent = formatTime(t);
});

// ── ANIMATION ─────────────────────────────────────────────
function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

function startAnimation() {
  if (state.moments.length < 2) return;
  const an = state.anim;
  an.running  = true;
  an.toIndex  = 1;
  an.duration = transitionDurationMs(1);
  an.fromPositions = getFullPositions(0);
  an.toPositions   = getFullPositions(1);
  an.polys         = buildTransitionPaths(an.fromPositions, an.toPositions, 1);
  an.startTs  = performance.now();
  document.getElementById('btn-animate').textContent = '⏹ Detener';
  animFrame(performance.now());
}

function stopAnimation() {
  const an = state.anim;
  cancelAnimationFrame(an.frameId);
  an.running = false;
  document.getElementById('btn-animate').textContent = '▶ Animar';
  renderTimeline();
  drawStage();
}

function animFrame(now) {
  const an = state.anim;
  if (!an.running) return;
  const elapsed  = now - an.startTs;
  const progress = Math.min(1, elapsed / an.duration);
  const t        = easeInOut(progress);

  // Highlight card
  document.querySelectorAll('.moment-card').forEach((c, i) => {
    c.classList.toggle('animating', i === an.toIndex);
    c.classList.toggle('active', false);
  });

  const positions = positionsAlongPaths(an.polys, t);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawStageBackground();
  drawDancers(positions);

  if (progress >= 1) {
    // Move to next moment
    state.currentMoment = an.toIndex;
    updateMomentLabel();
    const next = an.toIndex + 1;
    if (next >= state.moments.length) {
      stopAnimation();
      return;
    }
    an.fromPositions = getFullPositions(an.toIndex);
    an.toIndex       = next;
    an.toPositions   = getFullPositions(next);
    an.polys         = buildTransitionPaths(an.fromPositions, an.toPositions, next);
    an.duration      = transitionDurationMs(next);
    an.startTs       = now;
  }
  an.frameId = requestAnimationFrame(animFrame);
}

function drawStageBackground() {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#111128';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const step = w / 10;
  for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y = step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  // Column index labels
  ctx.font = `bold ${Math.max(10, w * 0.022)}px Inter,sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (let i = 1; i <= 9; i++) {
    const lx = i * step;
    const label = String(Math.abs(i - 5));
    const isCenter = i === 5;
    ctx.fillStyle = isCenter ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.28)';
    ctx.fillText(label, lx, 5);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4,6]);
  ctx.beginPath(); ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
  ctx.setLineDash([]);
  const grad = ctx.createLinearGradient(0,h,0,0);
  grad.addColorStop(0,'rgba(124,58,237,0.12)');
  grad.addColorStop(1,'rgba(6,182,212,0.05)');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,w,h);
  drawCenterMarkers(ctx, w, h);
}

function getFullPositions(momentIdx) {
  const m = state.moments[momentIdx];
  if (!m) return {};
  const pos = {};
  state.dancers.forEach(d => {
    if (m.positions[d.id]) { pos[d.id] = m.positions[d.id]; return; }
    for (let i = momentIdx - 1; i >= 0; i--) {
      if (state.moments[i].positions[d.id]) { pos[d.id] = state.moments[i].positions[d.id]; return; }
    }
    pos[d.id] = { x: 0.5, y: 0.5 };
  });
  return pos;
}

// ============================================================
//  LIBRARY — Grupos + Coreografías  (persistencia y navegación)
// ============================================================
const LIB_KEY = 'choreo-library-v1';
const library = { folders: [] };   // { folders:[ {id,name,dancers:[],choreos:[{id,name,moments:[],createdAt,updatedAt}]} ] }

function persistLibrary() {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify({ folders: library.folders, nextId }));
  } catch (_) {}
}

function loadLibrary() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    library.folders = d.folders || [];
    nextId = d.nextId || 1;
    return true;
  } catch (_) { return false; }
}

// Migra datos antiguos (una sola coreo) a un grupo por defecto
function migrateOld() {
  try {
    const raw = localStorage.getItem('choreo-planner');
    if (!raw) return false;
    const d = JSON.parse(raw);
    const hasData = (d.dancers && d.dancers.length) || (d.moments && d.moments.length);
    if (!hasData) return false;
    if (d.nextId) nextId = Math.max(nextId, d.nextId);
    library.folders.push({
      id: uid(), name: 'Mi grupo', createdAt: Date.now(),
      dancers: d.dancers || [],
      choreos: [{
        id: uid(), name: 'Coreografía 1',
        moments: (d.moments && d.moments.length) ? d.moments
               : [{ id: uid(), name: 'Inicio', timestamp: null, positions: {} }],
        createdAt: Date.now(), updatedAt: Date.now()
      }]
    });
    persistLibrary();
    return true;
  } catch (_) { return false; }
}

// ── Guardado de la coreo abierta ──────────────────────────
function save() {
  if (state.currentFolder && state.currentChoreo) {
    state.currentFolder.dancers = state.dancers;   // plantel compartido del grupo
    state.currentChoreo.moments = state.moments;
    state.currentChoreo.updatedAt = Date.now();
  }
  persistLibrary();
}

// ── NAVEGACIÓN ────────────────────────────────────────────

function setEditorHeader(inEditor) {
  document.getElementById('btn-back-lib').style.display = inEditor ? '' : 'none';
  document.getElementById('btn-save').style.display     = inEditor ? '' : 'none';
  document.getElementById('btn-undo').style.display     = inEditor ? '' : 'none';
  document.getElementById('btn-export').style.display   = inEditor ? '' : 'none';
  const title = document.getElementById('header-title');
  const sub   = document.getElementById('header-subtitle');
  const center = document.getElementById('header-center');
  if (inEditor && state.currentFolder && state.currentChoreo) {
    if (title) title.textContent = state.currentFolder.name;
    if (sub)   sub.textContent   = "";
    if (center) center.textContent = state.currentFolder.name + ' · ' + state.currentChoreo.name;
  } else {
    if (title) title.textContent = 'CoreoLab';
    if (sub)   sub.textContent   = '';
    if (center) center.textContent = '';
  }
}
function showLibraryView() {
  document.getElementById('library-view').style.display = 'flex';
  setEditorHeader(false);
}
function hideLibraryView() {
  document.getElementById('library-view').style.display = 'none';
  setEditorHeader(true);
}
function goToFolders() {
  state.currentFolder = null;
  state.currentChoreo = null;
  showLibraryView();
  renderLibrary();
}
function openFolder(folder) {
  state.currentFolder = folder;
  state.currentChoreo = null;
  showLibraryView();
  renderLibrary();
}
function backToLibrary() {
  save();                        // auto-guarda al salir del editor
  state.currentChoreo = null;
  showLibraryView();
  renderLibrary();               // vuelve al listado del grupo actual
}

// ── FOLDERS (grupos) ──────────────────────────────────────
function createFolder(name) {
  const folder = { id: uid(), name, dancers: [], choreos: [], createdAt: Date.now() };
  library.folders.push(folder);
  persistLibrary();
  openFolder(folder);
}
function deleteFolder(folder) {
  library.folders = library.folders.filter(f => f !== folder);
  persistLibrary();
  goToFolders();
}
function renameFolder(folder, name) {
  folder.name = name;
  if (state.currentFolder === folder) setEditorHeader(document.getElementById('library-view').style.display === 'none');
  persistLibrary();
  renderLibrary();
}

// ── CHOREOS ───────────────────────────────────────────────
function createChoreo(folder, name) {
  const choreo = {
    id: uid(), name,
    moments: [{ id: uid(), name: 'Inicio', timestamp: null, positions: {} }],
    createdAt: Date.now(), updatedAt: Date.now()
  };
  folder.choreos.push(choreo);
  persistLibrary();
  openChoreo(folder, choreo);
}
function deleteChoreo(folder, choreo) {
  folder.choreos = folder.choreos.filter(c => c !== choreo);
  try { idbDel('audio:' + choreo.id); } catch (_) {}
  persistLibrary();
  renderLibrary();
}
function renameChoreo(choreo, name) {
  choreo.name = name;
  choreo.updatedAt = Date.now();
  persistLibrary();
  renderLibrary();
}
function openChoreo(folder, choreo) {
  state.currentFolder = folder;
  state.currentChoreo = choreo;
  state.dancers = folder.dancers;    // referencia al plantel del grupo
  state.moments = choreo.moments;    // referencia a las formaciones de la coreo
  state.currentMoment = 0;
  stopAnimation();
  // Reset del modo recorrido
  state.pathMode = false;
  state.draggingPath = null;
  state.activePathDancer = folder.dancers[0] ? folder.dancers[0].id : null;
  const pt = document.getElementById('path-toolbar'); if (pt) pt.style.display = 'none';
  const bp = document.getElementById('btn-paths'); if (bp) bp.classList.remove('active-toggle');
  const bs = document.getElementById('btn-sync'); if (bs) bs.classList.toggle('active-toggle', state.syncMode);
  // Audio propio de la coreo
  resetAudioForChoreo();
  if (choreo.audioName) loadAudioFromStore(choreo);
  hideLibraryView();
  resizeCanvas();
  renderDancerPanel();
  renderTimeline();
  drawStage();
}

// ── RENDER ────────────────────────────────────────────────
function renderLibrary() {
  if (!state.currentFolder) renderFolders();
  else renderChoreos(state.currentFolder);
}

function renderFolders() {
  document.getElementById('lib-title').innerHTML = '<img src="nombre.png" alt="CoreoLab" style="height:28px;width:auto;vertical-align:middle;margin-right:10px">Biblioteca';
  document.getElementById('lib-back').style.display = 'none';
  document.getElementById('lib-add').textContent = '+ Nuevo grupo';
  const body = document.getElementById('lib-body');
  body.innerHTML = '';
  if (!library.folders.length) {
    body.innerHTML = `<div class="lib-empty">Todavía no hay grupos.<br>Creá tu primer grupo de baile con <b>+ Nuevo grupo</b>.</div>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'lib-grid';
  library.folders.forEach(folder => {
    const dots = folder.dancers.slice(0, 8).map(d =>
      `<span class="mini-dot" style="background:${d.color}"></span>`).join('');
    const card = document.createElement('div');
    card.className = 'lib-card folder-card';
    card.innerHTML = `
      <div class="lib-card-icon">📁</div>
      <div class="lib-card-body">
        <div class="lib-card-title" title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</div>
        <div class="lib-card-meta">${folder.choreos.length} coreo${folder.choreos.length===1?'':'s'} · ${folder.dancers.length} ${folder.dancers.length===1?'bailarín':'bailarines'}</div>
        <div class="mini-dots">${dots}</div>
      </div>
      <div class="lib-card-actions">
        <button class="lib-mini-btn" data-act="rename" title="Renombrar">✎</button>
        <button class="lib-mini-btn danger" data-act="delete" title="Eliminar">🗑</button>
      </div>`;
    card.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'rename')
          askName('Renombrar grupo', 'Nombre del grupo', folder.name, n => renameFolder(folder, n));
        else
          askConfirm('¿Eliminar grupo?', `Se eliminará "${folder.name}" con sus ${folder.choreos.length} coreografía(s). No se puede deshacer.`, 'Eliminar', () => deleteFolder(folder));
        return;
      }
      openFolder(folder);
    });
    grid.appendChild(card);
  });
  body.appendChild(grid);
}

function renderChoreos(folder) {
  document.getElementById('lib-title').textContent = folder.name;
  document.getElementById('lib-back').style.display = '';
  document.getElementById('lib-add').textContent = '+ Nueva coreografía';
  const body = document.getElementById('lib-body');
  body.innerHTML = '';

  // Plantel del grupo
  const roster = document.createElement('div');
  roster.className = 'roster-summary';
  if (folder.dancers.length) {
    roster.innerHTML = `<span class="roster-label">Plantel del grupo:</span>` +
      folder.dancers.map(d =>
        `<span class="roster-chip"><span class="mini-dot" style="background:${d.color}"></span>${escapeHtml(d.name)}</span>`).join('');
  } else {
    roster.innerHTML = `<span class="roster-label">Sin bailarines todavía — los agregás al abrir una coreografía y quedan fijos para todo el grupo.</span>`;
  }
  body.appendChild(roster);

  if (!folder.choreos.length) {
    const empty = document.createElement('div');
    empty.className = 'lib-empty';
    empty.innerHTML = `Este grupo no tiene coreografías.<br>Creá una con <b>+ Nueva coreografía</b>.`;
    body.appendChild(empty);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'lib-grid';
  folder.choreos.forEach(choreo => {
    const card = document.createElement('div');
    card.className = 'lib-card choreo-card';
    card.innerHTML = `
      <div class="lib-card-icon">💃</div>
      <div class="lib-card-body">
        <div class="lib-card-title" title="${escapeHtml(choreo.name)}">${escapeHtml(choreo.name)}</div>
        <div class="lib-card-meta">${choreo.moments.length} ${choreo.moments.length===1?'formación':'formaciones'} · ${formatDate(choreo.updatedAt)}</div>
      </div>
      <div class="lib-card-actions">
        <button class="lib-mini-btn" data-act="rename" title="Renombrar">✎</button>
	<button class="lib-mini-btn" data-act="share" title="Compartir">📤</button>
        <button class="lib-mini-btn danger" data-act="delete" title="Eliminar">🗑</button>
      </div>`;
    card.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'rename')
          askName('Renombrar coreografía', 'Nombre', choreo.name, n => renameChoreo(choreo, n));
	else if (act.dataset.act === 'share')
          shareChoreo(folder, choreo);
        else
          askConfirm('¿Eliminar coreografía?', `Se eliminará "${choreo.name}".`, 'Eliminar', () => deleteChoreo(folder, choreo));
        return;
      }
      openChoreo(folder, choreo);
    });
    grid.appendChild(card);
  });
  body.appendChild(grid);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

// ── MODALES GENÉRICOS (nombre / confirmar) ────────────────
let _nameCb = null;
function askName(title, label, initial, cb) {
  document.getElementById('modal-name-title').textContent = title;
  document.getElementById('modal-name-label').textContent = label;
  const input = document.getElementById('modal-name-input');
  input.value = initial || '';
  _nameCb = cb;
  document.getElementById('modal-name').style.display = 'flex';
  setTimeout(() => { input.focus(); input.select(); }, 30);
}
let _confirmCb = null;
function askConfirm(title, desc, btnLabel, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-desc').textContent = desc;
  document.getElementById('btn-yes-confirm').textContent = btnLabel || 'Confirmar';
  _confirmCb = cb;
  document.getElementById('modal-confirm').style.display = 'flex';
}

// ── TOAST ─────────────────────────────────────────────────
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1500);
}

// ── IMPORTAR / EXPORTAR ───────────────────────────────────
function downloadJSON(data, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = filename.replace(/[\/\\:*?"<>|]/g, '_');
  a.click();
}
function exportChoreo() {
  if (!state.currentChoreo) return;
  const data = JSON.stringify({
    tipo: 'coreo',                        // marca que es UNA coreo (no la biblioteca)
    name: state.currentChoreo.name,
    dancers: state.dancers,
    moments: state.moments
  }, null, 2);
  downloadJSON(data, `${state.currentFolder.name}-${state.currentChoreo.name}.json`);
}

function exportLibrary() {
  downloadJSON(JSON.stringify({ folders: library.folders, nextId }, null, 2), 'choreo-biblioteca.json');
}
function remapFolder(f) {
  const dmap = {};
  const dancers = (f.dancers || []).map(d => {
    const nid = uid(); dmap[d.id] = nid;
    return { id: nid, name: d.name, color: d.color };
  });
  const choreos = (f.choreos || []).map(c => ({
    id: uid(), name: c.name || 'Coreografía',
    createdAt: c.createdAt || Date.now(), updatedAt: Date.now(),
    moments: (c.moments || []).map(m => {
      const positions = {};
      Object.keys(m.positions || {}).forEach(k => { const nk = dmap[k]; if (nk) positions[nk] = m.positions[k]; });
	    const paths = {};
      Object.keys(m.paths || {}).forEach(k => { const nk = dmap[k]; if (nk) paths[nk] = m.paths[k]; });
    return { id: uid(), name: m.name, timestamp: (m.timestamp != null ? m.timestamp : null), duration: m.duration, positions, paths };
    })
  }));
  return { id: uid(), name: f.name || 'Grupo importado', dancers, choreos, createdAt: Date.now() };
}
function importLibraryFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.tipo === 'coreo') {
        const folderLike = {
          name: data.name || 'Coreo importada',
          dancers: data.dancers || [],
          choreos: [{ name: data.name || 'Coreografía', moments: data.moments || [] }]
        };
        library.folders.push(remapFolder(folderLike));
      } else {
        const folders = data.folders
          ? data.folders
          : [{ name: data.name || 'Grupo importado', dancers: data.dancers || [],
               choreos: [{ name: data.name || 'Coreografía importada', moments: data.moments || [] }] }];
        folders.forEach(f => library.folders.push(remapFolder(f)));
      }
      persistLibrary();
      goToFolders();
      toast('Importado ✓');
    } catch (_) { alert('Archivo JSON inválido.'); }
  };
  reader.readAsText(file);
}

// ── RESIZE WAVEFORM CANVAS ────────────────────────────────
function resizeWaveform() {
  const wrap = document.getElementById('waveform-wrap');
  const r    = wrap.getBoundingClientRect();
  wCanvas.width  = r.width  - 28;
  wCanvas.height = r.height - 8;
  if (state.waveformData) drawWaveform(getCurrentAudioTime());
}

// ── EVENT WIRING ──────────────────────────────────────────
document.getElementById('btn-add-dancer').addEventListener('click', openAddDancer);

document.getElementById('btn-confirm-dancer').addEventListener('click', () => {
  const name = document.getElementById('dancer-name-input').value.trim();
  if (!name) return;
  const color = getSelectedColor();
  if (state.editingDancerId) {
    const d = state.dancers.find(x => x.id === state.editingDancerId);
    if (d) { d.name = name; d.color = color; }
    renderDancerPanel(); drawStage(); save();
  } else {
    addDancer(name, color);
  }
  document.getElementById('modal-dancer').style.display = 'none';
});

document.getElementById('btn-cancel-dancer').addEventListener('click', () => {
  document.getElementById('modal-dancer').style.display = 'none';
});
document.getElementById('dancer-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-confirm-dancer').click();
  if (e.key === 'Escape') document.getElementById('btn-cancel-dancer').click();
});

document.getElementById('btn-add-moment').addEventListener('click', () => addMoment());
document.getElementById('stage-moment-edit').addEventListener('click', () => {
  if (state.moments[state.currentMoment]) openEditMoment(state.currentMoment);
});
document.getElementById('stage-moment-name').addEventListener('click', () => {
  if (state.moments[state.currentMoment]) openEditMoment(state.currentMoment);
});

document.getElementById('btn-confirm-moment').addEventListener('click', () => {
  const name = document.getElementById('moment-name-input').value.trim();
  if (!name) return;
  if (state.editingMomentIdx !== null) {
    state.moments[state.editingMomentIdx].name = name;
    renderTimeline(); save();
  }
  document.getElementById('modal-moment').style.display = 'none';
  state.editingMomentIdx = null;
});
document.getElementById('btn-cancel-moment').addEventListener('click', () => {
  document.getElementById('modal-moment').style.display = 'none';
});
document.getElementById('moment-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-confirm-moment').click();
  if (e.key === 'Escape') document.getElementById('btn-cancel-moment').click();
});

document.getElementById('btn-animate').addEventListener('click', () => {
  if (state.anim.running) stopAnimation(); else startAnimation();
});

document.getElementById('speed-slider').addEventListener('input', e => {
  document.getElementById('speed-value').textContent = e.target.value + 's';
  state.anim.duration = parseFloat(e.target.value) * 1000;
});

document.getElementById('audio-file-input').addEventListener('change', e => {
  if (e.target.files[0]) loadAudioFile(e.target.files[0]);
});

document.getElementById('btn-audio-play').addEventListener('click', () => {
  if (state.audio.isPlaying) pauseAudio(); else playAudio();
});
document.getElementById('btn-audio-stop').addEventListener('click', stopAudio);

document.getElementById('btn-sync').addEventListener('click', () => {
  state.syncMode = !state.syncMode;
  document.getElementById('btn-sync').classList.toggle('active-toggle', state.syncMode);
  toast(state.syncMode ? '🎵 Sincronización con música: ON' : 'Sincronización: OFF');
});

document.getElementById('volume-slider').addEventListener('input', e => {
  if (state.audio.gainNode) state.audio.gainNode.gain.value = parseFloat(e.target.value);
});

// ── Editor header buttons ─────────────────────────────────
document.getElementById('btn-back-lib').addEventListener('click', backToLibrary);
document.getElementById('btn-save').addEventListener('click', () => { save(); toast('Guardado ✓'); });
document.getElementById('btn-export').addEventListener('click', exportChoreo);

// ── Library buttons ───────────────────────────────────────
document.getElementById('lib-back').addEventListener('click', goToFolders);
document.getElementById('lib-add').addEventListener('click', () => {
  if (state.currentFolder)
    askName('Nueva coreografía', 'Nombre de la coreografía', '', n => createChoreo(state.currentFolder, n));
  else
    askName('Nuevo grupo', 'Nombre del grupo', '', n => createFolder(n));
});
document.getElementById('lib-export').addEventListener('click', exportLibrary);
document.getElementById('lib-import').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});
document.getElementById('import-file-input').addEventListener('change', e => {
  if (e.target.files[0]) importLibraryFile(e.target.files[0]);
  e.target.value = '';
});

// ── Generic name modal ────────────────────────────────────
document.getElementById('btn-confirm-name').addEventListener('click', () => {
  const val = document.getElementById('modal-name-input').value.trim();
  if (!val) return;
  const cb = _nameCb; _nameCb = null;
  document.getElementById('modal-name').style.display = 'none';
  if (cb) cb(val);
});
document.getElementById('btn-cancel-name').addEventListener('click', () => {
  document.getElementById('modal-name').style.display = 'none'; _nameCb = null;
});
document.getElementById('modal-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-confirm-name').click();
  if (e.key === 'Escape') document.getElementById('btn-cancel-name').click();
});

// ── Generic confirm modal ─────────────────────────────────
document.getElementById('btn-yes-confirm').addEventListener('click', () => {
  const cb = _confirmCb; _confirmCb = null;
  document.getElementById('modal-confirm').style.display = 'none';
  if (cb) cb();
});
document.getElementById('btn-cancel-confirm').addEventListener('click', () => {
  document.getElementById('modal-confirm').style.display = 'none'; _confirmCb = null;
});

// Click outside modal to close
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
});

// Resize
window.addEventListener('resize', () => { resizeCanvas(); resizeWaveform(); });

// ── Alto ajustable de la sección inferior ─────────────────
(function setupBottomResizer() {
  const resizer = document.getElementById('bottom-resizer');
  if (!resizer) return;
  const saved = localStorage.getItem('choreo-bottom-h');
  if (saved) document.body.style.setProperty('--bottom-h', saved);
  let resizing = false;
  const onMove = e => {
    if (!resizing) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const h = window.innerHeight - y;
    const clamped = Math.max(150, Math.min(window.innerHeight * 0.75, h));
    document.body.style.setProperty('--bottom-h', clamped + 'px');
    resizeCanvas(); resizeWaveform();
  };
  const stop = () => {
    if (!resizing) return;
    resizing = false;
    document.body.style.userSelect = '';
    localStorage.setItem('choreo-bottom-h', getComputedStyle(document.body).getPropertyValue('--bottom-h').trim());
  };
  const start = e => { resizing = true; document.body.style.userSelect = 'none'; e.preventDefault(); };
  resizer.addEventListener('pointerdown', start);
  resizer.addEventListener('touchstart', start, { passive: false });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('pointerup', stop);
  window.addEventListener('touchend', stop);
})();

// ============================================================
//  RECORRIDOS — caminos de movimiento entre formaciones
// ============================================================
function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
function clamp01(v) { return Math.max(0.01, Math.min(0.99, v)); }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

// Bézier cuadrática (curva simple con un punto de control)
function quadAt(p0, c, p1, t) {
  const mt = 1 - t;
  return { x: mt*mt*p0.x + 2*mt*t*c.x + t*t*p1.x,
           y: mt*mt*p0.y + 2*mt*t*c.y + t*t*p1.y };
}
// Spline Catmull-Rom (pasa por todos los puntos de paso)
function catmullRom(points) {
  const seg = (p0, p1, p2, p3, t) => {
    const t2 = t*t, t3 = t2*t;
    return {
      x: 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
      y: 0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
    };
  };
  const N = points.length, out = [];
  for (let i = 0; i < N - 1; i++) {
    const p0 = points[i-1] || points[i], p1 = points[i], p2 = points[i+1], p3 = points[i+2] || points[i+1];
    const steps = 16;
    for (let s = 0; s < steps; s++) out.push(seg(p0, p1, p2, p3, s / steps));
  }
  out.push(points[N-1]);
  return out;
}
// Devuelve la polilínea (puntos) del recorrido de un bailarín
function buildPathPoints(start, end, path) {
  if (!path) return [start, end];
  if (path.type === 'curve') {
    const c = path.c || midpoint(start, end);
    const out = [], steps = 24;
    for (let i = 0; i <= steps; i++) out.push(quadAt(start, c, end, i / steps));
    return out;
  }
  if (path.type === 'via') {
    const pts = path.pts || [];
    if (!pts.length) return [start, end];
    return catmullRom([start, ...pts, end]);
  }
  return [start, end];
}
// Posición en la polilínea a proporción t (por longitud de arco = velocidad pareja)
function pointAtArcLength(poly, t) {
  if (!poly || poly.length < 2) return (poly && poly[0]) || { x: .5, y: .5 };
  let total = 0; const cum = [0];
  for (let i = 1; i < poly.length; i++) { total += dist(poly[i-1], poly[i]); cum.push(total); }
  if (total === 0) return poly[0];
  const target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < poly.length; i++) {
    if (cum[i] >= target) {
      const segLen = cum[i] - cum[i-1];
      const lt = segLen > 0 ? (target - cum[i-1]) / segLen : 0;
      return { x: lerp(poly[i-1].x, poly[i].x, lt), y: lerp(poly[i-1].y, poly[i].y, lt) };
    }
  }
  return poly[poly.length - 1];
}
// Polilíneas de todos los bailarines para la transición hacia toIndex
function buildTransitionPaths(fromPos, toPos, toIndex) {
  const m = state.moments[toIndex];
  const paths = (m && m.paths) || {};
  const out = {};
  state.dancers.forEach(d => {
    const s = fromPos[d.id] || { x: .5, y: .5 };
    const e = toPos[d.id]   || { x: .5, y: .5 };
    out[d.id] = buildPathPoints(s, e, paths[d.id]);
  });
  return out;
}
function positionsAlongPaths(polys, t) {
  const out = {};
  state.dancers.forEach(d => {
    const poly = polys && polys[d.id];
    out[d.id] = poly ? pointAtArcLength(poly, t) : { x: .5, y: .5 };
  });
  return out;
}

// ── MODO RECORRIDO ────────────────────────────────────────
function togglePathMode() {
  state.pathMode = !state.pathMode;
  state.draggingPath = null;
  if (state.pathMode && !state.activePathDancer && state.dancers.length)
    state.activePathDancer = state.dancers[0].id;
  document.getElementById('btn-paths').classList.toggle('active-toggle', state.pathMode);
  document.getElementById('path-toolbar').style.display = state.pathMode ? 'flex' : 'none';
  canvas.style.cursor = state.pathMode ? 'copy' : 'crosshair';
  renderPathBar();
  drawStage();
}

function ensurePath(idx, dId, type) {
  const m = state.moments[idx];
  if (!m.paths) m.paths = {};
  const cur = m.paths[dId];
  if (type === 'curve') {
    if (!cur || cur.type !== 'curve') {
      const s = getFullPositions(idx-1)[dId] || { x: .5, y: .5 };
      const e = getFullPositions(idx)[dId]   || { x: .5, y: .5 };
      m.paths[dId] = { type: 'curve', c: midpoint(s, e) };
    }
  } else {
    if (!cur || cur.type !== 'via') m.paths[dId] = { type: 'via', pts: [] };
  }
  return m.paths[dId];
}
function clearPath(dId) {
  const idx = state.currentMoment;
  const m = state.moments[idx];
  if (m && m.paths) { delete m.paths[dId]; if (!Object.keys(m.paths).length) delete m.paths; }
  save(); drawStage();
}

function handlePathDown(e) {
	pushUndo();
  const idx = state.currentMoment;
  if (idx < 1) return;                     // el primer momento no tiene "llegada"
  const p = canvasPos(e);
  const fromPos = getFullPositions(idx - 1), toPos = getFullPositions(idx);
  const R = Math.max(18, canvas.width * 0.038) / canvas.width;
  const near = (a, b) => dist(a, b) < R * 1.1;

  // 1) Solo en modo "curva" permitimos cambiar de bailarín tocándolo.
  //    En modo "puntos", el toque SIEMPRE pone el punto (no estorba otro bailarín).
  if (state.pathSubMode === 'curve') {
    const hit = hitDancer(p.x, p.y, toPos);
    if (hit && hit !== state.activePathDancer) {
      state.activePathDancer = hit; renderPathBar(); drawStage(); return;
    }
  }
  const dId = state.activePathDancer;
  if (!dId) return;
  const m = state.moments[idx];
  const path = m.paths && m.paths[dId];

  if (state.pathSubMode === 'curve') {
    // Clic en cualquier lado fija/arrastra el punto de control de la curva
    ensurePath(idx, dId, 'curve');
    state.moments[idx].paths[dId].c = { x: clamp01(p.x), y: clamp01(p.y) };
    state.draggingPath = { dancerId: dId, kind: 'curve' };
    drawStage();
  } else {
    // Puntos de paso: arrastrar uno existente, o agregar uno nuevo
    const pts = (path && path.type === 'via') ? path.pts : [];
    for (let i = 0; i < pts.length; i++) {
      if (near(p, pts[i])) { state.draggingPath = { dancerId: dId, kind: 'via', index: i }; return; }
    }
    ensurePath(idx, dId, 'via');
    state.moments[idx].paths[dId].pts.push({ x: clamp01(p.x), y: clamp01(p.y) });
    save(); drawStage();
  }
}
function handlePathMove(e) {
  if (!state.draggingPath) return;
  const idx = state.currentMoment;
  const p = canvasPos(e);
  const cx = clamp01(p.x), cy = clamp01(p.y);
  const dp = state.draggingPath;
  const path = state.moments[idx].paths && state.moments[idx].paths[dp.dancerId];
  if (!path) return;
  if (dp.kind === 'curve') path.c = { x: cx, y: cy };
  else if (dp.kind === 'via' && path.pts[dp.index]) path.pts[dp.index] = { x: cx, y: cy };
  drawStage();
}
function handlePathUp() {
  if (state.draggingPath) { state.draggingPath = null; save(); }
}

// ── DIBUJO DE RECORRIDOS ──────────────────────────────────
function drawPathsLayer() {
  const idx = state.currentMoment;
  if (idx < 1) return;
  const W = canvas.width, H = canvas.height;
  const fromPos = getFullPositions(idx - 1), toPos = getFullPositions(idx);
  const paths = (state.moments[idx].paths) || {};
  state.dancers.forEach(d => {
    const s = fromPos[d.id], e = toPos[d.id];
    if (!s || !e) return;
    const active = d.id === state.activePathDancer;
    const poly = buildPathPoints(s, e, paths[d.id]);
    ctx.save();
    // Línea del recorrido
    ctx.strokeStyle = d.color;
    ctx.globalAlpha = active ? 0.95 : 0.30;
    ctx.lineWidth = active ? 3 : 2;
    ctx.setLineDash(paths[d.id] ? [] : [6, 6]);   // punteado = recto por defecto
    ctx.beginPath();
    poly.forEach((pt, i) => { const x = pt.x*W, y = pt.y*H; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);
    // Fantasma en el punto de partida
    ctx.globalAlpha = active ? 0.5 : 0.18;
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(s.x*W, s.y*H, 6, 0, Math.PI*2); ctx.fill();
    // Punta de flecha en la llegada
    drawArrowHead(poly, d.color, active ? 0.95 : 0.35);
    ctx.restore();
    // Tiradores del bailarín activo
    if (active) {
      const path = paths[d.id];
      if (state.pathSubMode === 'curve') {
        const c = (path && path.type === 'curve') ? path.c : midpoint(s, e);
        drawHandle(c.x*W, c.y*H, d.color, '✜');
      } else {
        const pts = (path && path.type === 'via') ? path.pts : [];
        pts.forEach((pt, i) => drawHandle(pt.x*W, pt.y*H, d.color, String(i + 1)));
      }
    }
  });
}
function drawArrowHead(poly, color, alpha) {
  if (!poly || poly.length < 2) return;
  const W = canvas.width, H = canvas.height;
  const a = poly[poly.length - 2], b = poly[poly.length - 1];
  const ang = Math.atan2((b.y - a.y) * H, (b.x - a.x) * W);
  const x = b.x*W, y = b.y*H, size = 11;
  ctx.save();
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size*Math.cos(ang - 0.4), y - size*Math.sin(ang - 0.4));
  ctx.lineTo(x - size*Math.cos(ang + 0.4), y - size*Math.sin(ang + 0.4));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawHandle(x, y, color, label) {
  ctx.save();
  ctx.fillStyle = '#0b0b16'; ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Inter,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
  ctx.restore();
}

// ── BARRA DEL MODO RECORRIDO ──────────────────────────────
function renderPathBar() {
  const bar = document.getElementById('path-toolbar');
  if (!bar) return;
  if (!state.pathMode) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const idx = state.currentMoment;
  const hint = idx < 1
    ? `Elegí un momento posterior en la línea de momentos: el recorrido define <b>cómo llegan a él</b>.`
    : (state.pathSubMode === 'curve'
        ? `Recorrido hacia <b>${escapeHtml(state.moments[idx].name)}</b> — arrastrá en el escenario para doblar la curva del bailarín elegido.`
        : `Recorrido hacia <b>${escapeHtml(state.moments[idx].name)}</b> — tocá el escenario para agregar puntos de paso; arrastralos para moverlos.`);
  const dots = state.dancers.map(d => `
    <button class="path-dot ${d.id === state.activePathDancer ? 'sel' : ''}" data-did="${d.id}" title="${escapeHtml(d.name)}" style="background:${d.color}">${escapeHtml(d.name.charAt(0).toUpperCase())}</button>`).join('');
  bar.innerHTML = `
    <div class="path-row">
      <div class="path-submode">
        <button class="pm-btn ${state.pathSubMode === 'curve' ? 'sel' : ''}" data-sm="curve">Curva</button>
        <button class="pm-btn ${state.pathSubMode === 'via' ? 'sel' : ''}" data-sm="via">Puntos</button>
      </div>
      <div class="path-dancers">${dots || '<span class="path-hint">Agregá bailarines primero</span>'}</div>
      <button id="path-clear" class="btn btn-ghost btn-sm">Limpiar</button>
      <button id="path-exit" class="btn btn-secondary btn-sm">✓ Listo</button>
    </div>
    <div class="path-hint">${hint}</div>`;
  bar.querySelectorAll('.pm-btn').forEach(b => b.addEventListener('click', () => {
    state.pathSubMode = b.dataset.sm; renderPathBar(); drawStage();
  }));
  bar.querySelectorAll('.path-dot').forEach(b => b.addEventListener('click', () => {
    state.activePathDancer = b.dataset.did; renderPathBar(); drawStage();
  }));
  const clr = document.getElementById('path-clear');
  if (clr) clr.addEventListener('click', () => { if (state.activePathDancer) clearPath(state.activePathDancer); });
  const ex = document.getElementById('path-exit');
  if (ex) ex.addEventListener('click', togglePathMode);
}

document.getElementById('btn-paths').addEventListener('click', togglePathMode);

// ── INIT ──────────────────────────────────────────────────
function init() {
  if (!loadLibrary()) {
    migrateOld();      // recupera datos antiguos (una sola coreo) si existen
    persistLibrary();
  }
  state.dancers = [];
  state.moments = [];
  resizeCanvas();
  resizeWaveform();
  renderDancerPanel();
  renderTimeline();
  goToFolders();       // arranca en la biblioteca
}

init();

// ── Panel de bailarines desplegable (en celular) ──
(function setupDancerToggle() {
  const header = document.querySelector('#dancer-panel .panel-header');
  const panel  = document.getElementById('dancer-panel');
  if (!header || !panel) return;
  header.addEventListener('click', e => {
    // Si tocaste el botón "+", no colapses; dejá que agregue bailarín
    if (e.target.closest('#btn-add-dancer')) return;
    panel.classList.toggle('collapsed');
  });
})();

document.getElementById('zoom-in').addEventListener('click',   () => setZoom(stageZoom + 0.25));
document.getElementById('zoom-out').addEventListener('click',  () => setZoom(stageZoom - 0.25));
document.getElementById('zoom-reset').addEventListener('click',() => setZoom(1));

// ── Compartir una coreo como reproductor autónomo ──

// — Compartir una coreo = generar su video MP4 —
async function shareChoreo(folder, choreo) {
  openChoreo(folder, choreo);                       // carga la coreo en el editor
  await new Promise(res => setTimeout(res, 600));   // espera a que cargue el audio
  exportChoreoVideo();
}

// Convierte los bytes del audio a texto base64 (por partes, para que no se cuelgue)
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000; // de a 32 KB
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── Historial (deshacer) ──
let undoStack = [];   // la "pila de fotos" de estados anteriores

// Saca una foto del estado actual y la guarda (se llama ANTES de cada cambio)
function pushUndo() {
  if (!state.currentChoreo) return;
  // Copia profunda de los momentos (una foto congelada, no una referencia)
  const snapshot = JSON.stringify(state.moments);
  undoStack.push(snapshot);
  // Limitamos a 50 fotos para no llenar la memoria
  if (undoStack.length > 50) undoStack.shift();
  actualizarBotonUndo();
}

// Vuelve una foto atrás
function undo() {
  if (!undoStack.length) return;
  const snapshot = undoStack.pop();
  state.moments = JSON.parse(snapshot);      // restauramos la foto
  state.currentChoreo.moments = state.moments;
  if (state.currentMoment >= state.moments.length) state.currentMoment = state.moments.length - 1;
  renderTimeline();
  drawStage();
  persistLibrary();                          // guardamos el cambio
  actualizarBotonUndo();
}

// Prende o apaga el botón según haya algo para deshacer
function actualizarBotonUndo() {
  const btn = document.getElementById('btn-undo');
  if (btn) btn.disabled = undoStack.length === 0;
}
// Botón deshacer
document.getElementById('btn-undo').addEventListener('click', undo);

// Atajo de teclado Ctrl+Z (o Cmd+Z en Mac)
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    // No interferir si estás escribiendo en un campo de texto
    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') return;
    e.preventDefault();
    undo();
  }
});

//Botón MP4 para compartir video universal
async function exportChoreoVideo() {
  if (!state.currentChoreo || state.moments.length < 2) {
    alert('Abrí una coreo con al menos 2 momentos.'); return;
  }
  const hasAudio = !!(state.audio && state.audio.buffer);
  const hasPins  = state.moments.some(m => m.timestamp != null);
  const useSync  = hasAudio && hasPins;
  try {
    const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer/+esm');
    const size = 720, fps = 30;
    const ab = useSync ? state.audio.buffer : null;

    // ¿este navegador puede fabricar audio AAC?
    let withAudio = false;
    if (useSync) {
      try {
        withAudio = (await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2', sampleRate: ab.sampleRate, numberOfChannels: ab.numberOfChannels, bitrate: 128000
        })).supported;
      } catch (_) { withAudio = false; }
    }

    let totalSec;
    if (useSync) totalSec = ab.duration;
    else { totalSec = 0; for (let i = 1; i < state.moments.length; i++) totalSec += momentDurSec(i); }
    const totalFrames = Math.ceil(totalSec * fps);

    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const vctx = c.getContext('2d');

    const opts = {
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: size, height: size },
      fastStart: 'in-memory'
    };
    if (withAudio) opts.audio = { codec: 'aac', numberOfChannels: ab.numberOfChannels, sampleRate: ab.sampleRate };
    const muxer = new Muxer(opts);

    const venc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: e => console.error('video encoder:', e)
    });
    venc.configure({ codec: 'avc1.4d0028', width: size, height: size, bitrate: 5000000, framerate: fps });

    if (withAudio) {
      const aenc = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: e => console.error('audio encoder:', e)
      });
      aenc.configure({ codec: 'mp4a.40.2', sampleRate: ab.sampleRate, numberOfChannels: ab.numberOfChannels, bitrate: 128000 });
      const sr = ab.sampleRate, ch = ab.numberOfChannels, len = ab.length;
      for (let off = 0; off < len; off += sr) {
        const n = Math.min(sr, len - off);
        const data = new Float32Array(n * ch);
        for (let cc = 0; cc < ch; cc++) data.set(ab.getChannelData(cc).subarray(off, off + n), cc * n);
        const adata = new AudioData({
          format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch,
          timestamp: Math.round((off / sr) * 1e6), data
        });
        aenc.encode(adata); adata.close();
      }
      await aenc.flush();
    }

    for (let f = 0; f < totalFrames; f++) {
      const t = f / fps;
      const r = useSync ? computeSyncPositions(t) : computeSequential(t);
      const positions = (r && r.positions) ? r.positions : getFullPositions(0);
      drawFrameTo(vctx, size, positions);
      const frame = new VideoFrame(c, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
      while (venc.encodeQueueSize > 30) await new Promise(res => setTimeout(res, 1));
      venc.encode(frame, { keyFrame: f % 60 === 0 });
      frame.close();
    }

    await venc.flush();
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.currentChoreo.name.replace(/[\/\\:*?"<>|]/g, '_') + '.mp4';
    a.click();
    console.log('✓ video generado (' + totalFrames + ' cuadros, ' + totalSec.toFixed(1) + 's, audio: ' + withAudio + ')');
    if (useSync && !withAudio) {
      alert('El video se generó SIN sonido, porque este navegador (Chrome en Linux) no puede crear audio AAC.\n\nDesde un iPhone, Android, Windows o Mac, el mismo botón lo genera CON música.');
    }
  } catch (e) {
    console.error('FALLÓ el video:', e);
    alert('Falló: ' + e.message);
  }
}

// Anima los momentos en secuencia por sus duraciones (sin depender de pins) — para el video
function computeSequential(t) {
  let acc = 0;
  for (let i = 1; i < state.moments.length; i++) {
    const d = momentDurSec(i);
    if (t < acc + d) {
      const fromPos = getFullPositions(i - 1), toPos = getFullPositions(i);
      const polys = buildTransitionPaths(fromPos, toPos, i);
      const prog = d > 0 ? (t - acc) / d : 1;
      return { activeIdx: i, positions: positionsAlongPaths(polys, Math.max(0, Math.min(1, prog))) };
    }
    acc += d;
  }
  return { activeIdx: state.moments.length - 1, positions: getFullPositions(state.moments.length - 1) };
}

/// Dibuja el escenario completo (grilla, números, frente/fondo) + bailarines, para el video
function drawFrameTo(g, size, positions) {
  // Fondo
  g.fillStyle = '#111128'; g.fillRect(0, 0, size, size);

  // Margen de arriba y abajo para las etiquetas FRENTE / FONDO
  const pad = Math.round(size * 0.07);
  const top = pad, bottom = size - pad, area = bottom - top;

  // Grilla (dentro del área del escenario)
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
  const step = size / 10;
  for (let x = step; x < size; x += step) { g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); }
  for (let i = 1; i < 10; i++) { const y = top + (area / 10) * i; g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }

  // Líneas del centro (cruz punteada)
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1.5; g.setLineDash([4, 6]);
  g.beginPath(); g.moveTo(size / 2, top); g.lineTo(size / 2, bottom); g.stroke();
  g.beginPath(); g.moveTo(0, top + area / 2); g.lineTo(size, top + area / 2); g.stroke();
  g.setLineDash([]);

  // Números de columna: 4 3 2 1 0 1 2 3 4 (el 0 al centro)
  g.font = 'bold ' + Math.round(size * 0.028) + 'px Inter,sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 1; i <= 9; i++) {
    const lx = i * step, label = String(Math.abs(i - 5)), center = i === 5;
    g.fillStyle = center ? 'rgba(167,139,250,0.95)' : 'rgba(255,255,255,0.4)';
    g.fillText(label, lx, top + Math.round(size * 0.03));
  }

  // Etiquetas de frente y fondo
  g.font = '600 ' + Math.round(size * 0.022) + 'px Inter,sans-serif';
  g.fillStyle = 'rgba(148,163,184,0.9)';
  g.fillText('▼ FRENTE DEL ESCENARIO ▼', size / 2, top / 2);
  g.fillText('▲ FONDO DEL ESCENARIO ▲', size / 2, bottom + top / 2);

// Cruces de referencia: fondo (30%), centro (50%), frente (70%) sobre la línea del medio
  const cx = size / 2;
  const arm = Math.max(6, size * 0.016);
  g.strokeStyle = 'rgba(255,220,80,0.80)';
  g.lineWidth = 1.8; g.lineCap = 'round';
  [0.30, 0.50, 0.70].forEach(frac => {
    const y = top + area * frac;
    g.beginPath(); g.moveTo(cx - arm, y - arm); g.lineTo(cx + arm, y + arm); g.stroke();
    g.beginPath(); g.moveTo(cx + arm, y - arm); g.lineTo(cx - arm, y + arm); g.stroke();
  });
  g.lineCap = 'butt';

  // Bailarines (sus posiciones van dentro del área del escenario)
  const R = Math.max(18, size * 0.038);
  state.dancers.forEach(d => {
    const p = positions[d.id]; if (!p) return;
    const x = p.x * size, y = top + p.y * area;
    g.fillStyle = d.color;
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold ' + (R * 0.75) + 'px Inter,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(d.name.charAt(0).toUpperCase(), x, y);
  });
}
// Copiar la coreo actual como texto (para pasarla a otro dispositivo)
function copiarCoreoActual() {
  if (!state.currentChoreo) { alert('Abrí una coreo primero.'); return; }
  const data = JSON.stringify({
    tipo: 'coreo',
    name: state.currentChoreo.name,
    dancers: state.dancers,
    moments: state.moments
  });
  navigator.clipboard.writeText(data)
    .then(() => toast('Coreo copiada ✓ Pegala en el otro dispositivo'))
    .catch(() => prompt('Copiá este texto (Ctrl+C):', data));
}

// Pegar una coreo copiada (la crea como grupo nuevo)
function pegarCoreo() {
  navigator.clipboard.readText().then(txt => {
    procesarCoreoPegada(txt);
  }).catch(() => {
    const txt = prompt('Pegá acá la coreo (mantené presionado → Pegar):');
    if (txt) procesarCoreoPegada(txt);
  });
}

function procesarCoreoPegada(txt) {
  try {
    let limpio = (txt || '').trim()
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    const ini = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (ini >= 0 && fin >= 0) limpio = limpio.slice(ini, fin + 1);
    const data = JSON.parse(limpio);
    const folderLike = {
      name: data.name || 'Coreo pegada',
      dancers: data.dancers || [],
      choreos: [{ name: data.name || 'Coreografía', moments: data.moments || [] }]
    };
    library.folders.push(remapFolder(folderLike));
    persistLibrary();
    goToFolders();
    toast('Coreo pegada ✓');
  } catch (_) {
    alert('El texto pegado no es una coreo válida.');
  }
}
