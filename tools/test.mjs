// Checks toywars.bin on the 6502 core and TIA model against the reference
// picture (tools/expect.mjs): frame timing, then every visible pixel.
// usage: node tools/test.mjs
import { readFileSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';
import { expectedFrame, COL } from './expect.mjs';
import { titleLines, statusLines } from './gen.mjs';

const layout = JSON.parse(readFileSync('gen/layout.json'));
const SYM = Object.fromEntries(readFileSync('tools/build/toywars.sym', 'latin1').split(/\r?\n/)
  .map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const m = new Machine(readFileSync('toywars.bin'));
m.bus.swchb = 0x03;  // TV type on B/W: the demo motion holds still
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures += 1; };

// 0. the cartridge: 16K F6, and it starts from whichever bank it powers up in
{
  const rom = readFileSync('toywars.bin');
  check('toywars.bin is 16K', rom.length === 16384, `${rom.length} bytes`);
  const ok = [0, 1, 2, 3].filter((bank) => {
    const mb = new Machine(rom, { bank });
    for (let f = 0; f < 10; f += 1) mb.runFrame();
    const { vb, total } = mb.layout();
    return total === 262 && vb[0][0] === 40;
  });
  check('it boots into the game from each of the four banks', ok.length === 4, `banks ${ok.join(', ')}`);
}

// 1. timing
const bad = new Map();
for (let f = 0; f < 600; f += 1) {
  m.runFrame();
  if (f < 2) continue;
  const { vb, total } = m.layout();
  const key = `${total} lines, visible ${vb.find((v) => !v[1])?.[0]}-${vb.find((v) => v[1])?.[0]}`;
  if (key !== '262 lines, visible 40-232') bad.set(key, (bad.get(key) ?? 0) + 1);
}
check('600 frames are all 262 lines, picture on lines 40-231', bad.size === 0, JSON.stringify([...bad]));

// 2. pixels: five consecutive frames (overlapping enemies take turns)
const s = layout.scene;
const scene = {
  titleLines: titleLines(),
  statusLines: statusLines('000120', '1'),
  slots: [...Array(9).keys()].map((i) => s.defenders[i] ?? null),
  enemies: s.enemies,
  shots: s.shots,
};
const name = { [COL.gold]: 'gold', [COL.red]: 'red', [COL.green]: 'green', 0: 'black' };
const seen = new Set();
for (let k = 0; k < 5; k += 1) {
  m.runFrame();
  const frameNo = m.ram(SYM.frame);
  const { px, drawn } = expectedFrame(scene, frameNo);
  drawn.forEach((e) => seen.add(e.i));
  const got = m.bus.tia.lastFrame.slice(40, 232);
  const diffs = [];
  for (let l = 0; l < 192; l += 1) for (let x = 0; x < 160; x += 1) if (got[l][x] !== px[l][x]) diffs.push(`line ${l} x ${x}: ${name[got[l][x]] ?? got[l][x].toString(16)} not ${name[px[l][x]] ?? px[l][x]}`);
  check(`frame ${frameNo} matches the reference pixel for pixel, enemies ${drawn.map((e) => e.type).join(', ')}`, diffs.length === 0, diffs.length ? `${diffs.length} pixels differ; first: ${diffs.slice(0, 6).join('; ')}` : '');
}
check('every enemy is drawn within five frames', seen.size === s.enemies.length, `${seen.size} of ${s.enemies.length}`);

// 3. random scenes: enemies anywhere in their lanes, any defenders, any shots
{
  const types = ['dino', 'heli', 'crouch'];
  const defNames = ['soldier', 'tank', 'teddy'];
  const defLo = { soldier: layout.defenders.soldier, tank: layout.defenders.tank, teddy: layout.defenders.teddy, empty: layout.defenders.empty };
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
  let scenes = 0, badScenes = 0, firstBad = '';
  for (let t = 0; t < 300; t += 1) {
    const enemies = Array.from({ length: 5 }, () => [rnd(3), 35 + rnd(117), types[rnd(3)]]).slice(0, 1 + rnd(5));
    const slots = Array.from({ length: 9 }, () => (rnd(3) ? defNames[rnd(3)] : null));
    const shots = [0, 1, 2].map(() => (rnd(2) ? 149 - 6 * (2 + rnd(15)) : 0));
    for (let i = 0; i < 5; i += 1) {
      const e = enemies[i];
      m.poke(SYM.W_eType + i, e ? types.indexOf(e[2]) + 1 : 0);
      if (e) { m.poke(SYM.W_eLane + i, e[0]); m.poke(SYM.W_eX + i, e[1]); }
    }
    slots.forEach((n, i) => m.poke(SYM.slotPtr + i, (defLo[n ?? 'empty'] + layout.slotF[i] - 79) & 0xff));
    shots.forEach((x, L) => m.poke(SYM.shotPtr + L, x ? 20 * L + 11 + (149 - x) / 6 : 80));
    const sc = { ...scene, slots, enemies, shots };
    m.runFrame(); // the enemy choice for a frame is made in the overscan before it
    for (let k = 0; k < 2; k += 1) {
      m.runFrame();
      const { px } = expectedFrame(sc, m.ram(SYM.frame));
      const got = m.bus.tia.lastFrame.slice(40, 232);
      let d = 0, first = '';
      for (let l = 0; l < 192; l += 1) for (let x = 0; x < 160; x += 1) if (got[l][x] !== px[l][x]) { if (!d) first = `line ${l} x ${x} ${got[l][x].toString(16)} vs ${px[l][x].toString(16)}`; d += 1; }
      scenes += 1;
      if (d) { badScenes += 1; if (!firstBad) firstBad = `scene ${t} frame ${k}: ${d} pixels, ${first}; enemies ${JSON.stringify(enemies)}`; }
    }
  }
  check('300 random scenes (600 frames) match the reference pixel for pixel', badScenes === 0, badScenes ? `${badScenes}/${scenes} frames differ; ${firstBad}` : `${scenes} frames`);
  const { vb, total } = m.layout();
  check('and the last one still has 262 lines', total === 262 && vb[0][0] === 40, JSON.stringify({ vb, total }));
}

// 4. demo motion (TV type on color): 1200 moving frames, each against the
// reference drawn from the positions in RAM when the frame began
{
  m.bus.swchb = 0x0b;
  const readScene = () => ({
    ...scene,
    slots: scene.slots,
    enemies: [...Array(5).keys()].filter((i) => m.ram(SYM.W_eType + i)).map((i) => [m.ram(SYM.W_eLane + i), m.ram(SYM.W_eX + i), ['', 'dino', 'heli', 'crouch'][m.ram(SYM.W_eType + i)]]),
    shots: [0, 1, 2].map((L) => { const r = m.ram(SYM.shotPtr + L); return r === 80 ? 0 : 149 - 6 * (r - 20 * L - 11); }),
  });
  // restore the mockup scene's defenders (test 3 changed them)
  scene.slots.forEach((n, i) => m.poke(SYM.slotPtr + i, (layout.defenders[n ?? 'empty'] + layout.slotF[i] - 79) & 0xff));
  let bad = 0, timing = 0, first = '';
  const startX = m.ram(SYM.W_eX);
  for (let f = 0; f < 1200; f += 1) {
    const sc = readScene();
    m.runFrame();
    const { total, vb } = m.layout();
    if (total !== 262 || vb[0][0] !== 40) timing += 1;
    const { px } = expectedFrame(sc, m.ram(SYM.frame));
    const got = m.bus.tia.lastFrame.slice(40, 232);
    let d = 0;
    for (let l = 0; l < 192; l += 1) for (let x = 0; x < 160; x += 1) if (got[l][x] !== px[l][x]) d += 1;
    if (d) { bad += 1; if (!first) first = `frame ${f}: ${d} pixels`; }
  }
  check('1200 frames of demo motion: every frame matches the reference, 262 lines', bad === 0 && timing === 0, `${bad} frames differ, ${timing} mistimed${first ? `; ${first}` : ''}; enemy 0 moved ${startX} -> ${m.ram(SYM.W_eX)}`);
}

check('the Super Chip is detected and never read through its write port (or written through its read port)', m.bus.superchip && m.bus.scViolations === 0, `superchip ${m.bus.superchip}, violations ${m.bus.scViolations}`);

console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
