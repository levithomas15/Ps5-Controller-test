// Minimaler DualSense-Treiber auf Basis der WebHID-API.
//
// Der Controller spricht zwei Dialekte:
//   USB       -> Eingabereport 0x01 (64 Byte), Ausgabereport 0x02 (47 Byte)
//   Bluetooth -> Eingabereport 0x31 (78 Byte), Ausgabereport 0x31 (77 Byte)
//                mit Sequenznummer, Header 0x02 und CRC32 am Ende.
// Die eigentliche Nutzlast (47 Byte) ist in beiden Fällen identisch, sie liegt
// bei Bluetooth nur zwei Byte weiter hinten.

import { crc32 } from './crc32.js';

export const SONY_VENDOR_ID = 0x054c;
export const DUALSENSE_PRODUCT_IDS = [0x0ce6, 0x0df2]; // DualSense, DualSense Edge

/** Sony-Controller, die zwar erkannt werden, aber ein anderes Protokoll sprechen. */
export const OTHER_SONY_CONTROLLERS = {
  0x05c4: 'DualShock 4 (1. Generation)',
  0x09cc: 'DualShock 4 (2. Generation)',
  0x0ba0: 'DualShock 4 USB-Adapter',
};

const OUT_USB = 0x02;
const OUT_BT = 0x31;
const IN_USB = 0x01;
const IN_BT = 0x31;

// valid_flag0
const FLAG0_COMPATIBLE_VIBRATION = 0x01;
const FLAG0_HAPTICS_SELECT = 0x02;
const FLAG0_RIGHT_TRIGGER = 0x04;
const FLAG0_LEFT_TRIGGER = 0x08;
// valid_flag1
const FLAG1_MIC_LED = 0x01;
const FLAG1_LIGHTBAR = 0x04;
const FLAG1_RELEASE_LEDS = 0x08;
const FLAG1_PLAYER_LEDS = 0x10;

/** Player-Muster wie auf der PS5 (Balkenanordnung der fünf LEDs). */
export const PLAYER_PATTERNS = [0x00, 0x04, 0x0a, 0x15, 0x1b, 0x1f];

/**
 * Trigger-Effekte. `params` beschreibt die Regler, die die Oberfläche für den
 * jeweiligen Modus anzeigt; die Werte landen 1:1 in den Effekt-Bytes.
 */
export const TRIGGER_EFFECTS = {
  off: { id: 'off', label: 'Aus', mode: 0x05, params: [] },
  resistance: {
    id: 'resistance', label: 'Widerstand', mode: 0x01,
    params: [
      { key: 'start', label: 'Startpunkt', min: 0, max: 255, def: 0 },
      { key: 'force', label: 'Stärke', min: 0, max: 255, def: 190 },
    ],
  },
  weapon: {
    id: 'weapon', label: 'Waffe (Abzugspunkt)', mode: 0x02,
    params: [
      { key: 'start', label: 'Startpunkt', min: 0, max: 255, def: 90 },
      { key: 'end', label: 'Endpunkt', min: 0, max: 255, def: 160 },
      { key: 'force', label: 'Stärke', min: 0, max: 255, def: 255 },
    ],
  },
  vibration: {
    id: 'vibration', label: 'Vibration (Maschinengewehr)', mode: 0x06,
    params: [
      { key: 'start', label: 'Startpunkt', min: 0, max: 255, def: 0 },
      { key: 'force', label: 'Stärke', min: 0, max: 255, def: 200 },
      { key: 'freq', label: 'Frequenz', min: 1, max: 60, def: 12 },
    ],
  },
  bow: {
    id: 'bow', label: 'Bogen', mode: 0x22,
    params: [
      { key: 'start', label: 'Startpunkt', min: 0, max: 8, def: 1 },
      { key: 'end', label: 'Endpunkt', min: 0, max: 8, def: 5 },
      { key: 'force', label: 'Stärke', min: 0, max: 8, def: 6 },
      { key: 'snap', label: 'Schnappkraft', min: 0, max: 8, def: 7 },
    ],
  },
  galloping: {
    id: 'galloping', label: 'Galopp', mode: 0x23,
    params: [
      { key: 'start', label: 'Startpunkt', min: 0, max: 8, def: 0 },
      { key: 'end', label: 'Endpunkt', min: 0, max: 9, def: 9 },
      { key: 'first', label: 'Huf 1', min: 0, max: 6, def: 2 },
      { key: 'second', label: 'Huf 2', min: 0, max: 7, def: 5 },
      { key: 'freq', label: 'Frequenz', min: 1, max: 15, def: 3 },
    ],
  },
  machine: {
    id: 'machine', label: 'Maschine', mode: 0x27,
    params: [
      { key: 'start', label: 'Startpunkt', min: 0, max: 8, def: 1 },
      { key: 'end', label: 'Endpunkt', min: 0, max: 9, def: 9 },
      { key: 'ampA', label: 'Amplitude A', min: 0, max: 7, def: 5 },
      { key: 'ampB', label: 'Amplitude B', min: 0, max: 7, def: 5 },
      { key: 'freq', label: 'Frequenz', min: 0, max: 255, def: 10 },
      { key: 'period', label: 'Periode', min: 0, max: 255, def: 0 },
    ],
  },
};

