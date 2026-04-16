/* ═══════════════════════════════════════════
   LifeTrack — app.js
   ═══════════════════════════════════════════ */

const API = 'https://script.google.com/macros/s/AKfycbzcSpqchLizSP0Heeo5nJ_L1XfunYxP5_P8ogCl6oyrAZpD1faZGV5HGJIGtcDHoNb9/exec';
const CIRC = 2 * Math.PI * 39;

// ── STATE ─────────────────────────────────
let allEntries = [];
let trainedDays = {};   // { 'YYYY-MM': [1,3,…] }
let settings = {
  goalKcal: 2000, goalProt: 150,
  bgColor: '#0a0a0a', surfaceColor: '#141414',
  accentColor: '#c8f557', kcalColor: '#f5a623'
};
let calYear, calMonth;
let selectedCat = 'Desayuno';
let pinEntry = '';
let saveTimer;
let currentUser = '';
let pesoChartInstance = null;

// ── DATE HELPERS ──────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function toLocalStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toLocalStr(new Date()); }
function monthKey(y, m) { return `${y}-${pad(m + 1)}`; }

function normalizeFecha(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    return toLocalStr(new Date(Math.round((val - 25569) * 86400000)));
  }
  const d = new Date(String(val));
  if (!isNaN(d)) return toLocalStr(d);
  return String(val).substring(0, 10);
}

// ── THEME ─────────────────────────────────
function applyTheme(s) {
  const r = document.documentElement.style;
  r.setProperty('--bg', s.bgColor);
  r.setProperty('--surface', s.surfaceColor);
  r.setProperty('--surface2', adjustBrightness(s.surfaceColor, 10));
  r.setProperty('--border', adjustBrightness(s.surfaceColor, 30));
  r.setProperty('--accent', s.accentColor);
  r.setProperty('--kcal', s.kcalColor);
  // login bg
  const ls = document.getElementById('login-screen');
  if (ls) ls.style.background = s.bgColor;
}

function adjustBrightness(hex, amt) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return '#' + [r, g, b].map(x => pad(x.toString(16))).join('');
}

const THEMES = [
  { name: 'Dark (default)', bg: '#0a0a0a', surface: '#141414', accent: '#c8f557', kcal: '#f5a623' },
  { name: 'Midnight blue', bg: '#050a14', surface: '#0d1626', accent: '#57c8f5', kcal: '#f5a623' },
  { name: 'Deep purple', bg: '#0a0514', surface: '#140d26', accent: '#c857f5', kcal: '#f5c857' },
  { name: 'Forest', bg: '#050f07', surface: '#0d1f10', accent: '#57f587', kcal: '#f5a623' },
];

// ── INIT ──────────────────────────────────
function init() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();

  document.getElementById('header-date').textContent =
    now.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

  document.getElementById('form-date').value = todayStr();

  // Load settings from localStorage
  const saved = localStorage.getItem('macro_settings');
  if (saved) settings = { ...settings, ...JSON.parse(saved) };
  applyTheme(settings);
  syncSettingsUI();

  const st = localStorage.getItem('macro_training');
  if (st) trainedDays = JSON.parse(st);

  renderMiniCal();
  fetchAll();
}

// ── FETCH ─────────────────────────────────
async function fetchAll() {
  try {
    const res = await fetch(API + '?' + new URLSearchParams({ action: 'get', id_usuario: currentUser, t: Date.now() }));
    const data = await res.json();
    const raw = Array.isArray(data) ? data : [];

    allEntries = [];
    const newTrained = {};

    raw.forEach(row => {
      if (row.tipo === 'entreno') {
        const f = normalizeFecha(row.fecha);
        const mk = f.substring(0, 7);
        const d = parseInt(f.substring(8, 10));
        if (!newTrained[mk]) newTrained[mk] = [];
        if (!newTrained[mk].includes(d)) newTrained[mk].push(d);
      } else if (row.tipo === 'ajuste') {
        // load remote settings
        try {
          const rs = JSON.parse(row.valor || '{}');
          settings = { ...settings, ...rs };
          applyTheme(settings);
          syncSettingsUI();
          localStorage.setItem('macro_settings', JSON.stringify(settings));
          renderPresets();
        } catch (e) { }
      } else if (row.tipo === 'marca') {
        document.getElementById('form-pb').value = row.pb || '';
        document.getElementById('form-s').value = row.s || '';
        document.getElementById('form-cb').value = row.cb || '';
      } else if (row.tipo === 'comida' || row.tipo === 'peso') {
        allEntries.push({ ...row, fecha: normalizeFecha(row.fecha) });
      }
    });

    // Reemplazar estado local con los datos reales del servidor
    trainedDays = newTrained;
    localStorage.setItem('macro_training', JSON.stringify(trainedDays));

    updateTodayView();
    updateHistoryView();
    renderMiniCal();
    renderWorkoutCal();
    renderPesoChart();
  } catch (e) {
    console.error(e);
    showToast('Error al cargar datos', 'err');
    document.getElementById('today-log-list').innerHTML =
      '<div class="empty"><div class="empty-icon">⚠️</div>Error de conexión</div>';
  }
}

