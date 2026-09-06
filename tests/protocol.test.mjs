// Protokolltests ohne Browser: node tests/protocol.test.mjs
// Prüft den Aufbau der Ausgabereports (USB + Bluetooth inkl. CRC32) und das
// Zerlegen der Eingabereports anhand von Hand gebauter Beispielpakete.

Object.defineProperty(globalThis, 'navigator', { value: { hid: { addEventListener() {} } }, configurable: true });
const { DualSense } = await import('../src/dualsense.js');
const { crc32 } = await import('../src/crc32.js');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  -', m); };

assert(crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'CRC32-Testvektor 123456789');

const ds = new DualSense();
const sent = [];
ds.device = { sendReport: (id, data) => { sent.push({ id, data: Uint8Array.from(data) }); return Promise.resolve(); } };

// --- USB-Ausgabe
ds.connection = 'usb';
ds.output.lightbar = { r: 10, g: 20, b: 30 };
ds.output.rumble = { left: 5, right: 7 };
ds.output.playerLeds = 0x15;
ds.output.triggers.right = { effect: 'weapon', values: { start: 90, end: 160, force: 255 } };
ds.output.triggers.left = { effect: 'resistance', values: { start: 3, force: 200 } };
await ds.flush(true);
let { id, data } = sent.pop();
assert(id === 0x02 && data.length === 47, 'USB-Report 0x02 mit 47 Byte');
assert(data[2] === 7 && data[3] === 5, 'Rumble rechts/links an Position 2/3');
assert(data[10] === 0x02 && data[11] === 90 && data[12] === 160 && data[13] === 255, 'R2-Effekt ab Byte 10');
assert(data[21] === 0x01 && data[22] === 3 && data[23] === 200, 'L2-Effekt ab Byte 21');
assert(data[43] === 0x15, 'Player-LEDs an Byte 43');
assert(data[44] === 10 && data[45] === 20 && data[46] === 30, 'RGB an Byte 44-46');
assert((data[0] & 0x0c) === 0x0c, 'Trigger-Flags in valid_flag0');
assert((data[1] & 0x14) === 0x14, 'Lightbar- und Player-Flag in valid_flag1');

// Helligkeit skaliert die Farbe
ds.output.brightness = 0.5;
await ds.flush(true);
({ data } = sent.pop());
assert(data[44] === 5 && data[46] === 15, 'Helligkeit skaliert RGB');

// --- Bluetooth-Ausgabe
ds.connection = 'bluetooth';
ds.seq = 0;
await ds.flush(true);
({ id, data } = sent.pop());
assert(id === 0x31 && data.length === 77, 'BT-Report 0x31 mit 77 Byte');
assert(data[1] === 0x02, 'BT-Header 0x02');
const check = new Uint8Array(75);
check[0] = 0xa2; check[1] = 0x31; check.set(data.subarray(0, 73), 2);
const crc = crc32(check);
assert(data[73] === (crc & 0xff) && data[76] === ((crc >>> 24) & 0xff), 'CRC32 am Reportende');
assert(ds.seq === 1, 'Sequenznummer erhöht sich');

// --- Eingabe parsen (USB-Report 0x01)
const buf = new Uint8Array(64);
buf[0] = 255; buf[1] = 0; buf[2] = 128; buf[3] = 128; buf[4] = 51; buf[5] = 255;
buf[7] = 0x20 | 0x03;      // Kreuz + D-Pad rechts-unten
buf[8] = 0x01;             // L1
buf[9] = 0x02;             // Touchpad-Taste
buf[32] = 0x00; buf[33] = 0x60; buf[34] = 0x31; buf[35] = 0x0f; // Touch 0
buf[36] = 0x80;            // Touch 1 inaktiv
buf[52] = 0x18;            // Akku 8/10, lädt
ds._onInputReport({ reportId: 0x01, data: new DataView(buf.buffer) });
const s = ds.state;
assert(Math.abs(s.sticks.lx - 1) < 0.01 && Math.abs(s.sticks.ly + 1) < 0.01, 'Linker Stick voll rechts/oben');
assert(Math.abs(s.sticks.rx) < 0.01, 'Rechter Stick zentriert');
assert(Math.abs(s.triggers.l2 - 0.2) < 0.01 && s.triggers.r2 === 1, 'L2/R2 normalisiert');
assert(s.buttons.cross && s.buttons.l1 && s.buttons.touchpad && !s.buttons.circle, 'Tasten erkannt');
assert(s.dpad.right && s.dpad.down && !s.dpad.up, 'D-Pad rechts-unten');
assert(s.touch[0] && s.touch[1] === null, 'Touchpunkt 0 aktiv, 1 inaktiv');
assert(s.battery.level === 80 && s.battery.charging, 'Akku 80 %, lädt');

// --- Bluetooth-Eingabe (Report 0x31, ein Byte Versatz)
const bt = new Uint8Array(78);
bt[1 + 0] = 200; bt[1 + 1] = 100; bt[1 + 7] = 0x80; // Dreieck
ds._onInputReport({ reportId: 0x31, data: new DataView(bt.buffer) });
assert(ds.state.sticks.rawLx === 200 && ds.state.buttons.triangle, 'BT-Report mit Versatz 1 gelesen');
