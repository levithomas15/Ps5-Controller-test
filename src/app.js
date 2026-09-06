// Oberfläche: verbindet die DualSense-Klasse mit den Bedienelementen.

import { DualSense, TRIGGER_EFFECTS, PLAYER_PATTERNS } from './dualsense.js';

const $ = (id) => document.getElementById(id);
const ds = new DualSense();
const STORE_KEY = 'dualsense-studio-v1';

const settings = Object.assign({
  color: { r: 0, g: 64, b: 255 },
  brightness: 100,
  effect: 'static',
  speed: 35,
  player: 0,
  playerBrightness: 0,
  mic: 0,
  triggers: {
    left: { effect: 'off', values: {} },
    right: { effect: 'off', values: {} },
  },
  linkTriggers: false,
}, loadSettings());

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* Privatmodus */ }
}

function toast(message, kind = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

// ------------------------------------------------------------------- Tabs

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`);
    });
  });
});

// -------------------------------------------------------------- Verbindung

if (!DualSense.supported) {
  $('unsupported').hidden = false;
  $('connectBtn').disabled = true;
}

let noDataTimer = null;

/**
 * Verbindet den Controller. Ohne Argument wird zuerst ein bereits
 * freigegebenes Gerät probiert, sonst geht es direkt zur Auswahl.
 */
async function connect({ forcePicker = false } = {}) {
  $('noData').hidden = true;
  try {
    if (!forcePicker) {
      // Klappt das nicht (etwa weil die alte Bluetooth-Kopplung weg ist),
      // fällt der Ablauf auf den Auswahldialog zurück.
      for (const known of await DualSense.getKnownDevices()) {
        try {
          await ds.open(known);
          return;
        } catch { /* nächsten Kandidaten probieren */ }
      }
    }

    const device = await DualSense.requestDevice();
    if (!device) {
      toast('Kein Gerät ausgewählt. War die Liste leer? Siehe Hilfe → „Der Controller taucht nicht auf".', 'error');
      return;
    }

    const id = DualSense.identify(device);
    if (id.kind === 'other-sony') {
      toast(`Das ist ein ${id.name}. Diese Seite ist für den DualSense der PS5 gemacht.`, 'error');
      return;
    }
    if (id.kind === 'unknown-sony') {
      toast('Unbekanntes Sony-Gerät – wird versuchsweise geöffnet.', 'info');
    }

    await ds.open(device);
  } catch (err) {
    toast(`Verbindung fehlgeschlagen: ${err.message}`, 'error');
  }
}

$('connectBtn').addEventListener('click', () => connect());
$('pickBtn').addEventListener('click', () => connect({ forcePicker: true }));

$('disconnectBtn').addEventListener('click', () => ds.close());

ds.addEventListener('connect', () => {
  $('statusDot').classList.add('on');
  $('statusText').textContent = ds.connection === 'usb' ? 'Verbunden über USB' : 'Verbunden über Bluetooth';
  $('connectBtn').hidden = true;
  $('disconnectBtn').hidden = false;
  const hex = (v) => `0x${v.toString(16).padStart(4, '0')}`;
  $('infoName').textContent = ds.state.name;
  $('infoName').title = `Hersteller ${hex(ds.state.vendorId)}, Produkt ${hex(ds.state.productId)}`;
  $('infoConn').textContent = ds.connection === 'usb' ? 'USB-C' : 'Bluetooth';
  applyAllSettings();
  toast('Controller verbunden.', 'ok');

  // Ein geöffnetes Gerät heißt noch nicht, dass es auch sendet.
  clearTimeout(noDataTimer);
  noDataTimer = setTimeout(() => {
    $('noData').hidden = ds.state.reportsSeen > 0;
  }, 3000);
});

ds.addEventListener('disconnect', () => {
  clearTimeout(noDataTimer);
  $('noData').hidden = true;
  $('statusDot').classList.remove('on');
  $('statusText').textContent = 'Nicht verbunden';
  $('connectBtn').hidden = false;
  $('disconnectBtn').hidden = true;
  $('infoName').textContent = '–';
  $('infoConn').textContent = '–';
  $('infoBattery').textContent = '–';
  $('infoRate').textContent = '–';
  $('infoOut').textContent = '–';
});

ds.addEventListener('input', () => {
  if (!$('noData').hidden) $('noData').hidden = true;
}, { once: false });

ds.addEventListener('error', (e) => toast(`Fehler beim Senden: ${e.detail?.message ?? e.detail}`, 'error'));

// Nach einem Reload ist die Freigabe noch gültig – dann direkt weitermachen.
if (DualSense.supported) {
  DualSense.getKnownDevices().then((devices) => {
    if (devices[0]) $('statusText').textContent = 'Controller bekannt – zum Verbinden klicken';
  });
  navigator.hid.addEventListener('connect', () => {
    if (!ds.state.connected) $('statusText').textContent = 'Controller erkannt – zum Verbinden klicken';
  });
}

// --------------------------------------------------------------- Lightbar

const PRESETS = [
  ['PlayStation-Blau', 0, 64, 255], ['Weiß', 255, 255, 255], ['Rot', 255, 0, 0],
  ['Grün', 0, 255, 60], ['Türkis', 0, 220, 200], ['Violett', 160, 0, 255],
  ['Pink', 255, 40, 140], ['Orange', 255, 90, 0], ['Gelb', 255, 200, 0],
  ['Eisblau', 120, 200, 255], ['Lime', 170, 255, 0], ['Aus', 0, 0, 0],
];

const presetBox = $('colorPresets');
PRESETS.forEach(([name, r, g, b]) => {
  const btn = document.createElement('button');
  btn.className = 'preset';
  btn.style.background = `rgb(${r},${g},${b})`;
  btn.title = name;
  btn.setAttribute('aria-label', name);
  btn.addEventListener('click', () => {
    settings.effect = 'static';
    syncEffectChips();
    setColor(r, g, b);
  });
  presetBox.appendChild(btn);
});

function toHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function setColor(r, g, b, fromInput = null) {
  settings.color = { r, g, b };
  if (fromInput !== 'sliders') {
    $('sliderR').value = r; $('sliderG').value = g; $('sliderB').value = b;
  }
  if (fromInput !== 'picker') $('colorPicker').value = toHex(settings.color);
  $('outR').textContent = r; $('outG').textContent = g; $('outB').textContent = b;
  updatePreview();
  saveSettings();
  if (settings.effect === 'static') pushColor(r, g, b);
}

function pushColor(r, g, b) {
  if (ds.state.connected) ds.setLightbar(r, g, b);
}

function updatePreview() {
  const k = settings.brightness / 100;
  const { r, g, b } = displayColor;
  const el = $('lightbarPreview');
  el.style.background = `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  el.style.boxShadow = `0 0 46px rgba(${r},${g},${b},${0.55 * k})`;
}