// ── TODAY VIEW ────────────────────────────
function updateTodayView() {
  const today = todayStr();
  const entries = allEntries.filter(e => e.fecha === today && e.tipo === 'comida');
  const totK = entries.reduce((s, e) => s + (parseFloat(e.kcal) || 0), 0);
  const totP = entries.reduce((s, e) => s + (parseFloat(e.proteina) || 0), 0);
  const gK = settings.goalKcal;
  const gP = settings.goalProt;

  // rings
  const pK = Math.min(totK / gK, 1);
  const pP = Math.min(totP / gP, 1);
  document.getElementById('ring-kcal-fill').setAttribute('stroke-dasharray', `${pK * CIRC} ${CIRC}`);
  document.getElementById('ring-prot-fill').setAttribute('stroke-dasharray', `${pP * CIRC} ${CIRC}`);
  document.getElementById('rv-kcal').textContent = Math.round(totK);
  document.getElementById('rv-prot').textContent = Math.round(totP);

  // stats
  document.getElementById('st-count').textContent = entries.length;
  document.getElementById('st-kcal-l').innerHTML = `${Math.round(gK - totK)} <span class="u">kcal</span>`;
  document.getElementById('st-prot-l').innerHTML = `${(gP - totP).toFixed(1)} <span class="u">g</span>`;

  // list
  const list = document.getElementById('today-log-list');
  if (!entries.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div>Sin registros hoy</div>';
  } else {
    list.innerHTML = entries.slice().reverse().map(logHTML).join('');
  }

  renderMiniCal();
  updateStreak();
}

function updateStreak() {
  const dates = [];
  Object.keys(trainedDays).forEach(mk => {
     trainedDays[mk].forEach(d => {
        dates.push(new Date(mk + '-' + String(d).padStart(2,'0') + 'T12:00:00'));
     });
  });
  dates.sort((a,b) => b - a); // descending -> newest first
  
  let streak = 0;
  if (dates.length > 0) {
    let curr = new Date();
    curr.setHours(12,0,0,0);
    let diffDaysFirst = Math.floor((curr - dates[0]) / 86400000);
    
    if (diffDaysFirst <= 1) {
       let expect = new Date(dates[0]);
       for (let d of dates) {
          let diff = Math.floor((expect - d) / 86400000);
          if (diff === 0) { 
             streak++; 
             expect.setDate(expect.getDate() - 1); 
          } else if (diff > 0) {
             break;
          }
       }
    }
  }
  const badge = document.getElementById('streak-badge');
  if (badge) {
    badge.innerHTML = `🔥 ${streak}`;
    badge.style.opacity = streak > 0 ? '1' : '0.5';
  }
}

function logHTML(e) {
  const cls = 'dot-' + (e.categoria || 'otro').toLowerCase().replace(/\s+/g, '-');
  return `<div class="log-item">
    <div class="log-dot ${cls}"></div>
    <div class="log-info">
      <div class="log-name">${e.alimento || '—'}</div>
      <div class="log-cat">${e.categoria || ''}</div>
    </div>
    <div class="log-nums">
      <div class="log-k">${Math.round(e.kcal || 0)} kcal</div>
      <div class="log-p">${parseFloat(e.proteina || 0).toFixed(1)}g prot</div>
    </div>
  </div>`;
}

