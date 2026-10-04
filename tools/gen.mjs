// Generates the data and timed code that toywars.asm includes:
//   gen/bank1.inc  play-kernel tables (box, shelves, shots, enemy colors),
//                  defender and enemy graphics, event-row variants
//   gen/bank0.inc  header fonts and the scene layout constants
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
export const DEFENDERS = {
  soldier: bits([
    '...###..', '...##...', '...##...', '.#######', '.#####..', '.####...',
    '..###...', '..#.##..', '.##.##..', '.##..##.', '########']),
  tank: bits([
    '..###...', '.#######', '.####...', '........', '#######.', '#######.']),
  teddy: bits([
    '.##..##.', '.######.', '.#.##.#.', '.######.', '..####..', '########',
    '.######.', '.######.', '###..###']),
  empty: [],
};
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
};
export const enemyFrame = (type, x) => ((x >> 2) & 1 ? `${type}2` : type);
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
// status: "dddddd" score at x 0-23, "WAVE" at 26-42, wave digit at 45-47
export function statusLines(score, wave) {
  return statusStatic().map((line, r) => {
    const row = [...line];
    [...score].forEach((d, i) => [...NARROW[d][r]].forEach((p, k) => { row[4 * i + k] = p; }));
    [...NARROW[wave][r]].forEach((p, k) => { row[45 + k] = p; });
    return row.join('');
  });
}
function statusStatic() {
  return Array.from({ length: 5 }, (_, r) => {
    const row = Array(48).fill('.');
    const put = (x, s) => [...s].forEach((p, i) => { row[x + i] = p; });
    put(26, NARROW.W[r]); put(32, NARROW.A[r]); put(36, NARROW.V[r]); put(40, NARROW.E[r]);
    return row.join('');
  });
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
  const colArr = Array.from({ length: 160 }, (_, k) => (k >= 79 && k < 79 + EH ? 'COL_RED' : 'COL_GOLD'));
  const ballTab = Array.from({ length: ROWS }, (_, y) => { const r = 79 - y; return [0, 1, 2, 3].some((k) => r >= 20 * k && r <= 20 * k + 18) ? 2 : 0; });
  out1.push('ColArr:');
  for (let i = 0; i < 160; i += 16) out1.push(`    .byte ${colArr.slice(i, i + 16).join(',')}`);
  out1.push('BallTab:', bytes(ballTab), '    ALIGN 256');

  // page C: defenders, bottom row first: 18 zeros, then each sprite padded to DH rows + 18 zeros
  const defPage = Array(256).fill(0);
  let at = 58;
  const defOrder = ['soldier', 'tank', 'teddy', 'empty'];
  for (const name of defOrder) {
    const g = [...DEFENDERS[name]].reverse();
    g.forEach((v, i) => { defPage[at + i] = v; });
    layout.defenders[name] = at;
    at += DH + 18;
  }
  if (at - 18 + DH + 6 > 256) throw new Error('defender page overflow');
  out1.push('DefPage:', bytes(defPage));
  for (const name of defOrder) out1.push(`D_${name.toUpperCase()} = DefPage + ${layout.defenders[name]}`);
  if (layout.defenders.empty < 79) throw new Error('empty defender must sit at page offset >= 79');

  // enemies: 80 zeros, then each sprite (bottom-aligned in EH rows) followed by 79 zeros
  const enemy = Array(80).fill(0);
  const enemyOrder = ['dino', 'dino2', 'heli', 'heli2', 'crouch', 'crouch2'];
  for (const name of enemyOrder) {
    layout.enemies[name] = enemy.length;
    const g = [...ENEMIES[name]].reverse();
    for (let i = 0; i < EH; i += 1) enemy.push(g[i] ?? 0);
    for (let i = 0; i < 79; i += 1) enemy.push(0);
  }
  out1.push('EnemyGfx:', bytes(enemy));
  for (const name of enemyOrder) out1.push(`E_${name.toUpperCase()} = EnemyGfx + ${layout.enemies[name]}`);
  out1.push('Zeros = EnemyGfx');

  // ---------------------------------------------------------------- bank 0
  const out0 = [];
  out0.push('    ALIGN 256');
  const title = cells48(titleLines());
  title.forEach((c, i) => out0.push(`Title${i}:`, bytes(c)));
  const st = cells48(statusStatic());
  out0.push('Status3:', bytes(st[3]), 'Status4:', bytes(st[4]), 'Status5E:', bytes(st[5]));
  // narrow digits, bottom row first: Hi = glyph in bits 7-5, Lo = bits 3-1, R = bits 2-0
  const nd = (d) => [...NARROW[d]].reverse().map((s) => parseInt(s.replace(/\./g, '0').replace(/#/g, '1'), 2));
  out0.push('DigitHi:', bytes([...Array(10).keys()].flatMap((d) => nd(d).map((v) => v << 5))));
  out0.push('DigitLo:', bytes([...Array(10).keys()].flatMap((d) => nd(d).map((v) => v << 1))));
  out0.push('DigitR:', bytes([...Array(10).keys()].flatMap((d) => nd(d))));

  // scheduler tables (bank 0)
  const staticRows = new Set([...STATIC.swaps.map((x) => x[0]), ...STATIC.ball, ...STATIC.shot.map((x) => x[0]), STATIC.end]);
  const rowBad = Array.from({ length: ROWS }, (_, r) => (r === 0 || staticRows.has(r) || staticRows.has(r + 1) || STATIC.shot.some(([sr]) => sr + 1 === r) ? 1 : 0));
  const feetX = Array.from({ length: 160 }, (_, x) => (feetRow(0, x + 4) - 20) & 0xff);
  const xVar = Array.from({ length: 160 }, (_, x) => Math.max(0, Math.min(7, Math.floor((x - 35) / 15))));
  const xHm = xVar.map((v, x) => (Math.max(-8, Math.min(7, variantX(v) - x)) & 15) << 4);
  out0.push('FeetX:', bytes(feetX), 'XVar:', bytes(xVar), 'XHm:', bytes(xHm), 'RowBad:', bytes(rowBad));
  out0.push('LaneBase:', '    .byte 20,40,60');
  // indexed by type * 2 + walking frame (types 1-3)
  const eb = ['0', '0', ...enemyOrder.map((n) => `E_${n.toUpperCase()}-79`)];
  out0.push('EBaseLo:', `    .byte ${eb.map((e) => (e === '0' ? 0 : `<(${e})`)).join(',')}`);
  out0.push('EBaseHi:', `    .byte ${eb.map((e) => (e === '0' ? 0 : `>(${e})`)).join(',')}`);
  out0.push('VarLo:', `    .byte ${VARIANT_W.map((_, v) => `<(EvA${v}-1)`).join(',')}`);
  out0.push('VarHi:', `    .byte ${VARIANT_W.map((_, v) => `>(EvA${v}-1)`).join(',')}`);
  // defender slot k of lane L: pointer low byte = sprite + feet row - 79
  const slotF = [0, 1, 2].flatMap((L) => COLUMN_X.map((x) => feetRow(L, x + 4)));
  out0.push('SlotOfs:', bytes(slotF.map((f) => f - 79)));
  // the still scene (from the mockup)
  const scene = {
    defenders: { 0: 'soldier', 3: 'tank', 6: 'teddy' },
    enemies: [[0, 119, 'dino'], [1, 128, 'heli'], [1, 105, 'dino'], [2, 135, 'crouch'], [2, 107, 'dino']],
    shots: [83, 77, 0],
  };
  const etype = { dino: 1, heli: 2, crouch: 3 };
  out0.push('SceneSlot:', `    .byte ${[...Array(9).keys()].map((i) => `<D_${(scene.defenders[i] ?? 'empty').toUpperCase()}`).join(',')}`);
  out0.push('SceneEX:', bytes(scene.enemies.map((e) => e[1])), 'SceneELane:', bytes(scene.enemies.map((e) => e[0])), 'SceneEType:', bytes(scene.enemies.map((e) => etype[e[2]])));
  out0.push('SceneShot:', bytes(scene.shots.map((x, L) => (x ? shotRow(L, x) : 80))));
  layout.scene = scene; layout.slotF = slotF; layout.rowBad = rowBad;
  for (const [L, x] of scene.shots.entries()) if (x && (149 - x) % 6) throw new Error(`shot x ${x} is off the diagonal`);

  return { out1, out0, layout, boxTab, ballTab };
}

// ---------------------------------------------------------------- event-row variants
// Line B of an event row (player 1 moves to the next enemy): it keeps the
// shelf/box/defender work of a normal line B and adds three pulls from the
// event queue (enemy color pointer, HMP1, next event row) and RESP1 at a
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
    if (!(pos.A < pos.B && pos.B < pos.C)) return false;
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
  let orders = interleave(['A', 'B', 'C'], ['L1', 'S1', 'L2', 'S2']);
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

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('gen.mjs')) {
  const { out1, out0, layout, boxTab, ballTab } = build();
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
  writeFileSync('gen/layout.json', JSON.stringify({ ...layout, boxTab, ballTab, VARIANT_W, STATIC, COLUMN_X, EH, DH }, null, 1));
  console.log('gen ok');
}