let displayColor = { ...settings.color };

$('colorPicker').addEventListener('input', (e) => {
  const v = e.target.value;
  settings.effect = 'static'; syncEffectChips();
  setColor(parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 'picker');
});

['sliderR', 'sliderG', 'sliderB'].forEach((id) => {
  $(id).addEventListener('input', () => {
    settings.effect = 'static'; syncEffectChips();
    setColor(+$('sliderR').value, +$('sliderG').value, +$('sliderB').value, 'sliders');
  });
});

$('sliderBright').addEventListener('input', (e) => {
  settings.brightness = +e.target.value;
  $('outBright').textContent = `${settings.brightness} %`;
  if (ds.state.connected) ds.setBrightness(settings.brightness / 100);
  updatePreview();
  saveSettings();
});

document.querySelectorAll('#effectChips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    settings.effect = chip.dataset.effect;
    syncEffectChips();
    saveSettings();
    if (settings.effect === 'static') pushColor(settings.color.r, settings.color.g, settings.color.b);
  });
});

function syncEffectChips() {
  document.querySelectorAll('#effectChips .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.effect === settings.effect);
  });
  $('speedRow').hidden = !['rainbow', 'breathe', 'pulse'].includes(settings.effect);
}

$('effectSpeed').addEventListener('input', (e) => { settings.speed = +e.target.value; saveSettings(); });

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// Animationsschleife für alle Lightbar-Effekte.
let lastSent = 0;
function animateLightbar(now) {
  const base = settings.color;
  const speed = settings.speed / 100;
  let color = base;

  switch (settings.effect) {
    case 'rainbow':
      color = hsvToRgb(((now / 1000) * speed * 0.6) % 1, 1, 1);
      break;
    case 'breathe': {
      const k = (Math.sin((now / 1000) * speed * 3) + 1) / 2;
      color = { r: base.r * k, g: base.g * k, b: base.b * k };
      break;
    }
    case 'pulse': {
      const k = ((now / 1000) * speed * 2) % 1 < 0.5 ? 1 : 0.05;
      color = { r: base.r * k, g: base.g * k, b: base.b * k };
      break;
    }
    case 'battery': {
      const lvl = ds.state.battery.level ?? 100;
      color = lvl > 60 ? { r: 0, g: 255, b: 40 } : lvl > 25 ? { r: 255, g: 170, b: 0 } : { r: 255, g: 0, b: 0 };
      break;
    }
    case 'reactive': {
      const l = ds.state.triggers.l2, r = ds.state.triggers.r2;
      color = { r: 255 * r, g: 40, b: 255 * l };
      break;
    }
    default:
      color = base;
  }

  color = { r: Math.round(color.r), g: Math.round(color.g), b: Math.round(color.b) };
  displayColor = color;
  updatePreview();

  if (settings.effect !== 'static' && ds.state.connected && now - lastSent > 33) {
    lastSent = now;
    ds.setLightbar(color.r, color.g, color.b);
  }
}