// ── MINI CAL (Home) ───────────────────────
function renderMiniCal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const mk = monthKey(y, m);
  const trained = trainedDays[mk] || [];
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDaysInMonth = new Date(y, m, 0).getDate();
  const todayD = now.getDate();

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  document.getElementById('mini-cal-month').textContent = monthNames[m];

  let firstDay = new Date(y, m, 1).getDay();
  firstDay = firstDay === 0 ? 6 : firstDay - 1;

  let html = '';
  for (let i = firstDay - 1; i >= 0; i--) {
     html += `<div class="mc-day other-m">${prevDaysInMonth - i}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    let cls = 'mc-day';
    if (trained.includes(d)) cls += ' trained';
    if (d === todayD) cls += ' today-m';
    const clickHandler = `onclick="toggleDay(${d}, true)"`;
    html += `<div class="${cls}" style="cursor:pointer;" ${clickHandler}>${d}</div>`;
  }
  const currentTotal = firstDay + daysInMonth;
  const totalCells = currentTotal > 35 ? 42 : 35;
  const remainingCells = totalCells - currentTotal;
  for(let i = 1; i <= remainingCells; i++) {
     html += `<div class="mc-day other-m">${i}</div>`;
  }
  document.getElementById('mini-cal-grid').innerHTML = html;
}

// ── HISTORY VIEW ──────────────────────────
function updateHistoryView() {
  const container = document.getElementById('history-container');
  // Obtenemos fechas con comida, o también extraídas de los entrenos locales
  const foodEntries = allEntries.filter(e => e.tipo === 'comida');
  const validDates = new Set();
  
  foodEntries.forEach(e => validDates.add(e.fecha));
  
  // Agregar también fechas de entrenamientos
  Object.keys(trainedDays).forEach(mk => {
    const [y, m] = mk.split('-');
    trainedDays[mk].forEach(d => {
      validDates.add(`${y}-${m}-${pad(d)}`);
    });
  });

  const datesList = Array.from(validDates).sort().reverse();
  if (!datesList.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div>Sin datos aún</div>';
    return;
  }
  
  const groups = {};
  foodEntries.forEach(e => {
    if (!groups[e.fecha]) groups[e.fecha] = [];
    groups[e.fecha].push(e);
  });

  container.innerHTML = datesList.map(date => {
    const ents = groups[date] || [];
    const totK = ents.reduce((s, e) => s + (parseFloat(e.kcal) || 0), 0);
    const totP = ents.reduce((s, e) => s + (parseFloat(e.proteina) || 0), 0);
    
    const dObj = new Date(date + 'T12:00:00');
    const mk = monthKey(dObj.getFullYear(), dObj.getMonth());
    const trained = trainedDays[mk] && trainedDays[mk].includes(dObj.getDate());
    const badge = trained ? '<span style="color:var(--accent);font-size:9px;border:1px solid var(--accent);border-radius:4px;padding:2px 4px;margin-left:6px;">💪 Entrenado</span>' : '';

    return `<div class="hist-group">
      <div class="hist-date-row">
        <span>${fmtDate(date)}${badge}</span>
        <span><span class="ht-k">${Math.round(totK)} kcal</span><span class="ht-p">${totP.toFixed(1)}g prot</span></span>
      </div>
      ` + (ents.length ? `<div class="log-list">${ents.slice().reverse().map(logHTML).join('')}</div>` : 
      `<div style="font-size:10px; color:var(--muted); margin-top:4px;">No hay comidas registradas</div>`) + `
    </div>`;
  }).join('');
}

// ── CHART (PESO) ──────────────────────────
function renderPesoChart() {
  const canvas = document.getElementById('pesoChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  
  // Filtrar pesos y ordenar cronológicamente
  const pesosList = allEntries.filter(e => e.tipo === 'peso')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  const labels = pesosList.map(e => {
    const d = new Date(e.fecha + 'T12:00:00');
    return d.getDate() + '/' + (d.getMonth() + 1);
  });
  const dataMap = pesosList.map(e => e.peso);

  if (pesoChartInstance) {
    pesoChartInstance.destroy();
  }

  // Fallback al color accent
  const rootStyle = getComputedStyle(document.documentElement);
  let mainColor = rootStyle.getPropertyValue('--accent').trim();
  if (!mainColor) mainColor = '#c8f557';

  // Opacidad 20% para el fondo (hex to rgb + alpha hack via concat no es 100% ideal, mejor omitir fill bg)
  
  pesoChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Peso (kg)',
        data: dataMap,
        borderColor: mainColor,
        borderWidth: 3,
        pointBackgroundColor: '#0a0a0a',
        pointBorderColor: mainColor,
        pointBorderWidth: 2,
        pointRadius: 4,
        tension: 0.35, 
        fill: false, 
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#141414', titleColor: '#888', bodyColor: '#fff', bodyFont: { weight: 'bold' } }
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: { color: '#888', maxTicksLimit: 7 }
        },
        y: {
          display: true,
          grid: { color: 'rgba(255, 255, 255, 0.06)' }, 
          ticks: { color: '#888', maxTicksLimit: 5 }
        }
      }
    }
  });
}

function fmtDate(str) {
  const d = new Date(str + 'T12:00:00');
  if (str === todayStr()) return 'Hoy';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (str === toLocalStr(yest)) return 'Ayer';
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── ADD ENTRY ─────────────────────────────
let scanner = null;
function startScanner() {
  document.getElementById('scanner-container').style.display = 'block';
  scanner = new Html5Qrcode("scanner-view");
  const config = {
    fps: 10,
    qrbox: { width: 280, height: 140 },
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.QR_CODE
    ]
  };

  scanner.start({ facingMode: "environment" }, config, 
    decodedText => {
      stopScanner();
      fetchOpenFoodFacts(decodedText);
    },
    err => { /* ignore invisible frame errors */ }
  ).catch(err => {
    showToast('Error al iniciar cámara', 'err');
    stopScanner();
  });
}

function stopScanner() {
  if (scanner) { 
     scanner.stop().then(() => {
        scanner.clear();
        scanner = null;
     }).catch(() => {
        scanner.clear();
        scanner = null;
     });
  }
  document.getElementById('scanner-container').style.display = 'none';
}

function fetchOpenFoodFacts(barcode) {
  showToast('🔍 Código: ' + barcode, 'ok');
  fetch(`https://es.openfoodfacts.org/api/v0/product/${barcode}.json`)
    .then(r => r.json())
    .then(data => {
       if (data.status === 1) {
          const p = data.product;
          document.getElementById('form-food').value = p.product_name_es || p.product_name || 'Desconocido';
          document.getElementById('form-kcal').value = Math.round(p.nutriments?.['energy-kcal_100g'] || 0);
          document.getElementById('form-prot').value = parseFloat(p.nutriments?.proteins_100g || 0).toFixed(1);
          showToast('¡Encontrado! Valores x 100g', 'ok');
       } else {
          showToast('Producto no registrado', 'err');
       }
    }).catch(e => showToast('Error red escáner', 'err'));
}

