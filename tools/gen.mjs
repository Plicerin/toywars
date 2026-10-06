// Generates the data and timed code that toywars.asm includes:
//   gen/bank1.inc  play-kernel tables (box, shelves, shots, enemy colors),
//                  defender and enemy graphics, event-row variants
//   gen/bank0.inc  header fonts, status glyphs, scheduler tables
//   gen/bank2.inc  game logic tables
//   gen/layout.json geometry for the tests
// usage: node tools/gen.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- geometry
// The play area is 80 rows of two scanlines (rows 0-79 top to bottom); the
// kernel counts y = 79 - row. Shelf line k runs from x 149 (row 20k) to x 41
// (row 20k+18), 6 pixels left per row: the ball, moved by HMOVE every row.
export const ROWS = 80;
export const shelfRow = (k, x) => 20 * k + (149 - x) / 6;
// an object of lane L whose centre is at x stands with its feet on row f
export const feetRow = (L, c) => Math.round(20 * (L + 1) + (149 - c) / 6) - 3;
export const COLUMN_X = [48, 80, 112];                 // player 0, three copies 32 apart
export const EH = 11;                                  // enemy rows (sprites bottom-aligned)
export const DH = 11;                                  // defender rows
export const DARK_ROWS = 3;                            // an enemy's bottom rows in the darker shade
// static kernel rows (special code at fixed rows)
export const STATIC = {
  swaps: [ // [row, column, lane]: point column k at lane L's defender
    [7, 2, 0], [12, 1, 0], [17, 0, 0], [28, 2, 1], [33, 1, 1], [37, 0, 1], [48, 2, 2], [53, 1, 2], [57, 0, 2]],
  ball: [19, 39, 59],                                  // RESBL: next shelf line starts at x 149
  shot: [[30, 1], [50, 2]],                            // RESM1 + shot pointer of the next lane
  end: 79,
};
// row of the shot diagonal: a shot of lane L at x sits on row 20L + 11 + (149 - x) / 6
export const shotRow = (L, x) => 20 * L + 11 + (149 - x) / 6;