// --------------------------------------------------- Player- und Mikro-LED

document.querySelectorAll('#playerChips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    settings.player = +chip.dataset.player;
    document.querySelectorAll('#playerChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    if (ds.state.connected) ds.setPlayerLeds(PLAYER_PATTERNS[settings.player], settings.playerBrightness);
    saveSettings();
  });
});

$('playerBrightness').addEventListener('change', (e) => {
  settings.playerBrightness = +e.target.value;
  if (ds.state.connected) ds.setPlayerLeds(PLAYER_PATTERNS[settings.player], settings.playerBrightness);
  saveSettings();
});

document.querySelectorAll('#micChips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    settings.mic = +chip.dataset.mic;
    document.querySelectorAll('#micChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    if (ds.state.connected) ds.setMicLed(settings.mic);
    saveSettings();
  });
});

// ---------------------------------------------------------------- Trigger

const TRIGGER_PRESETS = [
  { label: 'Alles aus', left: 'off', right: 'off' },
  { label: 'Shooter', left: { effect: 'resistance', values: { start: 40, force: 130 } }, right: { effect: 'weapon', values: { start: 90, end: 160, force: 255 } } },
  { label: 'Maschinengewehr', left: { effect: 'resistance', values: { start: 0, force: 90 } }, right: { effect: 'vibration', values: { start: 0, force: 200, freq: 12 } } },
  { label: 'Bogen', left: { effect: 'bow', values: { start: 1, end: 5, force: 6, snap: 7 } }, right: 'off' },
  { label: 'Rennspiel (Gas/Bremse)', left: { effect: 'resistance', values: { start: 0, force: 220 } }, right: { effect: 'resistance', values: { start: 0, force: 110 } } },
  { label: 'Voller Widerstand', left: { effect: 'resistance', values: { start: 0, force: 255 } }, right: { effect: 'resistance', values: { start: 0, force: 255 } } },
];

function buildEffectSelect(select) {
  select.innerHTML = '';
  Object.values(TRIGGER_EFFECTS).forEach((eff) => {
    const opt = document.createElement('option');
    opt.value = eff.id;
    opt.textContent = eff.label;
    select.appendChild(opt);
  });
}