function selectCat(btn) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
  selectedCat = btn.dataset.cat;
}

function addEntry() {
  const fecha = document.getElementById('form-date').value;
  const alimento = document.getElementById('form-food').value.trim();
  const kcal = parseFloat(document.getElementById('form-kcal').value) || 0;
  const proteina = parseFloat(document.getElementById('form-prot').value) || 0;

  if (!alimento) { showToast('Escribe el alimento', 'err'); return; }
  if (!fecha) { showToast('Selecciona una fecha', 'err'); return; }

  const p = new URLSearchParams({ action: 'add', id_usuario: currentUser, tipo: 'comida', fecha, categoria: selectedCat, alimento, kcal, proteina });
  
  // Guardado optimista local inmediato
  allEntries.push({ tipo: 'comida', fecha, categoria: selectedCat, alimento, kcal, proteina });
  updateTodayView(); 
  updateHistoryView();
  
  document.getElementById('form-food').value = '';
  document.getElementById('form-kcal').value = '';
  document.getElementById('form-prot').value = '';
  showView('today');
  
  // Guardado en fondo silencioso
  const saveIndicator = document.getElementById('save-ind');
  if (saveIndicator) { saveIndicator.style.opacity = '1'; saveIndicator.textContent = 'Guardando comida...'; }
  
  fetch(API + '?' + p, { method: 'GET', mode: 'no-cors' }).then(() => {
    if (saveIndicator) {
      saveIndicator.textContent = '✓ Guardado completado';
      setTimeout(() => saveIndicator.style.opacity = '0', 2000);
    }
  }).catch(() => {
    showToast('Aviso: Comprueba tu conexión', 'err');
  });
}

