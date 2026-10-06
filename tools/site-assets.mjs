// Images for the web page, straight from toywars.bin: every sprite (one PNG
// each, transparent background; a sprite pixel = 1 color clock x 2
// scanlines, drawn 6 x 6 so it keeps TV proportions) and a gameplay screenshot.
// usage: node tools/site-assets.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';
import { writeFramePng } from './atari/png.mjs';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { NTSC_PALETTE_RGB } from '../src/palette.mjs';

// RGBA PNG: color 0 is transparent (so sprites sit on any background)
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
function writeSpritePng(path, rows, xs, ys) {
  const w = rows[0].length * xs, h = rows.length * ys;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  rows.flatMap((r) => Array(ys).fill(r)).forEach((row, y) => {
    let o = y * (w * 4 + 1) + 1;
    for (const c of row) for (let i = 0; i < xs; i++) {
      const rgb = NTSC_PALETTE_RGB[(c >> 1) & 0x7f];
      raw[o++] = (rgb >> 16) & 255; raw[o++] = (rgb >> 8) & 255; raw[o++] = rgb & 255; raw[o++] = c ? 255 : 0;
    }
  });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const rom = readFileSync('toywars.bin');
const SYM = Object.fromEntries(readFileSync('tools/build/toywars.sym', 'latin1').split(/\r?\n/).map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const bank1 = (a) => rom[4096 + (a & 0xfff)];
const RED = 0x46, RED_DK = 0x42, ORANGE = 0x38, ORANGE_DK = 0x34, GREEN = 0xc8;
mkdirSync('img/sprites', { recursive: true });
function sprite(label, file, [dark, light]) {
  const rows = Array.from({ length: 11 }, (_, i) => bank1(SYM[label] + i)); // bottom row first
  while (rows.length > 1 && rows.at(-1) === 0) rows.pop();                  // trim empty top rows
  const out = rows.map((v, k) => Array.from({ length: 8 }, (_, b) => (v & (0x80 >> b) ? (k < 3 ? dark : light) : 0))).reverse();
  writeSpritePng(`img/sprites/${file}.png`, out.flatMap((r) => [Uint8Array.from(r), Uint8Array.from(r)]), 6, 3);
}
for (const [l, f] of [['D_ARMY', 'army'], ['D_TEDDY', 'teddy'], ['D_TANK', 'tank'], ['D_JACK', 'jack'], ['D_CANNON', 'cannon'], ['D_JET', 'jet']]) sprite(l, f, [GREEN, GREEN]);
for (const [l, f] of [['E_DINO', 'dino'], ['E_MOUSE', 'mouse'], ['E_CROUCH', 'crawler'], ['E_KNIGHT', 'knight'], ['E_HELI', 'heli'], ['E_BALLOON', 'balloon'], ['E_POGO', 'pogo']]) sprite(l, f, [RED_DK, RED]);
sprite('E_TREX', 'trex', [ORANGE_DK, ORANGE]);

// a busy moment of wave 7, every overlapping monster's turn merged
const m = new Machine(rom);
const set = (n, v, i = 0) => m.poke(SYM[`W_${n}`] + i, v);
const fr = (fire) => { m.bus.inpt4 = fire ? 0 : 0x80; set('spawnTimer', 200); m.runFrame(); };
for (let i = 0; i < 3; i++) fr();
fr(true); fr(); fr();
set('wave', 7); set('unlock', 5); set('batt', 42); set('score', 0x00); set('score', 0x04, 1); set('score', 0x35, 2); set('dirty', 7);
const toys = [[0, 1], [3, 1], [6, 1], [1, 2], [4, 4], [7, 3], [5, 5]];
const foes = [[0, 128, 1], [0, 100, 4], [1, 138, 2], [2, 110, 5], [2, 140, 3]];
const hold = () => {
  toys.forEach(([s, t]) => { set('slotType', t, s); set('slotHP', 20, s); });
  foes.forEach(([l, x, t], i) => { set('eLane', l, i); set('eX', x, i); set('eType', t, i); set('eHP', 30, i); set('eState', 0, i); });
};
for (let i = 0; i < 12; i++) { hold(); fr(); }
const acc = Array.from({ length: 192 }, () => new Uint8Array(160));
for (let k = 0; k < 6; k++) { hold(); fr(); const f = m.bus.tia.lastFrame; for (let y = 0; y < 192; y++) for (let x = 0; x < 160; x++) { const c = f[40 + y][x]; if (c && (!acc[y][x] || y < 29)) acc[y][x] = c; } }
writeFramePng('img/screen.png', acc, 4, 2);
console.log('site assets ok');