/** Baut die 11 Effekt-Bytes (Modus + 10 Parameter) für einen Trigger. */
function encodeTriggerEffect(effectId, values) {
  const out = new Uint8Array(11);
  const effect = TRIGGER_EFFECTS[effectId] ?? TRIGGER_EFFECTS.off;
  out[0] = effect.mode;
  effect.params.forEach((p, i) => {
    const v = values?.[p.key];
    out[i + 1] = Math.max(0, Math.min(255, Math.round(v ?? p.def)));
  });
  return out;
}

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));

export class DualSense extends EventTarget {
  constructor() {
    super();
    /** @type {HIDDevice|null} */
    this.device = null;
    this.connection = 'none'; // 'usb' | 'bluetooth'
    this.seq = 0;
    this.lastOutputAt = 0;
    this.pendingOutput = false;
    this.firstOutputSent = false;

    this.output = {
      lightbar: { r: 0, g: 60, b: 255 },
      brightness: 1,
      playerLeds: 0x00,
      playerBrightness: 0, // 0 = hell, 1 = mittel, 2 = dunkel
      micLed: 0,
      rumble: { left: 0, right: 0 },
      triggers: {
        left: { effect: 'off', values: {} },
        right: { effect: 'off', values: {} },
      },
    };

    this.state = {
      connected: false,
      connection: 'none',
      name: '',
      sticks: { lx: 0, ly: 0, rx: 0, ry: 0, rawLx: 128, rawLy: 128, rawRx: 128, rawRy: 128 },
      triggers: { l2: 0, r2: 0 },
      buttons: {},
      dpad: { up: false, down: false, left: false, right: false },
      touch: [null, null],
      battery: { level: null, charging: false, full: false },
      reportRate: 0,
      reportsSeen: 0,
      lastReport: null,
      lastError: '',
      vendorId: 0,
      productId: 0,
    };

    this._reportTimes = [];
    this._onInputReport = this._onInputReport.bind(this);
    this._onDisconnect = this._onDisconnect.bind(this);
    navigator.hid?.addEventListener('disconnect', this._onDisconnect);
  }