function renderPresets() {
  const grid = document.getElementById('presets-grid');
  if (!grid) return;
  if (!settings.presets || settings.presets.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; font-size: 11px; color: var(--muted); text-align: center; padding: 20px;">No hay presets guardados. Crea uno usando el botón arriba.</div>';
    return;
  }
  
  grid.innerHTML = settings.presets.map((p, i) => `
    <button class="preset-btn" onclick="applyAndSavePreset(${i})" oncontextmenu="deletePreset(${i}); return false;">
      <div class="p-name">${p.n}</div>
      <div class="p-stats">${p.k} kcal • ${p.p} g prot</div>
    </button>
  `).join('');
}

function applyAndSavePreset(idx) {
  const p = settings.presets[idx];
  document.getElementById('form-food').value = p.n;
  document.getElementById('form-kcal').value = p.k;
  document.getElementById('form-prot').value = p.p;
  addEntry(); // Autoguardado e inyección en el día/categoría actual
}

function deletePreset(idx) {
  if(confirm('¿Borrar este preset rápido?')) {
    settings.presets.splice(idx, 1);
    localStorage.setItem('macro_settings', JSON.stringify(settings));
    fetch(API + '?' + new URLSearchParams({ action: 'save_settings', id_usuario: currentUser, tipo: 'ajuste', valor: JSON.stringify(settings) }), { method: 'GET', mode: 'no-cors' });
    renderPresets();
  }
}

function saveAsPreset() {
  const n = document.getElementById('form-food').value.trim();
  const k = parseFloat(document.getElementById('form-kcal').value) || 0;
  const p = parseFloat(document.getElementById('form-prot').value) || 0;
  if (!n) { showToast('Escribe un alimento primero', 'err'); return; }
  
  if (!settings.presets) settings.presets = [];
  settings.presets.push({ n, k, p });
  localStorage.setItem('macro_settings', JSON.stringify(settings));
  
  fetch(API + '?' + new URLSearchParams({ action: 'save_settings', id_usuario: currentUser, tipo: 'ajuste', valor: JSON.stringify(settings) }), { method: 'GET', mode: 'no-cors' });
  
  renderPresets();
  showToast('✓ Preset añadido', 'ok');
}

// ── WORKOUT CAL ───────────────────────────
function renderWorkoutCal() {
  const mk = monthKey(calYear, calMonth);
  const trained = trainedDays[mk] || [];
  const today = new Date();
  const isCurr = calYear === today.getFullYear() && calMonth === today.getMonth();
  const todayD = today.getDate();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const prevDaysInMonth = new Date(calYear, calMonth, 0).getDate();

  const mNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  document.getElementById('month-lbl').textContent = `${mNames[calMonth]} ${calYear}`;

  // stats
  document.getElementById('sv-count').textContent = trained.length;
  document.getElementById('sv-pct').textContent = Math.round((trained.length / daysInMonth) * 100) + '%';

  // week count
  const wkStart = new Date(today);
  wkStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  let wkC = 0;
  if (isCurr) trained.forEach(d => {
    const dt = new Date(calYear, calMonth, d);
    if (dt >= wkStart && dt <= today) wkC++;
  });
  document.getElementById('sv-week').textContent = wkC;

  let firstDay = new Date(calYear, calMonth, 1).getDay();
  firstDay = firstDay === 0 ? 6 : firstDay - 1;

  let html = '';
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="wk-day other-m">${prevDaysInMonth - i}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    let cls = 'wk-day';
    if (trained.includes(d)) cls += ' trained';
    if (isCurr && d === todayD) cls += ' today-m';
    html += `<div class="${cls}" onclick="toggleDay(${d})">${d}</div>`;
  }
  const currentTotal = firstDay + daysInMonth;
  const totalCells = currentTotal > 35 ? 42 : 35;
  const remainingCells = totalCells - currentTotal;
  for(let i = 1; i <= remainingCells; i++) {
     html += `<div class="wk-day other-m">${i}</div>`;
  }
  document.getElementById('wk-cal-grid').innerHTML = html;
}

function changeMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderWorkoutCal();
}

