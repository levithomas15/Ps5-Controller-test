// CRC-32 (IEEE 802.3, reflected) – wird für DualSense-Ausgabereports über
// Bluetooth benötigt. Ohne gültige Prüfsumme verwirft der Controller das Paket.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** @param {Uint8Array} bytes @returns {number} CRC32 als unsigned 32-Bit-Wert */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