  static get supported() {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  /** Bereits freigegebene Controller (nach Reload ohne neuen Dialog nutzbar). */
  static async getKnownDevices() {
    if (!DualSense.supported) return [];
    const devices = await navigator.hid.getDevices();
    return devices.filter((d) => d.vendorId === SONY_VENDOR_ID);
  }

  /**
   * Öffnet den Browser-Dialog zur Geräteauswahl. Gefiltert wird nur nach Sony
   * als Hersteller: Wäre die Produktnummer fest vorgegeben, bliebe der Dialog
   * bei jeder Controller-Revision leer, die wir noch nicht kennen.
   */
  static async requestDevice() {
    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: SONY_VENDOR_ID }],
    });
    return devices[0] ?? null;
  }

  /** Grobe Einordnung eines ausgewählten Geräts für verständliche Meldungen. */
  static identify(device) {
    if (!device) return { kind: 'none' };
    if (device.vendorId !== SONY_VENDOR_ID) return { kind: 'foreign' };
    if (DUALSENSE_PRODUCT_IDS.includes(device.productId)) return { kind: 'dualsense' };
    if (OTHER_SONY_CONTROLLERS[device.productId]) {
      return { kind: 'other-sony', name: OTHER_SONY_CONTROLLERS[device.productId] };
    }
    return { kind: 'unknown-sony' };
  }

  /** Sammelt alles, was für die Fehlersuche einer Verbindung nützlich ist. */
  static async diagnose() {
    const lines = [];
    const hex = (v) => `0x${v.toString(16).padStart(4, '0')}`;
    lines.push(`WebHID verfügbar: ${DualSense.supported ? 'ja' : 'NEIN'}`);
    lines.push(`Sicherer Kontext (https/localhost): ${globalThis.isSecureContext ? 'ja' : 'NEIN'}`);
    lines.push(`Adresse: ${location.origin}`);
    lines.push(`Browser: ${navigator.userAgent}`);
    if (!DualSense.supported) return lines.join('\n');

    const devices = await navigator.hid.getDevices();
    lines.push(`Bereits freigegebene HID-Geräte: ${devices.length}`);
    for (const d of devices) {
      const usages = (d.collections ?? [])
        .map((c) => `${hex(c.usagePage)}:${hex(c.usage)}`)
        .join(', ');
      const out = (d.collections ?? []).flatMap((c) => c.outputReports ?? []).map((r) => hex(r.reportId));
      lines.push(`  - ${d.productName || '(ohne Namen)'} | Hersteller ${hex(d.vendorId)} | Produkt ${hex(d.productId)}`);
      lines.push(`    geöffnet: ${d.opened ? 'ja' : 'nein'} | Collections: ${usages || 'keine'} | Ausgabereports: ${out.join(', ') || 'keine'}`);
    }
    if (!devices.length) {
      lines.push('  (noch nichts freigegeben – im Auswahldialog muss der Controller erst bestätigt werden)');
    }
    return lines.join('\n');
  }

  async open(device) {
    if (!device) throw new Error('Kein Gerät ausgewählt.');
    if (this.device) await this.close();
    if (!device.opened) await device.open();

    this.device = device;
    this.device.addEventListener('inputreport', this._onInputReport);
    this.state.name = device.productName || 'DualSense';
    this.state.vendorId = device.vendorId;
    this.state.productId = device.productId;
    this.state.reportsSeen = 0;

    // Die Verbindungsart erkennt man am Ausgabereport, den das Gerät anbietet.
    const reportIds = new Set();
    for (const c of device.collections ?? []) {
      for (const r of c.outputReports ?? []) reportIds.add(r.reportId);
    }
    this.connection = reportIds.has(OUT_USB) ? 'usb' : 'bluetooth';
    this.state.connection = this.connection;
    this.state.connected = true;

    // Über Bluetooth liefert der Controller anfangs nur einen Minimalreport.
    // Das Lesen des Kalibrier-Feature-Reports schaltet den vollen Modus frei.
    try {
      await device.receiveFeatureReport(0x05);
    } catch { /* unter USB nicht nötig */ }

    this.firstOutputSent = false;
    this.emit('connect');
    await this.flush(true);
    return this;
  }

  async close() {
    const device = this.device;
    if (!device) return;
    this.device = null;
    device.removeEventListener('inputreport', this._onInputReport);
    try {
      // Lightbar und Effekte aufräumen, damit der Controller nicht "hängen" bleibt.
      this.output.lightbar = { r: 0, g: 0, b: 0 };
      this.output.rumble = { left: 0, right: 0 };
      this.output.triggers.left = { effect: 'off', values: {} };
      this.output.triggers.right = { effect: 'off', values: {} };
      this.output.playerLeds = 0;
      this.output.micLed = 0;
      this.device = device;
      await this.flush(true);
      this.device = null;
      await device.close();
    } catch { /* egal, das Gerät ist ohnehin weg */ }
    this.state.connected = false;
    this.state.connection = 'none';
    this.connection = 'none';
    this.emit('disconnect');
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _onDisconnect(event) {
    if (this.device && event.device === this.device) {
      this.device = null;
      this.state.connected = false;
      this.state.connection = 'none';
      this.connection = 'none';
      this.emit('disconnect');
    }
  }

  // ---------------------------------------------------------------- Eingabe

  _onInputReport(event) {
    const { data, reportId } = event;
    this.state.lastReport = { id: reportId, length: data.byteLength };

    let offset;
    if (reportId === IN_USB && data.byteLength >= 40) offset = 0;
    else if (reportId === IN_BT && data.byteLength >= 40) offset = 1;
    else if (reportId === IN_USB && data.byteLength < 40) {
      // Bluetooth-Minimalreport: nur Sticks und Tasten.
      this._syncTransport('bluetooth');
      this._parseMinimal(data);
      this.emit('input');
      return;
    } else return;

    this._syncTransport(offset === 0 ? 'usb' : 'bluetooth');

    const b = (i) => data.getUint8(offset + i);
    const s = this.state;

    s.sticks.rawLx = b(0); s.sticks.rawLy = b(1);
    s.sticks.rawRx = b(2); s.sticks.rawRy = b(3);
    s.sticks.lx = (b(0) - 127.5) / 127.5;
    s.sticks.ly = (b(1) - 127.5) / 127.5;
    s.sticks.rx = (b(2) - 127.5) / 127.5;
    s.sticks.ry = (b(3) - 127.5) / 127.5;
    s.triggers.l2 = b(4) / 255;
    s.triggers.r2 = b(5) / 255;

    this._parseButtons(b(7), b(8), b(9));

    if (data.byteLength >= offset + 40) {
      s.touch[0] = this._parseTouch(b(32), b(33), b(34), b(35));
      s.touch[1] = this._parseTouch(b(36), b(37), b(38), b(39));
    }

    if (data.byteLength >= offset + 54) {
      const status0 = b(52);
      const level = status0 & 0x0f;
      const chargeState = (status0 >> 4) & 0x0f;
      // Der Ladestand kommt als Stufe 0-10, daraus werden grobe Prozent.
      s.battery.charging = chargeState === 0x01;
      s.battery.full = chargeState === 0x02;
      s.battery.level = s.battery.full ? 100 : Math.min(100, level * 10);
    }

    this._trackRate();
    this.emit('input');
  }

  /**
   * Die Verbindungsart wird beim Öffnen anhand der angebotenen Ausgabereports
   * geraten. Was tatsächlich hereinkommt, ist die verlässlichere Auskunft:
   * Report 0x31 heißt Bluetooth, ein voller 0x01 heißt USB. Liegt die
   * Vermutung daneben, gingen alle Ausgaben ins Leere – Farbe und Trigger
   * blieben ohne Wirkung.
   */
  _syncTransport(kind) {
    if (this.connection === kind) return;
    this.connection = kind;
    this.state.connection = kind;
    this.emit('transport', kind);
    this.firstOutputSent = false;
    this.flush(true);
  }

  _parseMinimal(data) {
    const s = this.state;
    s.sticks.rawLx = data.getUint8(0); s.sticks.rawLy = data.getUint8(1);
    s.sticks.rawRx = data.getUint8(2); s.sticks.rawRy = data.getUint8(3);
    s.sticks.lx = (s.sticks.rawLx - 127.5) / 127.5;
    s.sticks.ly = (s.sticks.rawLy - 127.5) / 127.5;
    s.sticks.rx = (s.sticks.rawRx - 127.5) / 127.5;
    s.sticks.ry = (s.sticks.rawRy - 127.5) / 127.5;
    this._parseButtons(data.getUint8(4), data.getUint8(5), data.getUint8(6));
    s.triggers.l2 = data.getUint8(7) / 255;
    s.triggers.r2 = data.getUint8(8) / 255;
    this._trackRate();
  }

  _parseButtons(b0, b1, b2) {
    const dpad = b0 & 0x0f;
    this.state.dpad = {
      up: [0, 1, 7].includes(dpad),
      right: [1, 2, 3].includes(dpad),
      down: [3, 4, 5].includes(dpad),
      left: [5, 6, 7].includes(dpad),
    };
    this.state.buttons = {
      square: !!(b0 & 0x10), cross: !!(b0 & 0x20), circle: !!(b0 & 0x40), triangle: !!(b0 & 0x80),
      l1: !!(b1 & 0x01), r1: !!(b1 & 0x02), l2: !!(b1 & 0x04), r2: !!(b1 & 0x08),
      create: !!(b1 & 0x10), options: !!(b1 & 0x20), l3: !!(b1 & 0x40), r3: !!(b1 & 0x80),
      ps: !!(b2 & 0x01), touchpad: !!(b2 & 0x02), mute: !!(b2 & 0x04),
    };
  }

  _parseTouch(b0, b1, b2, b3) {
    if (b0 & 0x80) return null; // Bit 7 gesetzt = kein Finger auf dem Feld
    return {
      id: b0 & 0x7f,
      x: (b1 | ((b2 & 0x0f) << 8)) / 1920,
      y: ((b2 >> 4) | (b3 << 4)) / 1080,
    };
  }

  _trackRate() {
    this.state.reportsSeen++;
    const now = performance.now();
    this._reportTimes.push(now);
    while (this._reportTimes.length && now - this._reportTimes[0] > 1000) this._reportTimes.shift();
    this.state.reportRate = this._reportTimes.length;
  }

  // ---------------------------------------------------------------- Ausgabe

  setLightbar(r, g, b) {
    this.output.lightbar = { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
    this.flush();
  }

  setBrightness(value) {
    this.output.brightness = Math.max(0, Math.min(1, value));
    this.flush();
  }

  setPlayerLeds(mask, brightness = this.output.playerBrightness) {
    this.output.playerLeds = mask & 0x1f;
    this.output.playerBrightness = brightness;
    this.flush();
  }

  setMicLed(mode) {
    this.output.micLed = mode; // 0 = aus, 1 = an, 2 = pulsierend
    this.flush();
  }

  setRumble(left, right) {
    this.output.rumble = { left: clampByte(left), right: clampByte(right) };
    this.flush();
  }

  setTriggerEffect(side, effect, values = {}) {
    this.output.triggers[side] = { effect, values };
    this.flush();
  }

  /** Baut die gemeinsame 47-Byte-Nutzlast beider Transportarten. */
  _buildCommon() {
    const d = new Uint8Array(47);
    const o = this.output;

    let flag0 = FLAG0_COMPATIBLE_VIBRATION | FLAG0_HAPTICS_SELECT | FLAG0_LEFT_TRIGGER | FLAG0_RIGHT_TRIGGER;
    let flag1 = FLAG1_LIGHTBAR | FLAG1_PLAYER_LEDS | FLAG1_MIC_LED;

    d[2] = o.rumble.right;
    d[3] = o.rumble.left;
    d[8] = o.micLed;

    d.set(encodeTriggerEffect(o.triggers.right.effect, o.triggers.right.values), 10);
    d.set(encodeTriggerEffect(o.triggers.left.effect, o.triggers.left.values), 21);

    if (!this.firstOutputSent) {
      // Einmalig die werkseitige Einschalt-Animation der Lightbar beenden.
      // Wichtig: Byte 41 (lightbar_setup) bleibt dabei unangetastet – der Wert
      // 0x02 bedeutet dort "Lightbar aus" und würde die Farbe dauerhaft
      // unterdrücken, egal welches RGB danach folgt.
      flag1 |= FLAG1_RELEASE_LEDS;
    }

    d[42] = o.playerBrightness;
    d[43] = o.playerLeds;

    const k = o.brightness;
    d[44] = clampByte(o.lightbar.r * k);
    d[45] = clampByte(o.lightbar.g * k);
    d[46] = clampByte(o.lightbar.b * k);

    d[0] = flag0;
    d[1] = flag1;
    return d;
  }

  /**
   * Sendet den aktuellen Ausgabezustand. Aufrufe werden auf ~125 Hz gedrosselt
   * und zusammengefasst, damit Animationen den HID-Kanal nicht überfluten.
   */
  async flush(immediate = false) {
    if (!this.device) return;
    const now = performance.now();
    if (!immediate && now - this.lastOutputAt < 8) {
      if (this.pendingOutput) return;
      this.pendingOutput = true;
      setTimeout(() => { this.pendingOutput = false; this.flush(true); }, 8);
      return;
    }
    this.lastOutputAt = now;

    const common = this._buildCommon();
    try {
      if (this.connection === 'usb') {
        const data = new Uint8Array(47);
        data.set(common, 0);
        await this.device.sendReport(OUT_USB, data);
      } else {
        const data = new Uint8Array(77);
        data[0] = (this.seq << 4) | 0x00;
        data[1] = 0x02;
        data.set(common, 2);
        this.seq = (this.seq + 1) & 0x0f;

        const check = new Uint8Array(75);
        check[0] = 0xa2; // HID-Datenpräfix, gehört mit in die Prüfsumme
        check[1] = OUT_BT;
        check.set(data.subarray(0, 73), 2);
        const crc = crc32(check);
        data[73] = crc & 0xff;
        data[74] = (crc >>> 8) & 0xff;
        data[75] = (crc >>> 16) & 0xff;
        data[76] = (crc >>> 24) & 0xff;
        await this.device.sendReport(OUT_BT, data);
      }
      this.firstOutputSent = true;
    } catch (err) {
      this.state.lastError = err.message;
      this.emit('error', err);
    }
  }
}