// ---------------------------------------------------------------- art
const bits = (rows) => rows.map((r) => parseInt(r.replace(/[.]/g, '0').replace(/#/g, '1'), 2));
// the toys (all green: player 0's three copies share one color), bottom-aligned
export const DEFENDERS = {
  army: bits([
    '...###..', '...##...', '...##...', '.#######', '.#####..', '.####...',
    '..###...', '..#.##..', '.##.##..', '.##..##.', '########']),
  tank: bits([
    '..###...', '.#######', '.####...', '........', '#######.', '#######.']),
  teddy: bits([
    '.##..##.', '.######.', '.#.##.#.', '.######.', '..####..', '########',
    '.######.', '.######.', '###..###']),
  jack: bits([ // jack-in-the-box: the clown's head on its spring, over the box with its crank
    '..###...', '.#.#.#..', '..###...', '...#....', '..#.....', '...#....',
    '######..', '##..####', '##..##.#', '######..']),
  cannon: bits([ // barrel aimed up and right, over a spoked wheel
    '.......#', '......##', '.....##.', '....##..', '..###...', '.#####..',
    '#.#.#...', '#####...', '#.#.#...', '.###....']),
  jet: bits([ // seen from above, nose to the right: swept wings, tail fins
    '...#....', '#..##...', '##.###..', '.#######', '.#######', '##.###..', '#..##...', '...#....']),
};
export const TOYS = ['army', 'teddy', 'tank', 'jack', 'cannon', 'jet']; // toy type 1-6
// two walking frames each; the kernel shows frame 2 while (x >> 2) is odd
export const ENEMIES = {
  dino: bits([
    '.####...', '#####...', '.###..##', '..#####.', '#####.#.', '...####.',
    '..####..', '..#..##.', '.##...##']),
  dino2: bits([
    '.####...', '#####...', '.###..##', '..#####.', '#####.#.', '...####.',
    '..####..', '...###..', '..##.##.']),
  heli: bits([
    '########', '...##...', '..####..', '.######.', '########', '########',
    '#.#..#.#', '.##..##.']),
  heli2: bits([
    '..####..', '...##...', '..####..', '.######.', '########', '########',
    '#.#..#.#', '.##..##.']),
  crouch: bits([
    '......##', '...####.', '.#####..', '######..', '##...#..', '..#..###', '.......#']),
  crouch2: bits([
    '......##', '...####.', '.#####..', '######..', '##..#...', '.#...##.', '......#.']),
  mouse: bits([ // nose at the left, ear, wind-up key behind it, tail
    '..##.#.#', '..##..#.', '.######.', '#.######', '.######.', '..#..#..']),
  mouse2: bits([
    '..##.#.#', '..##..#.', '.######.', '#.######', '.######.', '.#....#.']),
  knight: bits([
    '...###..', '..####..', '..#.##..', '..####..', '##.###..', '##.####.',
    '##.###..', '##.###..', '...##...', '..#..#..', '.##..##.']),
  knight2: bits([
    '...###..', '..####..', '..#.##..', '..####..', '##.###..', '##.####.',
    '##.###..', '##.###..', '...##...', '..#.#...', '.##.##..']),
  knightx: bits([ // shield gone: charging
    '...###..', '..####..', '..#.##..', '..####..', '.#####..', '#.####..',
    '..###...', '..###...', '..#.#...', '.#...#..', '#.....#.']),
  balloon: bits([
    '..###...', '.#####..', '.#####..', '..###...', '...#....', '...#....',
    '..###...', '.#####..', '..#.#...']),
  pogo: bits([ // bulging eyes, wide head, legs on the pedals; spring squeezed ...
    '##....##', '########', '#.####.#', '.######.', '#..##..#', '...##...', '..####..', '...##...', '..####..', '...##...']),
  pogo2: bits([ // ... and stretched
    '##....##', '########', '#.####.#', '.######.', '#..##..#', '...##...', '...##...', '..####..', '...##...', '...##...', '..####..']),
  trex: bits([
    '.#####..', '##.####.', '#######.', '###.....', '#######.', '..######',
    '..#####.', '.######.', '..#####.', '..##.##.', '.##..##.']),
  trex2: bits([
    '.#####..', '##.####.', '#######.', '###.....', '#######.', '..######',
    '..#####.', '.######.', '..#####.', '..###.#.', '.##...##']),
};
// enemy kinds 1-8 and their frames: [walk 1, walk 2] (the knight's third is
// its charge without the shield)
export const KINDS = ['', 'dino', 'heli', 'crouch', 'mouse', 'knight', 'balloon', 'pogo', 'trex', 'jetf'];
ENEMIES.jetf = DEFENDERS.jet; // kind 9: a launched jet, flying its strike
const TWO_FRAMES = new Set(['dino', 'heli', 'crouch', 'mouse', 'knight', 'pogo', 'trex']);
export const enemyFrame = (type, x, state = 0) => {
  if (type === 'knight' && state & 0x40) return 'knightx';
  return (x >> 2) & 1 && TWO_FRAMES.has(type) ? `${type}2` : type;
};
export const KIND_COLOR = { trex: 'orange', jetf: 'green' };
// build the box procedurally so the label and edges line up with the shelves
function boxRows() {
  const g = Array.from({ length: ROWS }, () => Array(8).fill(0));
  const set = (r, c) => { if (r >= 0 && r < ROWS && c >= 0 && c < 8) g[r][c] = 1; };
  // columns: 0 = x 16-19 ... 7 = x 44-47. Front panel: left edge column 0,
  // right edge column 6, where the shelves end (x 41).
  for (let r = 6; r <= 60; r += 1) set(r, 0);                                   // left edge
  for (let r = 6; r <= 17; r += 1) { const c = Math.floor((r - 6) / 2); set(r, c); set(r, c + 1); } // lid
  for (let r = 17; r <= 79; r += 1) set(r, 6);                                  // right edge
  for (let r = 60; r <= 79; r += 1) { const c = Math.min(6, Math.floor((r - 60) / 3)); set(r, c); set(r, c + 1); } // bottom
  for (const L of [0, 1, 2]) for (const dr of [3, 6]) set(20 * L + 19 + dr, 7); // lane mouths
  const glyphs = { T: ['###', '.#.', '.#.', '.#.', '.#.'], O: ['###', '#.#', '#.#', '#.#', '###'], Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], S: ['###', '#..', '###', '..#', '###'] };
  ['T', 'O', 'Y', 'S'].forEach((ch, i) => glyphs[ch].forEach((line, dr) => [...line].forEach((p, dc) => { if (p === '#') set(25 + 7 * i + dr, 2 + dc); })));
  return g.map((row) => row.reduce((v, b) => (v << 1) | b, 0));
}

// ---------------------------------------------------------------- fonts
const TITLE_GLYPHS = {
  T: ['#####', '#####', '..#..', '..#..', '..#..', '..#..', '..#..'],
  O: ['.###.', '##.##', '#...#', '#...#', '#...#', '##.##', '.###.'],
  Y: ['#...#', '##.##', '.###.', '..#..', '..#..', '..#..', '..#..'],
  ' ': Array(7).fill('.....'),
  W: ['#...#', '#...#', '#.#.#', '#.#.#', '#####', '##.##', '#...#'],
  A: ['.###.', '##.##', '#...#', '#####', '#...#', '#...#', '#...#'],
  R: ['####.', '#..##', '#...#', '####.', '#.##.', '#..##', '#...#'],
  S: ['.####', '##...', '##...', '.###.', '...##', '...##', '####.'],
};
const NARROW = {
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '..#', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
  W: ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'], A: ['.#.', '#.#', '###', '#.#', '#.#'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  E: ['###', '#..', '##.', '#..', '###'],
  w: ['#.#', '#.#', '###', '###', '#.#'],
  G: ['###', '#..', '#.#', '#.#', '###'], M: ['#.#', '###', '###', '#.#', '#.#'],
};
// 48-pixel text: an array of rows (top first) of 48-char strings -> six cell tables, bottom row first
function cells48(lines) {
  const cells = Array.from({ length: 6 }, () => []);
  for (const line of [...lines].reverse()) for (let c = 0; c < 6; c += 1) cells[c].push(parseInt(line.slice(8 * c, 8 * c + 8).replace(/[^#]/g, '0').replace(/#/g, '1'), 2));
  return cells;
}
export function titleLines() {
  return Array.from({ length: 7 }, (_, r) => [...'TOY WARS'].map((ch) => `${TITLE_GLYPHS[ch][r]}.`).join(''));
}
// status line (48 px, narrow 3x5 font): score at x 0-23, battery icon 25-27,
// batteries 29-31 and 33-35, "W" 37-39, wave 41-43 and 45-47
// the status line from x 54 to the right edge: '#' gold text (players, x 54-93),
// 'g' the green batteries (PF1, 4-pixel blocks, x 96-123)
export function statusLines(score, batteries, wave) {
  return Array.from({ length: 5 }, (_, r) => {
    const row = Array(106).fill('.');
    const put = (x, g) => [...NARROW[g][r]].forEach((p, i) => { row[x + i] = p; });
    const block = (pfx, g) => [...NARROW[g][r]].forEach((p, i) => { if (p === '#') for (let d = 0; d < 4; d += 1) row[42 + 4 * (pfx + i) + d] = 'g'; });
    // the score's last five digits, a gap, W and the wave
    [...score.slice(-5)].forEach((d, i) => put(4 * i, d));
    put(24, 'w'); put(28, wave[0]); put(32, wave[1]);
    // PF1 blocks from x 96: tens, a gap, ones
    block(0, batteries[0]); block(4, batteries[1]);
    return row.join('');
  });
}
// game selection: GAME n centered in the status line
export function gameLines(n) {
  return Array.from({ length: 5 }, (_, r) => {
    const row = Array(48).fill('.');
    [...`GAME ${n}`].forEach((ch, i) => { if (ch !== ' ') [...NARROW[ch][r]].forEach((p, k) => { row[8 + 4 * i + k] = p; }); }); // (in the 40-pixel text)
    return row.join('');
  });
}
const GAMEOVER_GLYPHS = {
  G: ['.###', '#...', '#...', '#.##', '#..#', '#..#', '.###'], A: ['.##.', '#..#', '#..#', '####', '#..#', '#..#', '#..#'],
  M: ['#..#', '####', '####', '#..#', '#..#', '#..#', '#..#'], E: ['####', '#...', '#...', '###.', '#...', '#...', '####'],
  ' ': Array(7).fill('....'), O: ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
  V: ['#..#', '#..#', '#..#', '#..#', '#..#', '.##.', '.##.'], R: ['###.', '#..#', '#..#', '###.', '#.#.', '#..#', '#..#'],
};
export function gameOverLines() {
  return Array.from({ length: 7 }, (_, r) => `.${[...'GAME OVER'].map((ch) => `${GAMEOVER_GLYPHS[ch][r]}.`).join('').slice(0, 46)}.`.padEnd(48, '.'));
}

// ---------------------------------------------------------------- emit helpers
const hex = (v) => `$${(v & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
const bytes = (arr) => {
  const out = [];
  for (let i = 0; i < arr.length; i += 16) out.push(`    .byte ${arr.slice(i, i + 16).map(hex).join(',')}`);
  return out.join('\n');
};

// ---------------------------------------------------------------- bank 1
export function build() {
  const out1 = [];
  const layout = { defenders: {}, enemies: {} };

  // page A: ShotArr (ENAM1 2 at index 79) + BoxTab (indexed by y)
  const shotArr = Array(160).fill(0); shotArr[79] = 2;
  const box = boxRows();
  const boxTab = Array.from({ length: ROWS }, (_, y) => box[79 - y]);
  out1.push('    ALIGN 256', 'ShotArr:', bytes(shotArr), 'BoxTab:', bytes(boxTab), '    ALIGN 256');
  // page B: ColArr (COLUP1 per y+f: red on an enemy's rows) + BallTab
  // player 1's color per row: gold away from an enemy (for the shots), on an
  // enemy's 11 rows its color, the bottom three (legs, skids, spring) darker
  const colArr = Array.from({ length: 160 }, (_, k) => (k >= 79 && k < 79 + EH ? (k < 79 + DARK_ROWS ? 'COL_RED_DK' : 'COL_RED') : 'COL_GOLD'));
  const ballTab = Array.from({ length: ROWS }, (_, y) => { const r = 79 - y; return [0, 1, 2, 3].some((k) => r >= 20 * k && r <= 20 * k + 18) ? 2 : 0; });
  out1.push('ColArr:');
  for (let i = 0; i < 160; i += 16) out1.push(`    .byte ${colArr.slice(i, i + 16).join(',')}`);
  out1.push('BallTab:', bytes(ballTab), '    ALIGN 256');
  // page B2: the same for green objects (the jet)
  out1.push('ColGreen:');
  for (let i = 0; i < 160; i += 1) if (i % 16 === 0) out1.push(`    .byte ${colArr.slice(i, i + 16).map((c) => (c.startsWith('COL_RED') ? 'COL_GREEN' : c)).join(',')}`); // the jet: one green, like the toys
  out1.push('    ALIGN 256');
  out1.push('ColOrange:');
  for (let i = 0; i < 160; i += 1) if (i % 16 === 0) out1.push(`    .byte ${colArr.slice(i, i + 16).map((c) => c.replace('COL_RED', 'COL_ORANGE')).join(',')}`);
  out1.push('    ALIGN 256');

  // page C: toys, bottom row first, 29 apart from offset 58 (each needs 18
  // zeros below it and 6 above within its band); offsets 224-255 stay zero
  // for empty slots, whose pointer is chosen per slot so its band reads them
  const defPage = Array(256).fill(0);
  TOYS.forEach((name, k) => {
    const at = 58 + 29 * k;
    [...DEFENDERS[name]].reverse().forEach((v, i) => { defPage[at + i] = v; });
    layout.defenders[name] = at;
  });
  if (58 + 29 * 5 + DH + 6 > 224) throw new Error('defender page overflow');
  out1.push('DefPage:', bytes(defPage));
  for (const name of TOYS) out1.push(`D_${name.toUpperCase()} = DefPage + ${layout.defenders[name]}`);

  // enemies: 80 zeros (the pointer before the first enemy and after the park
  // event reads them), then each frame (bottom-aligned in EH rows) followed by
  // 40 zeros. The scheduler keeps every enemy's pointer within 40 rows of it.
  const enemy = Array(80).fill(0);
  const enemyOrder = ['dino', 'dino2', 'heli', 'heli2', 'crouch', 'crouch2', 'mouse', 'mouse2', 'knight', 'knight2', 'knightx', 'balloon', 'pogo', 'pogo2', 'trex', 'trex2', 'jetf'];
  for (const name of enemyOrder) {
    layout.enemies[name] = enemy.length;
    const g = [...ENEMIES[name]].reverse();
    for (let i = 0; i < EH; i += 1) enemy.push(g[i] ?? 0);
    for (let i = 0; i < 40; i += 1) enemy.push(0);
  }
  out1.push('EnemyGfx:', bytes(enemy));
  for (const name of enemyOrder) out1.push(`E_${name.toUpperCase()} = EnemyGfx + ${layout.enemies[name]}`);
  out1.push('Zeros = EnemyGfx');

  // ---------------------------------------------------------------- bank 0
  const out0 = [];
  out0.push('    ALIGN 256');
  const title = cells48(titleLines());
  title.forEach((c, i) => out0.push(`Title${i}:`, bytes(c)));
  const go = cells48(gameOverLines());
  go.forEach((c, i) => out0.push(`Over${i}:`, bytes(c)));
  // narrow digits, bottom row first: Hi = glyph in bits 7-5, Lo = bits 3-1, R = bits 2-0
  const nd = (d) => [...NARROW[d]].reverse().map((s) => parseInt(s.replace(/\./g, '0').replace(/#/g, '1'), 2));
  out0.push('DigitHi:', bytes([...Array(10).keys()].flatMap((d) => nd(d).map((v) => v << 5))));
  out0.push('DigitLo:', bytes([...[...Array(10).keys()].flatMap((d) => nd(d).map((v) => v << 1)), 0, 0, 0, 0, 0])); // + a blank (index 50)
  out0.push('WHi:', bytes(nd('w').map((v) => v << 5)));
  // GAME 1-3 for the status line, laid out like W_cells (cell by cell, bottom row first)
  out0.push('GameText:', bytes([1, 2, 3].flatMap((n) => cells48(gameLines(n)).flat())));
  out0.push('GameTextAt:', '    .byte 0, 0, 30, 60');
  out0.push('Bin2BCD:', bytes([...Array(100).keys()].map((n) => ((n / 10) | 0) * 16 + (n % 10))));

  // scheduler tables (bank 0)
  const staticRows = new Set([...STATIC.swaps.map((x) => x[0]), ...STATIC.ball, ...STATIC.shot.map((x) => x[0]), STATIC.end]);
  const rowBad = Array.from({ length: ROWS }, (_, r) => (r === 0 || staticRows.has(r) || staticRows.has(r + 1) || STATIC.shot.some(([sr]) => sr + 1 === r) ? 1 : 0));
  const feetX = Array.from({ length: 160 }, (_, x) => (feetRow(0, x + 4) - 20) & 0xff);
  const xVar = Array.from({ length: 160 }, (_, x) => Math.max(0, Math.min(7, Math.floor((x - 35) / 15))));
  const xHm = xVar.map((v, x) => (Math.max(-8, Math.min(7, variantX(v) - x)) & 15) << 4);
  out0.push('FeetX:', bytes(feetX), 'XVar:', bytes(xVar), 'XHm:', bytes(xHm), 'RowBad:', bytes(rowBad));
  out0.push('LaneBase:', '    .byte 20,40,60');
  // indexed by type * 2 + walking frame (kinds 1-9); index 20 = the knight's charge
  const eb = ['0', '0', ...KINDS.slice(1).flatMap((k) => [k, TWO_FRAMES.has(k) ? `${k}2` : k]), 'knightx'].map((n) => (n === '0' ? '0' : `E_${n.toUpperCase()}-79`));
  out0.push('EBaseLo:', `    .byte ${eb.map((e) => (e === '0' ? 0 : `<(${e})`)).join(',')}`);
  out0.push('EBaseHi:', `    .byte ${eb.map((e) => (e === '0' ? 0 : `>(${e})`)).join(',')}`);
  out0.push('VarLo:', `    .byte ${VARIANT_W.map((_, v) => `<(EvA${v}-1)`).join(',')}`);
  out0.push('VarHi:', `    .byte ${VARIANT_W.map((_, v) => `>(EvA${v}-1)`).join(',')}`);
  const page = { orange: '>ColOrange', green: '>ColGreen' };
  out0.push('EnColHi:', `    .byte 0,${KINDS.slice(1).map((k) => page[KIND_COLOR[k]] ?? '>ColArr').join(',')}`); // color page per enemy kind
  // the scheduler's row tables again for bank 2 (EnemyRows)
  layout.feetX = feetX;

  // ---------------------------------------------------------------- bank 2: game logic tables
  const out2 = [];
  const slotF = [0, 1, 2].flatMap((L) => COLUMN_X.map((x) => feetRow(L, x + 4)));
  // empty slot k of lane L: point so the slot's band (swap row .. next swap - 1) reads offsets 224-255
  const swaps = [[17, 37, 57], [12, 33, 53], [7, 28, 48]];
  const emptyLo = [0, 1, 2].flatMap((L) => [0, 1, 2].map((k) => { const last = L < 2 ? swaps[k][L + 1] - 1 : 79; return 224 - (79 - last); }));
  const shotStart = [0, 1, 2].flatMap((L) => COLUMN_X.map((x) => 20 * L + 11 + Math.floor((149 - (x + 8)) / 6)));
  out2.push('ToyLo:', `    .byte 0,${TOYS.map((n) => `<D_${n.toUpperCase()}`).join(',')}`);
  out2.push('SlotOfs:', bytes(slotF.map((f) => f - 79)), 'EmptyLo:', bytes(emptyLo));
  out2.push('SlotLane:', '    .byte 0,0,0,1,1,1,2,2,2', 'SlotCol:', '    .byte 0,1,2,0,1,2,0,1,2', 'ColX:', `    .byte ${COLUMN_X.join(',')}`);
  out2.push('ShotStart:', bytes(shotStart), 'LaneR0:', '    .byte 11,31,51');
  out2.push('ShotX:', bytes(Array.from({ length: 18 }, (_, j) => 149 - 6 * j))); // x of shot step j
  out2.push('FeetX2:', bytes(feetX), 'RowBad2:', bytes(rowBad), 'LaneBase2:', '    .byte 20,40,60,0,20,40,60'); // 4-6: a flying jet's shelf
  layout.slotF = slotF; layout.rowBad = rowBad; layout.emptyLo = emptyLo; layout.shotStart = shotStart;

  return { out1, out0, out2, layout, boxTab, ballTab };
}

// ---------------------------------------------------------------- event-row variants
// Line B of an event row (player 1 moves to the next enemy): it keeps the
// shelf/box/defender work of a normal line B and adds four pulls from the
// event queue (color pointer low and high, HMP1, next event row) and RESP1 at a
// fixed cycle. Eight variants put RESP1 at w = 34, 39, ... 69 (x 42 ... 147);
// HMP1 (-7..+7) covers the 15 pixels in between.
// Cycle model: an instruction's write lands on its last cycle w; it affects
// pixels from 3(w+1) - 68 on. Line B starts at cycle 0 after WSYNC.
export const VARIANT_W = [34, 39, 44, 49, 54, 59, 64, 69];
export const variantX = (v) => 3 * VARIANT_W[v] - 60;

function scheduleVariant(wR) {
  // items in program order; windows are on the landing cycle w of the store
  const items = [
    { asm: ['lda BoxTab,y', 'sta PF1'], cyc: [4, 3], win: [0, 26] },
    { asm: ['lda (pc0),y', 'sta GRP0'], cyc: [5, 3], win: [0, 37] },
  ];
  const rest = [
    { id: 'A', asm: ['pla', 'sta p1col'], cyc: [4, 3] },
    { id: 'K', asm: ['pla', 'sta p1col+1'], cyc: [4, 3] },
    { id: 'B', asm: ['pla', 'sta HMP1'], cyc: [4, 3] },
    { id: 'C', asm: ['pla', 'sta nextEv'], cyc: [4, 3] },
    { id: 'R', asm: ['sta RESP1'], cyc: [3], win: [wR, wR] },
    { id: 'L1', asm: ['lda (pc1),y'], cyc: [5] },
    { id: 'P', asm: ['stx PF1'], cyc: [3], win: [38, 59] },
    { id: 'S1', asm: ['sta GRP0'], cyc: [3], win: [41, 48] },
    { id: 'L2', asm: ['lda (pc2),y'], cyc: [5] },
    { id: 'S2', asm: ['sta GRP0'], cyc: [3], win: [51, 59] },
    { id: 'D', asm: ['dey'], cyc: [2] },
  ];
  // try insertion orders: keep A<B<C, L1<S1<L2<S2, P anywhere after 38; R anywhere
  // eslint-disable-next-line no-unused-vars
  const perms = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));
  const okOrder = (seq) => {
    const pos = Object.fromEntries(seq.map((s, i) => [s.id, i]));
    if (!(pos.A < pos.K && pos.K < pos.B && pos.B < pos.C)) return false;
    if (!(pos.L1 < pos.S1 && pos.S1 < pos.L2 && pos.L2 < pos.S2 && pos.L2 < pos.D)) return false;
    // A must stay intact between Lx and Sx: only stores without A use in between
    const between = (a, b) => seq.slice(pos[a] + 1, pos[b]).map((s) => s.id);
    if (between('L1', 'S1').some((id) => !['P', 'R'].includes(id))) return false;
    if (between('L2', 'S2').some((id) => !['P', 'R', 'D'].includes(id))) return false;
    return true;
  };
  let best = null;
  const ids = rest;
  // orders: interleave A,B,C with L1,S1,L2,S2, then insert P, R and D anywhere
  const byId = Object.fromEntries(ids.map((it) => [it.id, it]));
  const interleave = (x, y) => (!x.length ? [y] : !y.length ? [x] : [
    ...interleave(x.slice(1), y).map((r) => [x[0], ...r]), ...interleave(x, y.slice(1)).map((r) => [y[0], ...r])]);
  const insertAll = (seqs, id) => seqs.flatMap((q) => q.map((_, i) => [...q.slice(0, i), id, ...q.slice(i)]).concat([[...q, id]]));
  let orders = interleave(['A', 'K', 'B', 'C'], ['L1', 'S1', 'L2', 'S2']);
  for (const id of ['P', 'R', 'D']) orders = insertAll(orders, id);
  for (const ord of orders) {
    const order = ord.map((id) => byId[id]);
    if (!okOrder(order)) continue;
    // simulate with minimal padding (nop = 2, bit $80 = 3)
    let t = 0;
    const lines = [];
    let ok = true;
    for (const it of [...items, ...order]) {
      for (let i = 0; i < it.asm.length; i += 1) {
        const last = i === it.asm.length - 1;
        if (last && it.win) {
          let land = t + it.cyc[i] - 1;
          let pad = Math.max(0, it.win[0] - land);
          if (pad === 1) pad = 3; // can't pad one cycle: use 3 (bit) only if it still fits
          if (pad > 0) { lines.push(...padCycles(pad)); t += pad; land += pad; }
          if (land < it.win[0] || land > it.win[1]) { ok = false; break; }
        }
        lines.push(it.asm[i]);
        t += it.cyc[i];
      }
      if (!ok) break;
    }
    if (!ok) continue;
    // tail: dey + jmp RowAH (the sta HMOVE after RowA's WSYNC), ending exactly
    // on cycle 76 so the next line starts with HMOVE on cycle 0
    const fill = 76 - (t + 3);
    if (fill < 0 || fill === 1) continue;
    if (!best || t < best.t) best = { t, lines: [...lines, ...padCycles(fill)] };
  }
  if (!best) throw new Error(`no schedule for RESP1 at ${wR}`);
  return best;
}
function padCycles(n) {
  const out = [];
  while (n > 0) {
    if (n === 3 || n === 5 || n === 7) { out.push('bit $80'); n -= 3; } else { out.push('nop'); n -= 2; }
  }
  return out;
}

if (process.argv[1]?.endsWith('gen.mjs')) {
  const { out1, out0, out2, layout, boxTab, ballTab } = build();
  const variants = [];
  VARIANT_W.forEach((w, v) => {
    const { t, lines } = scheduleVariant(w);
    variants.push(`EvA${v}:                     ; line A tail after the rts (cycle 58): enemy graphics pointer`);
    variants.push('    pla', '    sta p1ptr', '    pla', '    sta p1ptr+1', '    sta WSYNC');
    variants.push(`EvB${v}:                     ; RESP1 lands on cycle ${w} (x ${variantX(v)}), line B work ends at ${t}`);
    for (const l of lines) variants.push(`    ${l}`);
    variants.push('    jmp RowAH                ; ends on cycle 76');
  });
  mkdirSync('gen', { recursive: true });
  writeFileSync('gen/bank1.inc', `; generated by tools/gen.mjs -- do not edit\n${out1.join('\n')}\n`);
  writeFileSync('gen/variants.inc', `; generated by tools/gen.mjs -- do not edit\n${variants.join('\n')}\n`);
  writeFileSync('gen/bank0.inc', `; generated by tools/gen.mjs -- do not edit\n${out0.join('\n')}\n`);
  writeFileSync('gen/bank2.inc', `; generated by tools/gen.mjs -- do not edit\n${out2.join('\n')}\n`);
  writeFileSync('gen/layout.json', JSON.stringify({ ...layout, boxTab, ballTab, VARIANT_W, STATIC, COLUMN_X, EH, DH }, null, 1));
  console.log('gen ok');
}