function renderParams(side) {
  const cfg = settings.triggers[side];
  const effect = TRIGGER_EFFECTS[cfg.effect] ?? TRIGGER_EFFECTS.off;
  const box = $(`${side}Params`);
  box.innerHTML = '';
  if (!effect.params.length) {
    box.innerHTML = '<p class="hint small">Kein Widerstand – der Trigger läuft frei.</p>';
    return;
  }
  effect.params.forEach((p) => {
    if (cfg.values[p.key] === undefined) cfg.values[p.key] = p.def;
    const label = document.createElement('label');
    label.className = 'slider';
    label.innerHTML = `<span>${p.label}</span>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = p.min; input.max = p.max; input.value = cfg.values[p.key];
    const out = document.createElement('output');
    out.textContent = cfg.values[p.key];
    input.addEventListener('input', () => {
      cfg.values[p.key] = +input.value;
      out.textContent = input.value;
      applyTrigger(side);
      if (settings.linkTriggers) mirrorTrigger(side);
    });
    label.append(input, out);
    box.appendChild(label);
  });
}

function applyTrigger(side) {
  const cfg = settings.triggers[side];
  if (ds.state.connected) ds.setTriggerEffect(side, cfg.effect, cfg.values);
  saveSettings();
}

function mirrorTrigger(from) {
  const other = from === 'left' ? 'right' : 'left';
  settings.triggers[other] = JSON.parse(JSON.stringify(settings.triggers[from]));
  $(`${other}Effect`).value = settings.triggers[other].effect;
  renderParams(other);
  applyTrigger(other);
}

['left', 'right'].forEach((side) => {
  const select = $(`${side}Effect`);
  buildEffectSelect(select);
  select.addEventListener('change', () => {
    settings.triggers[side] = { effect: select.value, values: {} };
    renderParams(side);
    applyTrigger(side);
    if (settings.linkTriggers) mirrorTrigger(side);
  });
});

$('linkTriggers').addEventListener('change', (e) => {
  settings.linkTriggers = e.target.checked;
  saveSettings();
  if (settings.linkTriggers) mirrorTrigger('left');
});

$('triggersOff').addEventListener('click', () => {
  ['left', 'right'].forEach((side) => {
    settings.triggers[side] = { effect: 'off', values: {} };
    $(`${side}Effect`).value = 'off';
    renderParams(side);
    applyTrigger(side);
  });
  toast('Adaptive Trigger ausgeschaltet.', 'ok');
});

const presetRow = $('triggerPresets');
TRIGGER_PRESETS.forEach((preset) => {
  const btn = document.createElement('button');
  btn.className = 'chip';
  btn.textContent = preset.label;
  btn.addEventListener('click', () => {
    ['left', 'right'].forEach((side) => {
      const p = preset[side];
      settings.triggers[side] = typeof p === 'string' ? { effect: p, values: {} } : { effect: p.effect, values: { ...p.values } };
      $(`${side}Effect`).value = settings.triggers[side].effect;
      renderParams(side);
      applyTrigger(side);
    });
  });
  presetRow.appendChild(btn);
});

// ------------------------------------------------------------ Stickdrift

const sticks = {
  left: { canvas: $('stickLeft'), trail: [], key: ['lx', 'ly'] },
  right: { canvas: $('stickRight'), trail: [], key: ['rx', 'ry'] },
};

const test = { mode: null, endsAt: 0, samples: { left: [], right: [] }, sectors: { left: new Float32Array(36), right: new Float32Array(36) } };

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 260;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, size };
}

function drawStick(name) {
  const s = sticks[name];
  const { ctx, size } = setupCanvas(s.canvas);
  const c = size / 2, radius = size / 2 - 14;
  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(c, c, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(c, c, radius * 0.5, 0, Math.PI * 2); ctx.stroke();

  // 5-%-Toleranzring um die Mitte
  ctx.strokeStyle = 'rgba(255,180,0,0.45)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(c, c, radius * 0.05, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath(); ctx.moveTo(c - radius, c); ctx.lineTo(c + radius, c);
  ctx.moveTo(c, c - radius); ctx.lineTo(c, c + radius); ctx.stroke();

  // Im Kreistest: bisher erreichte Auslenkung je Sektor
  if (test.mode === 'circle' || test.finishedMode === 'circle') {
    const sec = test.sectors[name];
    ctx.beginPath();
    for (let i = 0; i <= 36; i++) {
      const a = ((i % 36) / 36) * Math.PI * 2;
      const r = Math.min(1, sec[i % 36]) * radius;
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,120,255,0.18)';
    ctx.strokeStyle = 'rgba(0,160,255,0.8)';
    ctx.fill(); ctx.stroke();
  }

  const [kx, ky] = s.key;
  const x = ds.state.sticks[kx], y = ds.state.sticks[ky];
  s.trail.push([x, y]);
  if (s.trail.length > 90) s.trail.shift();

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  s.trail.forEach(([tx, ty], i) => {
    const px = c + tx * radius, py = c + ty * radius;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.stroke();

  const px = c + x * radius, py = c + y * radius;
  const dist = Math.hypot(x, y);
  ctx.fillStyle = dist > 0.05 ? '#4ade80' : '#ffffff';
  ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.fillText(`X ${x.toFixed(3)}  Y ${y.toFixed(3)}`, 10, size - 10);
}

function collectSample() {
  if (!test.mode) return;
  for (const name of ['left', 'right']) {
    const [kx, ky] = sticks[name].key;
    const x = ds.state.sticks[kx], y = ds.state.sticks[ky];
    if (test.mode === 'rest') {
      test.samples[name].push([x, y]);
    } else {
      const r = Math.hypot(x, y);
      let a = Math.atan2(y, x); if (a < 0) a += Math.PI * 2;
      const idx = Math.min(35, Math.floor((a / (Math.PI * 2)) * 36));
      if (r > test.sectors[name][idx]) test.sectors[name][idx] = r;
      test.samples[name].push([x, y]);
    }
  }
  if (performance.now() >= test.endsAt) finishTest();
}

function startTest(mode, seconds) {
  if (!ds.state.connected) { toast('Bitte zuerst den Controller verbinden.', 'error'); return; }
  test.mode = mode;
  test.finishedMode = null;
  test.endsAt = performance.now() + seconds * 1000;
  test.samples = { left: [], right: [] };
  test.sectors = { left: new Float32Array(36), right: new Float32Array(36) };
  $('driftResults').innerHTML = '';
  updateTestStatus();
}

function updateTestStatus() {
  const el = $('testStatus');
  if (!test.mode) return;
  const left = Math.max(0, (test.endsAt - performance.now()) / 1000);
  el.className = 'test-status running';
  el.textContent = test.mode === 'rest'
    ? `Ruhetest läuft – Sticks NICHT berühren … ${left.toFixed(1)} s`
    : `Kreistest läuft – beide Sticks langsam am äußeren Rand kreisen lassen … ${left.toFixed(1)} s`;
}

function finishTest() {
  const mode = test.mode;
  test.mode = null;
  test.finishedMode = mode;
  $('testStatus').className = 'test-status';
  $('testStatus').textContent = 'Test abgeschlossen.';
  const results = ['left', 'right'].map((name) => (mode === 'rest' ? evalRest(name) : evalCircle(name)));
  renderResults(mode, results);
}

function evalRest(name) {
  const data = test.samples[name];
  const n = data.length || 1;
  const mx = data.reduce((a, [x]) => a + x, 0) / n;
  const my = data.reduce((a, [, y]) => a + y, 0) / n;
  let max = 0, sum = 0;
  for (const [x, y] of data) {
    const r = Math.hypot(x, y);
    if (r > max) max = r;
    sum += r * r;
  }
  const rms = Math.sqrt(sum / n);
  let jitter = 0;
  for (let i = 1; i < data.length; i++) {
    jitter = Math.max(jitter, Math.hypot(data[i][0] - data[i - 1][0], data[i][1] - data[i - 1][1]));
  }
  const pct = max * 100;
  const verdict = pct < 2 ? ['ok', 'Kein Drift'] : pct < 5 ? ['warn', 'Leichter Drift'] : ['bad', 'Deutlicher Drift'];
  return {
    stick: name === 'left' ? 'Linker Stick' : 'Rechter Stick',
    verdict,
    rows: [
      ['Maximale Abweichung', `${pct.toFixed(2)} %`],
      ['Mittlere Abweichung', `${(rms * 100).toFixed(2)} %`],
      ['Ruhelage X / Y', `${(mx * 100).toFixed(2)} % / ${(my * 100).toFixed(2)} %`],
      ['Größter Sprung', `${(jitter * 100).toFixed(2)} %`],
      ['Messwerte', `${data.length}`],
    ],
  };
}

function evalCircle(name) {
  const sec = test.sectors[name];
  const covered = [...sec].filter((v) => v > 0.5).length;
  const outer = [...sec].filter((v) => v > 0.5);
  const min = outer.length ? Math.min(...outer) : 0;
  const max = Math.max(...sec);
  const avg = outer.length ? outer.reduce((a, b) => a + b, 0) / outer.length : 0;
  const roundness = max > 0 ? (min / max) * 100 : 0;
  let verdict;
  if (covered < 30) verdict = ['warn', 'Zu wenig abgedeckt – bitte langsamer kreisen'];
  else if (roundness > 88 && max > 0.9) verdict = ['ok', 'Voller Bereich erreicht'];
  else if (roundness > 75) verdict = ['warn', 'Leicht unrund'];
  else verdict = ['bad', 'Bereich unvollständig – Stickmodul prüfen'];
  return {
    stick: name === 'left' ? 'Linker Stick' : 'Rechter Stick',
    verdict,
    rows: [
      ['Abgedeckte Richtungen', `${covered} / 36`],
      ['Maximaler Ausschlag', `${(max * 100).toFixed(1)} %`],
      ['Kleinster Randwert', `${(min * 100).toFixed(1)} %`],
      ['Durchschnitt am Rand', `${(avg * 100).toFixed(1)} %`],
      ['Rundheit', `${roundness.toFixed(1)} %`],
    ],
  };
}

function renderResults(mode, results) {
  const box = $('driftResults');
  box.innerHTML = `<h3>Ergebnis – ${mode === 'rest' ? 'Ruhetest' : 'Kreistest'}</h3>`;
  const grid = document.createElement('div');
  grid.className = 'result-grid';
  results.forEach((res) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <h4>${res.stick}</h4>
      <span class="verdict ${res.verdict[0]}">${res.verdict[1]}</span>
      <table>${res.rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
    grid.appendChild(card);
  });
  box.appendChild(grid);
  if (mode === 'rest') {
    const note = document.createElement('p');
    note.className = 'hint small';
    note.textContent = 'Faustregel: unter 2 % ist unauffällig, 2–5 % ist beginnender Verschleiß, über 5 % macht sich im Spiel deutlich bemerkbar.';
    box.appendChild(note);
  }
}

$('startRest').addEventListener('click', () => startTest('rest', 5));
$('startCircle').addEventListener('click', () => startTest('circle', 15));
$('resetTest').addEventListener('click', () => {
  test.mode = null; test.finishedMode = null;
  test.sectors = { left: new Float32Array(36), right: new Float32Array(36) };
  sticks.left.trail = []; sticks.right.trail = [];
  $('driftResults').innerHTML = '';
  $('testStatus').className = 'test-status';
  $('testStatus').textContent = 'Bereit. Controller verbinden und Test wählen.';
});

// ------------------------------------------------------------- Tastentest

const BUTTON_MAP = [
  ['cross', '✕'], ['circle', '◯'], ['square', '▢'], ['triangle', '△'],
  ['up', '▲ Oben'], ['down', '▼ Unten'], ['left', '◀ Links'], ['right', '▶ Rechts'],
  ['l1', 'L1'], ['r1', 'R1'], ['l2', 'L2'], ['r2', 'R2'],
  ['l3', 'L3'], ['r3', 'R3'], ['create', 'Create'], ['options', 'Options'],
  ['ps', 'PS'], ['touchpad', 'Touchpad'], ['mute', 'Mute'],
];
const seen = new Set();
const buttonEls = new Map();
const mapBox = $('buttonMap');
BUTTON_MAP.forEach(([key, label]) => {
  const el = document.createElement('div');
  el.className = 'btn-cell';
  el.textContent = label;
  mapBox.appendChild(el);
  buttonEls.set(key, el);
});
$('resetButtons').addEventListener('click', () => {
  seen.clear();
  buttonEls.forEach((el) => el.classList.remove('seen'));
});

function updateButtons() {
  const s = ds.state;
  BUTTON_MAP.forEach(([key]) => {
    const pressed = s.dpad[key] ?? s.buttons[key] ?? false;
    const el = buttonEls.get(key);
    el.classList.toggle('down', !!pressed);
    if (pressed && !seen.has(key)) { seen.add(key); el.classList.add('seen'); }
  });
}

function drawTouchpad() {
  const canvas = $('touchpad');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 480, h = w * (220 / 480);
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();

  ds.state.touch.forEach((t, i) => {
    if (!t) return;
    ctx.fillStyle = i === 0 ? '#4ade80' : '#60a5fa';
    ctx.beginPath(); ctx.arc(t.x * w, t.y * h, 12, 0, Math.PI * 2); ctx.fill();
  });

  if (!ds.state.touch[0] && !ds.state.touch[1]) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Finger auf das Touchpad legen', w / 2, h / 2);
    ctx.textAlign = 'left';
  }
}

// ---------------------------------------------------------------- Rumble

let rumbleTimer = null;
function pushRumble() {
  const l = +$('rumbleL').value, r = +$('rumbleR').value;
  $('outRumbleL').textContent = l; $('outRumbleR').textContent = r;
  if (ds.state.connected) ds.setRumble(l, r);
}
$('rumbleL').addEventListener('input', pushRumble);
$('rumbleR').addEventListener('input', pushRumble);
$('rumbleTest').addEventListener('click', () => {
  if (!ds.state.connected) { toast('Bitte zuerst den Controller verbinden.', 'error'); return; }
  clearTimeout(rumbleTimer);
  ds.setRumble(200, 0);
  rumbleTimer = setTimeout(() => {
    ds.setRumble(0, 200);
    rumbleTimer = setTimeout(() => ds.setRumble(0, 0), 500);
  }, 500);
});
$('rumbleStop').addEventListener('click', () => {
  clearTimeout(rumbleTimer);
  $('rumbleL').value = 0; $('rumbleR').value = 0;
  pushRumble();
});

// ------------------------------------------------ Einstellungen anwenden

function applyAllSettings() {
  ds.setBrightness(settings.brightness / 100);
  ds.setPlayerLeds(PLAYER_PATTERNS[settings.player], settings.playerBrightness);
  ds.setMicLed(settings.mic);
  ['left', 'right'].forEach((side) => ds.setTriggerEffect(side, settings.triggers[side].effect, settings.triggers[side].values));
  if (settings.effect === 'static') ds.setLightbar(settings.color.r, settings.color.g, settings.color.b);
}

function initUiFromSettings() {
  setColor(settings.color.r, settings.color.g, settings.color.b);
  $('sliderBright').value = settings.brightness;
  $('outBright').textContent = `${settings.brightness} %`;
  $('effectSpeed').value = settings.speed;
  syncEffectChips();
  document.querySelectorAll('#playerChips .chip').forEach((c) => c.classList.toggle('active', +c.dataset.player === settings.player));
  document.querySelectorAll('#micChips .chip').forEach((c) => c.classList.toggle('active', +c.dataset.mic === settings.mic));
  $('playerBrightness').value = settings.playerBrightness;
  $('linkTriggers').checked = settings.linkTriggers;
  ['left', 'right'].forEach((side) => {
    $(`${side}Effect`).value = settings.triggers[side].effect;
    renderParams(side);
  });
}
initUiFromSettings();

// ------------------------------------------------------------- Hauptloop

function frame(now) {
  animateLightbar(now);

  if (ds.state.connected) {
    const b = ds.state.battery;
    $('infoBattery').textContent = b.level === null ? 'unbekannt'
      : `${b.level} %${b.charging ? ' ⚡ lädt' : b.full ? ' ✓ voll' : ''}`;
    $('infoRate').textContent = `${ds.state.reportRate} Hz`;
    $('infoOut').textContent = ds.state.lastError
      ? 'Fehler'
      : `${ds.state.outputsSent} Pakete`;
    $('infoOut').title = ds.state.lastError || 'Ausgabepakete an den Controller';
  }

  $('l2Fill').style.width = `${ds.state.triggers.l2 * 100}%`;
  $('r2Fill').style.width = `${ds.state.triggers.r2 * 100}%`;
  $('l2Value').textContent = `${Math.round(ds.state.triggers.l2 * 100)} %`;
  $('r2Value').textContent = `${Math.round(ds.state.triggers.r2 * 100)} %`;

  const activeTab = document.querySelector('.tab.active').dataset.tab;
  if (activeTab === 'drift') { drawStick('left'); drawStick('right'); }
  if (activeTab === 'test') { updateButtons(); drawTouchpad(); }

  if (test.mode) { collectSample(); updateTestStatus(); }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => { if (ds.state.connected) ds.setRumble(0, 0); });

// ---------------------------------------------------------------- Diagnose

function liveStatus() {
  const s = ds.state;
  if (!s.connected) return 'Aktuelle Verbindung: keine';
  const hex = (v) => `0x${v.toString(16).padStart(4, '0')}`;
  return [
    'Aktuelle Verbindung:',
    `  Gerät: ${s.name} (${hex(s.vendorId)}/${hex(s.productId)})`,
    `  Transportweg: ${s.connection}`,
    `  Empfangene Reports: ${s.reportsSeen} (${s.reportRate} pro Sekunde)`,
    `  Gesendete Pakete: ${s.outputsSent}`,
    `  Letzter Report: ${s.lastReport ? `ID ${hex(s.lastReport.id)}, ${s.lastReport.length} Byte` : 'noch keiner'}`,
    `  Sticks roh: L ${s.sticks.rawLx}/${s.sticks.rawLy}  R ${s.sticks.rawRx}/${s.sticks.rawRy}`,
    `  Letzter Sendefehler: ${s.lastError || 'keiner'}`,
  ].join('\n');
}

$('diagBtn').addEventListener('click', async () => {
  const text = `${await DualSense.diagnose()}\n\n${liveStatus()}`;
  const out = $('diagOut');
  out.textContent = text;
  out.hidden = false;
  $('diagCopy').hidden = false;
});

$('diagCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('diagOut').textContent);
    toast('Diagnose kopiert.', 'ok');
  } catch {
    toast('Kopieren nicht möglich – Text bitte von Hand markieren.', 'error');
  }
});

// Schneller Sichttest: drei kräftige Farben nacheinander.
$('colorTest').addEventListener('click', async () => {
  if (!ds.state.connected) { toast('Bitte zuerst den Controller verbinden.', 'error'); return; }
  settings.effect = 'static';
  syncEffectChips();
  const steps = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  for (const [r, g, b] of steps) {
    setColor(r, g, b);
    await new Promise((done) => setTimeout(done, 700));
  }
  toast('Farbtest fertig. Hat die Lightbar rot, grün und blau gezeigt?', 'ok');
});