function addPeso() {
  const pInput = document.getElementById('form-peso');
  const peso = parseFloat(pInput.value);
  if (!peso) { showToast('Introduce un peso', 'err'); return; }
  
  const today = todayStr();
  const existingIdx = allEntries.findIndex(e => e.tipo === 'peso' && e.fecha === today);
  if (existingIdx !== -1) {
     allEntries[existingIdx].peso = peso;
  } else {
     allEntries.push({ tipo: 'peso', fecha: today, peso });
  }
  
  renderPesoChart();
  pInput.value = '';
  
  const p = new URLSearchParams({ action: 'add_peso', id_usuario: currentUser, tipo: 'peso', fecha: today, peso });
  fetch(API + '?' + p, { method: 'GET', mode: 'no-cors' }).then(() => {
     showToast('✓ Peso en la nube', 'ok');
  });
}

async function toggleDay(day, isMini = false) {
  // Si venimos del mini-cal, forzamos mes actual, si no usamos el que estemos viendo
  const y = isMini ? new Date().getFullYear() : calYear;
  const m = isMini ? new Date().getMonth() : calMonth;
  const mk = monthKey(y, m);
  
  if (!trainedDays[mk]) trainedDays[mk] = [];
  const idx = trainedDays[mk].indexOf(day);
  const adding = idx === -1;
  if (adding) trainedDays[mk].push(day);
  else trainedDays[mk].splice(idx, 1);

  localStorage.setItem('macro_training', JSON.stringify(trainedDays));
  renderWorkoutCal();
  renderMiniCal();

  clearTimeout(saveTimer);
  const ind_id = isMini ? 'mini-save-ind' : 'save-ind';
  const ind = document.getElementById(ind_id) || document.getElementById('save-ind');
  ind.textContent = 'Guardando...';
  
  saveTimer = setTimeout(async () => {
    const fecha = `${y}-${pad(m + 1)}-${pad(day)}`;
    const action = adding ? 'add_entreno' : 'remove_entreno';
    try {
      await fetch(API + '?' + new URLSearchParams({ action, id_usuario: currentUser, fecha, tipo: 'entreno' }), { method: 'GET', mode: 'no-cors' });
      ind.textContent = '✓ Guardado';
      setTimeout(() => ind.textContent = '', 2000);
    } catch (e) { ind.textContent = 'Error al guardar'; }
  }, 800);
}

// ── CONFIG PANEL ──────────────────────────
function calcTDEE() {
   const w = parseFloat(document.getElementById('tdee-w').value) || 0;
   const h = parseFloat(document.getElementById('tdee-h').value) || 0;
   const a = parseFloat(document.getElementById('tdee-a').value) || 0;
   const s = document.getElementById('tdee-s').value;
   const objOffset = parseFloat(document.getElementById('tdee-obj').value) || 0;
   
   if (!w || !h || !a) return showToast('Completa todo para calcular', 'err');
   
   let bmr = s === 'm' ? (10 * w + 6.25 * h - 5 * a + 5) : (10 * w + 6.25 * h - 5 * a - 161);
   let tdee = Math.round(bmr * 1.55); // Asumiendo ejercicio moderado
   
   let finalKcal = tdee + objOffset;
   finalKcal = Math.round(finalKcal / 50) * 50; // Redondear a 50
   let finalProt = Math.round((w * 2) / 5) * 5; // Redondear a 5
   
   document.getElementById('cfg-kcal').value = finalKcal;
   document.getElementById('cfg-prot').value = finalProt;
   showToast('¡Objetivos auto-ajustados!', 'ok');
}

function openSubMenu(id) {
  document.getElementById('more-main').style.display = 'none';
  document.getElementById(id).style.display = 'block';
}
function closeSubMenu() {
  document.querySelectorAll('.sub-menu').forEach(el => el.style.display = 'none');
  document.getElementById('more-main').style.display = 'block';
}

function syncSettingsUI() {
  document.getElementById('cfg-kcal').value = settings.goalKcal;
  document.getElementById('cfg-prot').value = settings.goalProt;
  document.getElementById('cfg-bg').value = settings.bgColor;
  document.getElementById('cfg-surface').value = settings.surfaceColor;
  document.getElementById('cfg-accent').value = settings.accentColor;
  document.getElementById('cfg-kcalc').value = settings.kcalColor;
}

