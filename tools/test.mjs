// Checks toywars.bin on the 6502 core and TIA model.
//  - the cartridge: 16K F6 + Super Chip, boots from any bank
//  - frame timing (262 lines) through long random play
//  - every visible pixel against the reference picture (tools/expect.mjs),
//    drawn from the game state in RAM at the start of each frame
//  - the rules, scenario by scenario, through RAM
// usage: node tools/test.mjs
import { readFileSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';
import { expectedFrame } from './expect.mjs';
import { titleLines, gameOverLines, statusLines, gameLines, TOYS, COLUMN_X, KINDS } from './gen.mjs';

const layout = JSON.parse(readFileSync('gen/layout.json'));
const SYM = Object.fromEntries(readFileSync('tools/build/toywars.sym', 'latin1').split(/\r?\n/)
  .map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const ROM = readFileSync('toywars.bin');
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures += 1; };

// a machine with helpers; Super Chip variables are poked/read through their W_ address
function boot() {
  const m = new Machine(ROM);
  const r = (n, i = 0) => m.ram(SYM[n] + i);
  const sc = (n, i = 0) => m.ram(SYM[`W_${n}`] + i);
  const set = (n, v, i = 0) => m.poke(SYM[`W_${n}`] + i, v);
  const frames = (n, input = {}, each) => {
    for (let k = 0; k < n; k += 1) {
      m.bus.swcha = input.stick ?? 0xff; m.bus.inpt4 = input.fire ? 0 : 0x80; m.bus.swchb = (input.reset ? 0x0a : 0x0b) & (input.select ? 0xfd : 0xff) | (input.diffA ? 0x40 : 0);
      if (each) each();
      m.runFrame();
    }
  };
  const press = (input = {}) => { frames(1, { ...input, fire: true }); frames(1, input); };
  frames(3);
  return { m, r, sc, set, frames, press };
}
const RIGHT = 0x7f, LEFT = 0xbf, DOWN = 0xdf, UP = 0xef;

// the scene the kernel will draw next, read from RAM before the frame runs
const toyAt = Object.fromEntries(TOYS.map((n) => [layout.defenders[n], n]));
function sceneFromRam(g) {
  const { r, sc } = g;
  const slots = [...Array(9).keys()].map((s) => {
    const lo = r('slotPtr', s);
    if (lo === layout.emptyLo[s]) return null;
    const off = (lo - layout.slotF[s] + 79 + 256) % 256;
    if (!(off in toyAt)) throw new Error(`slot ${s}: pointer ${lo} is no toy and not empty`);
    return toyAt[off];
  });
  const enemies = [...Array(5).keys()].filter((i) => sc('eType', i)).map((i) => [sc('eLane', i) & 3, sc('eX', i), KINDS[sc('eType', i)], sc('eState', i)]); // (a flying jet's shelf is 4-6)
  const shots = [0, 1, 2].map((L) => { const row = r('shotPtr', L); return row === 80 ? 0 : 149 - 6 * (row - 20 * L - 11); });
  const two = (v) => `${(v / 10) | 0}${v % 10}`;
  const score = [0, 1, 2].map((i) => sc('score', i).toString(16).padStart(2, '0')).join('');
  return {
    titleLines: sc('state') === 2 ? gameOverLines() : titleLines(),
    statusLines: sc('dirty') ? null : sc('state') === 0 ? gameLines(sc('game')) : statusLines(score, two(sc('batt')), two(Math.min(99, sc('wave')))),
    pfColor: r('pfColor'),
    slots, enemies, shots,
  };
}
// run one frame and compare it with the reference; returns the differing pixels
function frameDiffs(g, input) {
  const scene = sceneFromRam(g);
  const next = (g.r('frame') + 1) & 255;
  g.frames(1, input);
  const { px } = expectedFrame(scene, next);
  const got = g.m.bus.tia.lastFrame.slice(40, 232);
  const diffs = [];
  for (let l = 0; l < 192; l += 1) {
    if (!scene.statusLines && l >= 16 && l < 26) continue; // status line still being rebuilt
    for (let x = 0; x < 160; x += 1) if (got[l][x] !== px[l][x]) diffs.push(`line ${l} x ${x}: ${got[l][x].toString(16)} not ${px[l][x].toString(16)}`);
  }
  return diffs;
}

// ---------------------------------------------------------------- cartridge
check('toywars.bin is 16K', ROM.length === 16384, `${ROM.length} bytes`);
{
  const ok = [0, 1, 2, 3].filter((bank) => {
    const mb = new Machine(ROM, { bank });
    for (let f = 0; f < 10; f += 1) mb.runFrame();
    const { vb, total } = mb.layout();
    return total === 262 && vb[0][0] === 40 && mb.bus.superchip;
  });
  check('it boots from each of the four banks, Super Chip detected', ok.length === 4, `banks ${ok.join(', ')}`);
}

// ---------------------------------------------------------------- random play: timing and pixels
{
  const g = boot();
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
  const bad = new Map();
  let input = {}, pixelFrames = 0, pixelBad = 0, firstBad = '', games = 0, maxWave = 0, kills = 0, lastScore = 0;
  for (let f = 0; f < 20000; f += 1) {
    if (f % 12 === 0) input = { stick: [0xff, 0xff, RIGHT, LEFT, UP, DOWN][rnd(6)], fire: rnd(3) === 0, reset: f % 5000 < 3, select: rnd(40) === 0, diffA: f % 8000 > 4000 };
    if (g.sc('state') !== 1 && rnd(30) === 0) { input = { fire: true }; games += 1; }
    if (f < 4000) {
      const d = frameDiffs(g, input);
      pixelFrames += 1;
      if (d.length) { pixelBad += 1; if (!firstBad) firstBad = `frame ${f}: ${d.length} pixels, ${d.slice(0, 3).join('; ')}`; }
    } else g.frames(1, input);
    const { vb, total } = g.m.layout();
    const key = `${total}/${vb[0]?.[0]}`;
    if (key !== '262/40') bad.set(key, (bad.get(key) ?? 0) + 1);
    maxWave = Math.max(maxWave, g.sc('wave'));
    const s = parseInt([0, 1, 2].map((i) => g.sc('score', i).toString(16).padStart(2, '0')).join(''), 10);
    if (s > lastScore) kills += 1;
    lastScore = s;
  }
  check('20,000 frames of random play are all 262 lines, picture on lines 40-231', bad.size === 0, bad.size ? JSON.stringify([...bad]) : `${games} games, ${kills} kills, wave ${maxWave} reached`);
  check(`the first ${pixelFrames} frames match the reference picture pixel for pixel`, pixelBad === 0, pixelBad ? `${pixelBad} differ; ${firstBad}` : '');
  check('the Super Chip is never read through its write port or written through its read port', g.m.bus.scViolations === 0, `violations ${g.m.bus.scViolations}`);
}

// ---------------------------------------------------------------- late game: the heaviest frames
// (the mixed layout, and nine army men: the most shots and sound)
for (const [name, toys] of [['nine toys acting', [1, 3, 5, 1, 2, 3, 1, 4, 5]], ['nine army men', [1, 1, 1, 1, 1, 1, 1, 1, 1]]]) {
  const g = boot();
  g.press();
  g.frames(2);
  g.set('wave', 14); g.set('unlock', 6); g.set('batt', 99); g.set('dirty', 7);
  toys.forEach((t, s) => { g.set('slotType', t, s); g.set('slotHP', 40, s); g.set('slotCool', 0, s); });
  let bad = 0, mistimed = 0, first = '', most = 0;
  for (let f = 0; f < 1500; f += 1) {
    if (f % 300 === 0) toys.forEach((t, s) => { g.set('slotType', t, s); g.set('slotHP', 40, s); });
    g.set('spawnLeft', 20);
    let added = false;
    for (let i = 0; i < 5; i += 1) if (!g.sc('eType', i)) { added = true; const k = (f + i) % 9; g.set('eType', 1 + k, i); g.set('eLane', ((f + i) % 3) | (k === 8 ? 4 : 0), i); g.set('eX', 151 - ((f * 7 + i * 23) % 60), i); g.set('eHP', 9, i); g.set('eState', 0, i); }
    if (added) { g.frames(2); continue; } // the game updates each enemy's rows every other frame: let it see them
    const d = frameDiffs(g, {});
    if (d.length) { bad += 1; if (!first) first = `frame ${f}: ${d.slice(0, 2).join('; ')}`; }
    const { vb, total } = g.m.layout();
    if (total !== 262 || vb[0][0] !== 40) mistimed += 1;
    most = Math.max(most, [0, 1, 2, 3, 4].filter((i) => g.sc('eType', i)).length);
  }
  check(`late game (second lap, ${name}, fast enemies and flying jets): 1,500 frames at 262 lines, every pixel as the reference`, bad === 0 && mistimed === 0, `${bad} frames differ, ${mistimed} mistimed, up to ${most} enemies${first ? `; ${first}` : ''}`);
}

// ---------------------------------------------------------------- rules
// a game with no spawning (the spawn timer is held) and the board cleared
function quietGame() {
  const g = boot();
  g.press();
  g.frames(2);
  const hush = () => g.set('spawnTimer', 200);
  const run = (n, input = {}) => g.frames(n, input, hush);
  for (let i = 0; i < 5; i += 1) { g.set('eType', 0, i); g.set('eLane', 0xff, i); } // (an empty slot's shelf is $FF)
  return { ...g, run };
}
const enemy = (g, i, lane, x, type, hp) => { g.set('eLane', lane, i); g.set('eX', x, i); g.set('eType', type, i); g.set('eHP', hp, i); g.set('eState', 0, i); };
const slot = (g, s, type, hp) => { g.set('slotType', type, s); g.set('slotHP', hp, s); g.set('slotCool', 0, s); };
const score = (g) => parseInt([0, 1, 2].map((i) => g.sc('score', i).toString(16).padStart(2, '0')).join(''), 10);

{
  const g = boot();
  check('power-on is attract mode', g.sc('state') === 0);
  g.press();
  check('fire starts a game: 30 batteries, wave 1, army man chosen, cursor on slot 3', g.sc('state') === 1 && g.sc('batt') === 30 && g.sc('wave') === 1 && g.sc('toy') === 1 && g.sc('cursor') === 3);
  g.frames(2);
  g.press();
  check('fire on an empty slot places the toy and costs its batteries', g.sc('slotType', 3) === 1 && g.sc('batt') === 20, `slot ${g.sc('slotType', 3)}, batteries ${g.sc('batt')}`);
  g.press();
  check('fire on a toy picks it up for half its cost', g.sc('slotType', 3) === 0 && g.sc('batt') === 25, `batteries ${g.sc('batt')}`);
  g.set('batt', 5);
  g.press();
  check('without enough batteries nothing is placed', g.sc('slotType', 3) === 0 && g.sc('batt') === 5);
}
{
  const g = boot();
  g.press();
  g.frames(2);
  g.frames(1, { stick: UP }); g.frames(2);
  check('up moves the cursor a shelf up', g.sc('cursor') === 0);
  g.frames(1, { stick: UP }); g.frames(2);
  check('and stops at the top shelf', g.sc('cursor') === 0);
  g.frames(1, { stick: RIGHT }); g.frames(2); g.frames(1, { stick: RIGHT }); g.frames(2); g.frames(1, { stick: RIGHT }); g.frames(2);
  check('right moves along the shelf and stops at the last slot', g.sc('cursor') === 2);
  g.frames(40, { stick: DOWN });
  check('holding a direction repeats', g.sc('cursor') === 8, `cursor ${g.sc('cursor')}`);
  g.set('unlock', 3);
  g.frames(1, { fire: true }); g.frames(1, { fire: true, stick: RIGHT }); g.frames(1, { fire: true }); g.frames(1, { fire: true, stick: RIGHT }); g.frames(1, { fire: true }); g.frames(2);
  check('fire + right cycles through the unlocked toys, and releasing places nothing', g.sc('toy') === 3 && g.sc('slotType', 8) === 0, `toy ${g.sc('toy')}`);
  g.frames(1, { fire: true }); g.frames(1, { fire: true, stick: RIGHT }); g.frames(1, { fire: true }); g.frames(2);
  check('past the last unlocked toy it wraps to the first', g.sc('toy') === 1);
}
{
  const g = quietGame();
  slot(g, 3, 1, 8); // army man, middle shelf, first column
  enemy(g, 0, 1, 140, 1, 6);
  const s0 = score(g), b0 = g.sc('batt');
  let f = 0;
  while (g.sc('eType', 0) && f < 1200) { g.run(1); f += 1; }
  check('an army man shoots down a dino walking at it', g.sc('eType', 0) === 0 && g.sc('slotType', 3) === 1, `after ${f} frames`);
  check('the kill scores 10 and pays 3 batteries', score(g) === s0 + 10 && g.sc('batt') >= b0 + 3, `score ${score(g)}, batteries ${g.sc('batt')}`);
}
{
  const g = quietGame();
  slot(g, 0, 2, 40); // teddy, top shelf
  enemy(g, 0, 0, 70, 1, 6);
  g.run(200);
  check('a dino stops at a teddy and chews it', g.sc('eX', 0) === COLUMN_X[0] + 8 && g.sc('slotHP', 0) < 40, `x ${g.sc('eX', 0)}, teddy health ${g.sc('slotHP', 0)}`);
  g.run(800);
  check('a chewed-up toy is gone and the dino walks on', g.sc('slotType', 0) === 0 && g.sc('eX', 0) < COLUMN_X[0] + 8);
}
{
  const g = quietGame();
  enemy(g, 0, 2, 45, 1, 6);
  enemy(g, 1, 2, 120, 3, 3);
  enemy(g, 2, 0, 120, 1, 6);
  g.run(30);
  check('an enemy reaching the toy box slams that shelf\'s lid: the shelf is cleared', g.sc('lids') === 4 && g.sc('eType', 0) === 0 && g.sc('eType', 1) === 0 && g.sc('eType', 2) === 1 && g.sc('state') === 1);
  enemy(g, 0, 2, 45, 1, 6);
  g.run(30);
  check('a second breach on the same shelf ends the game', g.sc('state') === 2);
  g.run(10, { fire: true });
  check('fire does nothing for the first two seconds of GAME OVER', g.sc('state') === 2);
  g.run(130); g.press();
  check('then it starts a new game', g.sc('state') === 1 && g.sc('lids') === 0 && score(g) === 0);
}
{
  const g = quietGame();
  enemy(g, 0, 1, 100, 1, 6); enemy(g, 1, 1, 130, 1, 12); enemy(g, 2, 0, 100, 1, 6);
  g.set('toy', 6); g.set('unlock', 6); g.set('batt', 40); // cursor is on slot 3 (middle shelf)
  g.press();
  const jet = () => [0, 1, 2, 3, 4].find((i) => g.sc('eType', i) === 9);
  const j = jet(), x0 = j === undefined ? -1 : g.sc('eX', j);
  check('placing a jet launches it from the toy box end of its shelf (30 batteries; the slot stays empty)', j !== undefined && x0 >= 40 && x0 < 48 && g.sc('slotType', 3) === 0 && g.sc('batt') === 10, `x ${x0}`);
  let diffs = 0, frames = 0, path = [];
  while (jet() !== undefined && frames < 120) { const dd = frameDiffs(g, {}); if (dd.length && process.env.WHY) console.log('jet frame', frames, dd.length, dd.slice(0, 4).join('; '), JSON.stringify([0,1,2,3,4].map((i) => [g.sc('eType', i), g.sc('eX', i), g.sc('eLane', i)]))); diffs += dd.length ? 1 : 0; frames += 1; if (jet() !== undefined) path.push(g.sc('eX', jet())); g.set('spawnTimer', 200); }
  check('it flies right along its shelf, drawn in green, and is gone past the right edge', jet() === undefined && path.every((x, i) => i === 0 || x >= path[i - 1]) && frames > 40 && diffs === 0, `${frames} frames, ${diffs} frames off the reference`);
  check('every enemy it passes on that shelf takes 10 damage, once; other shelves are untouched', g.sc('eType', 0) === 0 && g.sc('eHP', 1) === 2 && g.sc('eType', 2) === 1 && g.sc('eHP', 2) === 6, `hp ${g.sc('eHP', 1)}`);
}
{
  const g = quietGame();
  enemy(g, 0, 1, 44, 1, 20); enemy(g, 1, 1, 70, 1, 20); enemy(g, 2, 1, 140, 1, 20); // by the box, mid-shelf, far right
  g.set('toy', 6); g.set('unlock', 6); g.set('batt', 40);
  g.frames(1, { stick: RIGHT }); g.run(2); g.frames(1, { stick: RIGHT }); g.run(2); // cursor to slot 5 (middle shelf, column 2)
  const cur = g.sc('cursor');
  g.press();
  g.run(4);
  const first = g.sc('eHP', 0); // (hit at take-off, before it reaches the box and slams the lid)
  g.set('eType', 0, 0); g.set('eLane', 0xff, 0);
  g.run(120);
  const hp = [first, g.sc('eHP', 1), g.sc('eHP', 2)];
  check('a jet placed in the last column still flies the whole shelf: monsters left of its slot are hit too', cur === 5 && hp.join() === '10,10,10', `cursor ${cur}, health ${hp.join(', ')}`);
}
{
  const g = quietGame();
  enemy(g, 0, 1, 51, 1, 20); // a dino standing on slot 3 (middle shelf, column 0, x 48)
  g.set('toy', 2); g.set('batt', 40); // teddy; the cursor is on slot 3
  g.press();
  check('a toy cannot be put down on a monster (the buzz; no batteries spent)', g.sc('slotType', 3) === 0 && g.sc('batt') === 40, `slot ${g.sc('slotType', 3)}, batteries ${g.sc('batt')}`);
  g.set('toy', 6); g.set('unlock', 6);
  g.press();
  check('a jet still takes off from there', g.sc('batt') === 10 && [0, 1, 2, 3, 4].some((i) => g.sc('eType', i) === 9));
  g.run(90); // (the jet's gone)
  g.set('eType', 0, 0); g.set('eLane', 0xff, 0);
  g.set('toy', 2); g.set('batt', 40);
  g.press();
  check('once the slot is clear, the toy goes down', g.sc('slotType', 3) === 2);
}
{
  const g = quietGame();
  slot(g, 4, 4, 8); // cowboy, middle shelf, column 1 (x 80)
  enemy(g, 0, 1, 110, 1, 6);
  g.run(4);
  const x0 = g.sc('eX', 0);
  g.run(40);
  check('a cowboy lassoes an enemy within 40 pixels and holds it', (g.sc('eState', 0) & 0x3f) > 0 && g.sc('eX', 0) === x0, `x ${x0} -> ${g.sc('eX', 0)}`);
}
{
  const g = quietGame();
  slot(g, 1, 2, 40); // teddy, top shelf, column 1 (x 80)
  enemy(g, 0, 0, 92, 2, 5); // helicopter
  g.run(30);
  check('a helicopter hops over the first toy in its way', g.sc('eX', 0) < COLUMN_X[1] && (g.sc('eState', 0) & 0x40) !== 0 && g.sc('slotHP', 1) === 40, `x ${g.sc('eX', 0)}`);
}
{
  const g = quietGame();
  slot(g, 6, 1, 8); slot(g, 7, 2, 40); // army man (x 48) and teddy (x 80), bottom shelf
  enemy(g, 0, 2, 88, 3, 3); // crawler reaches the teddy at once
  g.run(300);
  check('army bullets pass over a crawler that is chewing', g.sc('eType', 0) === 3 && g.sc('eHP', 0) === 3 && g.sc('slotHP', 7) < 40, `crawler hp ${g.sc('eHP', 0)}`);
}
{
  const g = boot();
  g.press();
  g.frames(2);
  g.set('spawnLeft', 0);
  for (let i = 0; i < 5; i += 1) { g.set('eType', 0, i); g.set('eLane', 0xff, i); } // (an empty slot's shelf is $FF)
  g.frames(4);
  check('when a wave is done the next starts and unlocks the teddy', g.sc('wave') === 2 && g.sc('unlock') === 2 && g.sc('spawnLeft') === 7);
  let spawned = 0;
  for (let f = 0; f < 600 && !spawned; f += 1) { g.frames(1); spawned = [0, 1, 2, 3, 4].filter((i) => g.sc('eType', i)).length; }
  const i = [0, 1, 2, 3, 4].find((k) => g.sc('eType', k));
  check('after a breather enemies arrive at the right edge', spawned > 0 && g.sc('eX', i) >= 149 && g.sc('spawnLeft') === 6, `x ${i === undefined ? '-' : g.sc('eX', i)}`);
}

// ---------------------------------------------------------------- the other monsters
{
  const g = quietGame();
  slot(g, 4, 2, 40); // teddy, middle shelf, column 1 (x 80)
  enemy(g, 0, 1, 100, 6, 2); // balloon clown
  g.run(200);
  check('the balloon clown floats over toys', g.sc('eX', 0) < COLUMN_X[1] && g.sc('slotHP', 4) === 40, `x ${g.sc('eX', 0)}`);
}
{
  const g = quietGame();
  slot(g, 5, 3, 40); // tank, middle shelf, column 2 (x 112)
  enemy(g, 0, 1, 150, 6, 2);
  g.run(300);
  check('tank shells cannot hit it', g.sc('eType', 0) === 6 && g.sc('eHP', 0) === 2);
  slot(g, 3, 1, 8); // an army man can
  enemy(g, 0, 1, 150, 6, 2);
  let f = 0;
  while (g.sc('eType', 0) && f < 600) { g.run(1); f += 1; }
  check('army men shoot it down', g.sc('eType', 0) === 0, `after ${f} frames`);
}
{
  const g = quietGame();
  enemy(g, 0, 0, 120, 5, 6); // knight
  g.run(2);
  const slow = g.sc('eX', 0); g.run(40); const slowStep = slow - g.sc('eX', 0);
  g.set('eHP', 3, 0);
  slot(g, 0, 1, 8); // army man at x 48, top shelf, to land the hit
  let f = 0;
  while (!(g.sc('eState', 0) & 0x40) && f < 600) { g.run(1); f += 1; }
  slot(g, 0, 0, 0);
  g.set('shotDmg', 0, 0); g.m.poke(SYM.shotPtr, 80); g.set('eHP', 2, 0); // no more hits
  const fast = g.sc('eX', 0); g.run(40); const fastStep = fast - g.sc('eX', 0);
  check('a knight walks slowly until its shield breaks, then charges', (g.sc('eState', 0) & 0x40) !== 0 && fastStep >= 3 * slowStep && slowStep > 0, `${slowStep} then ${fastStep} pixels in 40 frames, kind ${g.sc('eType', 0)}`);
}
{
  const g = quietGame();
  slot(g, 1, 2, 40); // teddy, top shelf, x 80
  enemy(g, 0, 0, 92, 7, 3); // pogo frog
  g.run(20);
  check('a pogo frog that meets a toy jumps to the next shelf', g.sc('eLane', 0) === 1 && (g.sc('eState', 0) & 0x40) !== 0 && g.sc('slotHP', 1) === 40);
  slot(g, 4, 2, 40); // teddy on the middle shelf too
  g.run(120);
  check('only once: then it chews', g.sc('eLane', 0) === 1 && g.sc('slotHP', 4) < 40);
}
{
  const g = quietGame();
  slot(g, 0, 2, 40); // teddy, top shelf
  enemy(g, 0, 0, 58, 8, 20); // T-Rex at the teddy
  g.run(40);
  check('a T-Rex crushes a toy in one bite', g.sc('slotType', 0) === 0);
}
{
  const g = quietGame();
  slot(g, 3, 5, 40); // cannon, middle shelf, x 48
  enemy(g, 0, 1, 120, 1, 20); // the one it hits
  enemy(g, 1, 1, 131, 1, 20); // 11 pixels behind: splashed
  enemy(g, 2, 1, 146, 1, 20); // 26 pixels behind: out of reach
  enemy(g, 3, 0, 125, 1, 20); // another shelf
  let f = 0;
  while (g.sc('eHP', 0) === 20 && f < 600) { g.run(1); f += 1; }
  g.run(12); // the burst checks one monster every other frame
  const hp = [0, 1, 2, 3].map((i) => g.sc('eHP', i));
  check('a cannonball splashes: 3 damage to the monster it hits and any other on its shelf within 12 pixels', hp.join() === '17,17,20,20', `health ${hp.join(', ')} after ${f} frames`);
  enemy(g, 1, 1, g.sc('eX', 0) + 8, 1, 3); // and the splash can kill
  const before = score(g);
  f = 0;
  while (g.sc('eHP', 0) === 17 && f < 600) { g.run(1); f += 1; }
  g.run(12);
  check('a splash kill counts', g.sc('eType', 1) === 0 && score(g) === before + 10, `kind ${g.sc('eType', 1)}, score ${before} -> ${score(g)}`);
}
{
  const g = quietGame();
  slot(g, 3, 1, 8); // army man, middle shelf
  enemy(g, 0, 1, 120, 1, 20);
  enemy(g, 1, 1, 126, 1, 20);
  let f = 0;
  while (g.sc('eHP', 0) === 20 && f < 600) { g.run(1); f += 1; }
  g.run(12);
  check('bullets do not splash', g.sc('eHP', 0) === 19 && g.sc('eHP', 1) === 20, `health ${g.sc('eHP', 0)}, ${g.sc('eHP', 1)}`);
}
{
  const g = boot();
  g.press(); g.frames(2);
  g.set('wave', 5); g.set('spawnLeft', 0);
  for (let i = 0; i < 5; i += 1) { g.set('eType', 0, i); g.set('eLane', 0xff, i); } // (an empty slot's shelf is $FF)
  let first = 0;
  for (let f = 0; f < 600 && !first; f += 1) { g.frames(1); first = [0, 1, 2, 3, 4].map((i) => g.sc('eType', i)).find((t) => t) ?? 0; }
  check('wave 6 opens with its boss, a T-Rex', g.sc('wave') === 6 && first === 8, `first kind ${first}`);
}
{
  const g = boot();
  g.press(); g.frames(2);
  g.set('wave', 3); g.set('spawnLeft', 0);
  for (let i = 0; i < 5; i += 1) { g.set('eType', 0, i); g.set('eLane', 0xff, i); } // (an empty slot's shelf is $FF)
  const seen = new Set();
  let packs = 0;
  for (let f = 0; f < 5000; f += 1) {
    g.frames(1);
    const kinds = [0, 1, 2, 3, 4].map((i) => g.sc('eType', i));
    kinds.forEach((k) => k && seen.add(k));
    if (kinds.filter((k) => k === 4).length === 3) packs += 1;
    for (let i = 0; i < 5; i += 1) if (g.sc('eX', i) < 100 && g.sc('eType', i)) g.set('eType', 0, i); // clear the way
    g.set('lids', 0);
  }
  check('wave 3 brings wind-up mice, in packs of three, along with dinos', seen.has(4) && seen.has(1) && packs > 0, `kinds ${[...seen].sort().join(',')}`);
}

// ---------------------------------------------------------------- Game Select and the difficulty switch
{
  const g = boot();
  check('power-on selects game 1', g.sc('state') === 0 && g.sc('game') === 1);
  const sel = () => { g.frames(1, { select: true }); g.frames(2); };
  sel(); const a = g.sc('game'); sel(); const b = g.sc('game'); sel(); const c = g.sc('game');
  check('Game Select steps through games 1, 2, 3 and back to 1', a === 2 && b === 3 && c === 1, `${a} ${b} ${c}`);
  g.frames(40, { select: true });
  check('holding Select changes the game once', g.sc('game') === 2);
  g.frames(2);
  sel();
  g.press();
  check('game 3 starts at wave 9 with 70 batteries and the toys of wave 9', g.sc('state') === 1 && g.sc('wave') === 9 && g.sc('batt') === 70 && g.sc('unlock') === 6, `wave ${g.sc('wave')}, batteries ${g.sc('batt')}, unlock ${g.sc('unlock')}`);
  g.frames(1, { select: true }); g.frames(2);
  check('Game Select during a game ends it and shows the selection (game 3 still chosen)', g.sc('state') === 0 && g.sc('game') === 3);
  g.frames(1, { reset: true }); g.frames(2);
  check('Game Reset starts the chosen game', g.sc('state') === 1 && g.sc('wave') === 9);
}
{
  // the same dino under each difficulty: B walks at the first-lap pace, A at the second-lap pace
  const pace = (diffA) => {
    const g = quietGame();
    enemy(g, 0, 0, 140, 1, 6);
    g.run(2, { diffA });
    const x0 = g.sc('eX', 0);
    g.run(60, { diffA });
    return x0 - g.sc('eX', 0);
  };
  const b = pace(false), a = pace(true);
  check('left difficulty A: wave-1 enemies walk at the second-lap pace (twice as fast)', a === 2 * b && b > 0, `B ${b}, A ${a} pixels in 60 frames`);
}

// ---------------------------------------------------------------- sound
{
  // what the TIA's audio registers hold after each frame
  const watch = (g, n, input = {}, each) => { const out = []; for (let k = 0; k < n; k += 1) { g.frames(1, input, each); out.push({ ...g.m.bus.audio }); } return out; };
  const g = boot();
  const theme = watch(g, 400);
  const melF = new Set([29, 26, 23, 19, 17, 14]), bassF = new Set([29, 26, 23, 19, 31]);
  check('before a game the theme plays: melody on channel 0 (pure tone), bass on channel 1', theme.some((a) => a.v0 > 0 && a.c0 === 4 && melF.has(a.f0)) && theme.some((a) => a.v1 > 0 && a.c1 === 12 && bassF.has(a.f1)));
  const notes = theme.filter((a, i) => a.v0 > 0 && (i === 0 || theme[i - 1].v0 === 0 || theme[i - 1].f0 !== a.f0)).map((a) => a.f0);
  {
    const g2 = boot();
    const a = watch(g2, 100 + 768 * 2).map((x) => `${x.c0},${x.v0},${x.f0},${x.c1},${x.v1},${x.f1}`);
    check('the theme repeats exactly every 64 eighth notes (768 frames)', a.slice(100, 868).join('|') === a.slice(868, 1636).join('|'), `${notes.length} note starts in 400 frames`);
  }
  g.frames(1, { fire: true });
  const start = watch(g, 40);
  check('a new game starts with the wave jingle on channel 0 (pure tone)', start.some((a) => a.v0 > 0 && a.c0 === 4));
  const hush = () => g.set('spawnTimer', 200);
  for (let i = 0; i < 5; i += 1) { g.set('eType', 0, i); g.set('eLane', 0xff, i); } // (an empty slot's shelf is $FF)
  watch(g, 60, {}, hush);
  g.frames(1, { fire: true }, hush);
  const place = watch(g, 20, {}, hush);
  check('placing a toy chirps on channel 0, then hands it back to the music', place.some((a) => a.v0 > 0 && a.f0 === 15) && g.sc('sndPri') === 0);
  check('during play the melody is soft (volume 3) and channel 1 carries no bass', place.concat(watch(g, 200, {}, hush)).every((a) => !(a.c0 === 4 && melF.has(a.f0) && a.v0 > 3)) && g.m.bus.audio.v1 === 0);
  g.set('batt', 0); g.set('cursor', 4); g.press(); // an empty slot
  const broke = watch(g, 10, {}, hush);
  check('trying to place without batteries buzzes (AUDC 6)', broke.some((a) => a.v0 > 0 && a.c0 === 6));
  g.set('batt', 30);
  enemy(g, 0, 1, 70, 1, 2);
  const fight = watch(g, 240, {}, hush);
  check('army man shots pop on channel 1 (noise)', fight.some((a) => a.v1 > 0 && a.c1 === 8));
  check('the kill plays its falling tone on channel 1 (AUDC 12)', g.sc('eType', 0) === 0 && fight.some((a) => a.v1 > 0 && a.c1 === 12));
  enemy(g, 0, 1, 56, 1, 99);
  const chew = watch(g, 64, {}, hush);
  check('chewing crunches on channel 1 (AUDC 3)', chew.some((a) => a.v1 > 0 && a.c1 === 3));
  for (let i = 0; i < 5; i += 1) { g.set('eType', 0, i); g.set('eLane', 0xff, i); } // (an empty slot's shelf is $FF)
  g.set('lids', 2);
  enemy(g, 0, 1, 42, 1, 6);
  const over = watch(g, 120, {}, hush);
  const after = watch(g, 300);
  check('game over plays its jingle (AUDC 12 on channel 0), then the theme comes back', g.sc('state') === 2 && over.some((a) => a.v0 > 0 && a.c0 === 12) && after.some((a) => a.v1 > 0 && a.c1 === 12));
}

console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
