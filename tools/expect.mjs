// Reference picture of the play screen, drawn straight from the design
// (gen/layout.json and the sprite art in gen.mjs), independent of the 6502
// code: what every visible pixel of a frame should be. Used by tools/test.mjs.
import { readFileSync } from 'node:fs';
import { DEFENDERS, ENEMIES, enemyFrame, KIND_COLOR, DARK_ROWS, COLUMN_X, EH, ROWS, feetRow, shotRow, VARIANT_W } from './gen.mjs';

export const COL = { gold: 0xf8, red: 0x46, green: 0xc8, orange: 0x38, redDark: 0x42, orangeDark: 0x34, header: 0xa0 };
// enemy colors per kind: [bottom rows, the rest]
const TONES = { red: [COL.redDark, COL.red], orange: [COL.orangeDark, COL.orange], green: [COL.green, COL.green] };
const layout = JSON.parse(readFileSync(new URL('../gen/layout.json', import.meta.url)));
const PLAY = 32; // first visible line of row 0

// the enemies the kernel should draw on a frame (mirror of Schedule in bank 0)
export function scheduled(enemies, frame) {
  // E: the event row, the first row at or above top-1 the kernel allows
  const info = enemies.map(([lane, x, type, state = 0], i) => {
    const f = feetRow(lane, x + 4);
    let E = f - 11;
    while (E > 0 && layout.rowBad[E]) E -= 1;
    return { i, lane, x, type, state, f, E };
  });
  const order = [...info].sort((a, b) => a.E - b.E || a.i - b.i);
  // walk the sorted list from position (frame & 7) mod n (frame: the displayed
  // frame's counter), take each enemy that misses the ones already taken
  const chosen = new Set(), taken = [];
  const n = order.length;
  for (let k = 0; k < n; k += 1) {
    const e = order[((frame & 7) % n + k) % n];
    if (e.E < 1) continue;
    if (taken.every((t) => t.f < e.E - 1 || e.f < t.E - 1)) { taken.push(e); chosen.add(e.i); }
  }
  // Schedule: an event row at most 41 rows after the previous drawn enemy's
  // feet and at most 41 above this one's top, on a row the kernel allows;
  // without one the enemy waits a frame
  const drawn = [];
  let prevF = 0;
  for (const e of order) {
    if (!chosen.has(e.i)) continue;
    let E = e.E;
    if (drawn.length && E > prevF + 41) {
      E = prevF + 42;
      do { E -= 1; if (e.f >= 51 && E < e.f - 51) { E = -1; break; } } while (layout.rowBad[E]);
    }
    if (E <= prevF + 1) continue;
    drawn.push(e); prevF = e.f;
  }
  return drawn;
}

// frame: 192 rows x 160 color bytes (visible lines only)
export function expectedFrame(scene, frame) {
  const px = Array.from({ length: 192 }, () => new Uint8Array(160));
  const put = (line, x, c) => { if (line >= 0 && line < 192 && x >= 0 && x < 160) px[line][x] = c; };
  for (let l = 0; l < 29; l += 1) px[l].fill(COL.header); // the header panel
  const row2 = (r, x, c) => { put(PLAY + 2 * r, x, c); put(PLAY + 2 * r + 1, x, c); };
  // header text: title (s1-14, red) at x 54-101; status (s16-25) from x 54, gold text
  // and the green batteries ('g')
  const text = (lines, s0, rowsPer, c) => lines.forEach((line, r) => [...line].forEach((p, x) => { if (p === '#' || p === 'g') for (let k = 0; k < rowsPer; k += 1) put(s0 + rowsPer * r + k, 54 + x, p === 'g' ? COL.green : c); }));
  text(scene.titleLines, 1, 2, COL.red);
  if (scene.statusLines) text(scene.statusLines, 16, 2, COL.gold);
  const pf = scene.pfColor ?? COL.gold; // shelves, box and rule (white while flashing)
  for (let x = 0; x < 160; x += 1) put(30, x, pf); // the rule, edge to edge
  // box: PF1 bits for x 16-47
  layout.boxTab.forEach((v, y) => { const r = 79 - y; for (let b = 0; b < 8; b += 1) if (v & (0x80 >> b)) for (let d = 0; d < 4; d += 1) row2(r, 16 + 4 * b + d, pf); });
  // shelves: row 20k+j at x 149-6j, 4 wide, both lines
  for (let k = 0; k < 4; k += 1) for (let j = 0; j <= 18; j += 1) for (let d = 0; d < 4; d += 1) row2(20 * k + j, 149 - 6 * j + d, pf);
  // enemies: player 1 graphics change on line B, so a row shows on line B and the next line A
  const drawn = scheduled(scene.enemies, frame);
  const enemyLines = new Map(); // line -> player 1's color there
  for (const e of drawn) {
    const g = ENEMIES[enemyFrame(e.type, e.x, e.state)];
    // hurt (state bit 5): the other color, red <-> orange; a quarter or less (bit 4): that 4 frames of every 8
    const base = KIND_COLOR[e.type] ?? 'red', other = base === 'orange' ? 'red' : base === 'red' ? 'orange' : base;
    const swapped = (e.state & 0x20) && (!(e.state & 0x10) || (frame & 4));
    const tones = TONES[swapped ? other : base];
    const tone = (k) => tones[k < DARK_ROWS ? 0 : 1]; // k: rows up from the feet
    for (let k = 0; k < EH; k += 1) { const r = e.f - k; enemyLines.set(PLAY + 2 * r + 1, tone(k)); enemyLines.set(PLAY + 2 * r + 2, tone(k)); }
    g.forEach((bits, i) => { const k = g.length - 1 - i, r = e.f - k; for (let b = 0; b < 8; b += 1) if (bits & (0x80 >> b)) { put(PLAY + 2 * r + 1, e.x + b, tone(k)); put(PLAY + 2 * r + 2, e.x + b, tone(k)); } });
  }
  // shots: missile 1, 4 wide, both lines of its row; color of player 1 on that line
  scene.shots.forEach((x, L) => {
    if (!x) return;
    const r = shotRow(L, x);
    for (const line of [PLAY + 2 * r, PLAY + 2 * r + 1]) for (let d = 0; d < 4; d += 1) put(line, x + d, enemyLines.get(line) ?? COL.gold);
  });
  // defenders last: player 0 has priority over player 1 and missile 1
  // defenders: player 0 copies, both lines of each row
  scene.slots.forEach((name, s) => {
    if (!name) return;
    const L = Math.floor(s / 3), x = COLUMN_X[s % 3], f = feetRow(L, x + 4), g = DEFENDERS[name];
    g.forEach((bits, i) => { const r = f - (g.length - 1 - i); for (let b = 0; b < 8; b += 1) if (bits & (0x80 >> b)) row2(r, x + b, COL.green); });
  });
  return { px, drawn };
}
void ROWS; void VARIANT_W;