function applyThemePreset(idx) {
  const t = THEMES[idx];
  settings.bgColor = t.bg;
  settings.surfaceColor = t.surface;
  settings.accentColor = t.accent;
  settings.kcalColor = t.kcal;
  syncSettingsUI();
  applyTheme(settings);
  document.querySelectorAll('.theme-btn').forEach((b, i) => b.classList.toggle('active-theme', i === idx));
}

function onColorChange() {
  settings.bgColor = document.getElementById('cfg-bg').value;
  settings.surfaceColor = document.getElementById('cfg-surface').value;
  settings.accentColor = document.getElementById('cfg-accent').value;
  settings.kcalColor = document.getElementById('cfg-kcalc').value;
  applyTheme(settings);
}

async function saveSettings() {
  settings.goalKcal = parseFloat(document.getElementById('cfg-kcal').value) || 2000;
  settings.goalProt = parseFloat(document.getElementById('cfg-prot').value) || 150;
  settings.bgColor = document.getElementById('cfg-bg').value;
  settings.surfaceColor = document.getElementById('cfg-surface').value;
  settings.accentColor = document.getElementById('cfg-accent').value;
  settings.kcalColor = document.getElementById('cfg-kcalc').value;

  applyTheme(settings);
  localStorage.setItem('macro_settings', JSON.stringify(settings));
  updateTodayView();
  closeConfig(); // Minimizar inmediatamente

  // Save to Sheets
  const p = new URLSearchParams({ action: 'save_settings', id_usuario: currentUser, tipo: 'ajuste', valor: JSON.stringify(settings) });
  try {
    await fetch(API + '?' + p, { method: 'GET', mode: 'no-cors' });
    showToast('✓ Ajustes guardados', 'ok');
  } catch (e) { showToast('Guardado solo local', 'ok'); }
}

// ── NAV ───────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  const idx = ['today', 'add', 'tracking', 'ranking', 'more'].indexOf(name);
  const navBtns = document.querySelectorAll('nav button');
  if (navBtns[idx]) navBtns[idx].classList.add('active');
  if (name === 'tracking') renderWorkoutCal();
  if (name === 'more') updateHistoryView();
  if (name === 'ranking') loadRanking();
}

// ── RANKING / MARCAS ───────────────────────
async function saveMarcas() {
  const pb = parseFloat(document.getElementById('form-pb').value) || 0;
  const s = parseFloat(document.getElementById('form-s').value) || 0;
  const cb = parseFloat(document.getElementById('form-cb').value) || 0;
  
  const btn = document.getElementById('btn-marcas');
  btn.disabled = true; btn.textContent = 'Guardando...';
  
  const p = new URLSearchParams({ action: 'save_marca', id_usuario: currentUser, pb, s, cb });
  try {
    await fetch(API + '?' + p, { method: 'GET', mode: 'no-cors' });
    showToast('✓ Marcas guardadas', 'ok');
  } catch (e) { showToast('Error al guardar', 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Guardar/Actualizar Marcas'; }
}

async function loadRanking() {
  const cont = document.getElementById('ranking-container');
  cont.innerHTML = '<div class="loading"><span class="spinner"></span>Cargando ranking...</div>';
  
  try {
    const res = await fetch(API + '?' + new URLSearchParams({ action: 'get_ranking', id_usuario: currentUser, t: Date.now() }));
    const data = await res.json();
    
    if (!data || !data.length) {
      cont.innerHTML = '<div class="empty"><div class="empty-icon">🏆</div>Nadie ha guardado marcas aún</div>';
      return;
    }
    
    const renderList = (sortedList, propFormat) => sortedList.map((u, i) => `
      <div class="rank-card pos-${i+1}">
        <div class="rank-pos">#${i+1}</div>
        <div class="rank-info">
          <div class="rank-name">${u.usuario}</div>
          <div class="rank-stats">
             ${propFormat(u)}
          </div>
        </div>
      </div>
    `).join('') || '<div class="empty" style="padding:10px; opacity:0.5;">Sin datos</div>';

    const renderSec = (title, emoji, html) => `
      <div class="sec-title" style="margin-top:24px; margin-bottom:8px;">${emoji} ${title}</div>
      ${html}
    `;

    const htmlT = renderSec('Total (Suma PRs)', '🔥', renderList(
      data.map(u => ({...u, total: (u.pb + u.s + u.cb)})).sort((a,b) => b.total - a.total),
      u => `<div class="rank-stat" style="color:var(--accent);">Total: <span>${u.total} kg</span></div>`
    ));
    
    const htmlB = renderSec('Press Banca', '💪', renderList(
      [...data].sort((a,b) => b.pb - a.pb),
      u => `<div class="rank-stat">Banca: <span>${u.pb} kg</span></div>`
    ));

    const htmlS = renderSec('Sentadilla', '🦵', renderList(
      [...data].sort((a,b) => b.s - a.s),
      u => `<div class="rank-stat">Sentadilla: <span>${u.s} kg</span></div>`
    ));

    const htmlC = renderSec('Curl Bíceps', '💪', renderList(
      [...data].sort((a,b) => b.cb - a.cb),
      u => `<div class="rank-stat">Bíceps: <span>${u.cb} kg</span></div>`
    ));

    cont.innerHTML = htmlT + htmlB + htmlS + htmlC;
  } catch (e) {
    cont.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>Error al cargar ranking</div>';
  }
}

// ── TOAST ─────────────────────────────────
let toastTmr;
function showToast(msg, type = '') {
  const t = document.querySelector('.toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => t.classList.remove('show'), 2400);
}

// ── LOGIN ─────────────────────────────────
function pinPress(d) {
  if (pinEntry.length >= 4) return;
  pinEntry += d; updateDots();
  if (pinEntry.length === 4) checkPin();
}
function pinDel() { pinEntry = pinEntry.slice(0, -1); updateDots(); }
function updateDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('dot-' + i);
    dot.classList.toggle('filled', i < pinEntry.length);
    dot.classList.remove('error');
  }
}
async function checkPin() {
  const userInp = document.getElementById('login-user').value.trim();
  if (!userInp) { showToast('Escribe tu usuario primero', 'err'); pinEntry = ''; updateDots(); return; }

  const errEl = document.getElementById('login-err');
  errEl.textContent = 'Verificando...';
  errEl.classList.add('show');

  try {
    const res = await fetch(API + '?' + new URLSearchParams({ action: 'login', user: userInp, pin: pinEntry, t: Date.now() }));
    const data = await res.json();

    if (data.ok) {
      currentUser = data.id_usuario;
      localStorage.setItem('macro_user', currentUser);
      localStorage.setItem('macro_auth', '1');
      errEl.classList.remove('show');
      document.getElementById('login-screen').style.display = 'none';
      init();
    } else {
      throw new Error(data.error || 'PIN incorrecto');
    }
  } catch (e) {
    for (let i = 0; i < 4; i++) document.getElementById('dot-' + i).classList.add('error');
    errEl.textContent = e.message || 'Error de conexión';
    errEl.classList.add('show');
    setTimeout(() => {
      pinEntry = ''; updateDots();
      errEl.classList.remove('show');
      setTimeout(() => { errEl.textContent = 'PIN incorrecto'; }, 300);
    }, 1500);
  }
}

function logout() {
  localStorage.removeItem('macro_auth');
  localStorage.removeItem('macro_user');
  window.location.reload();
}

// ── BOOT ──────────────────────────────────
const savedUser = localStorage.getItem('macro_user');
if (localStorage.getItem('macro_auth') === '1' && savedUser) {
  currentUser = savedUser;
  document.getElementById('login-screen').style.display = 'none';
  init();
}

// ── GESTURES (SWIPE BACK) ─────────────────
let tStartX = 0, tStartY = 0;
document.addEventListener('touchstart', e => {
  tStartX = e.changedTouches[0].screenX;
  tStartY = e.changedTouches[0].screenY;
}, {passive:true});

document.addEventListener('touchend', e => {
  const diffX = e.changedTouches[0].screenX - tStartX;
  const diffY = Math.abs(e.changedTouches[0].screenY - tStartY);
  // Si swipe de Izquierda a Derecha partiendo del margen
  if (tStartX < 40 && diffX > 60 && diffY < 50) {
    const activado = Array.from(document.querySelectorAll('.sub-menu')).find(m => m.style.display === 'block');
    if (activado) closeSubMenu();
  }
}, {passive:true});
