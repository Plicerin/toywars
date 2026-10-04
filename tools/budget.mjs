// Overscan logic time in the late-game stress scenario (as in test.mjs):
// cycles from the jsr CallLogic stub to the timer wait, per frame.
// usage: node tools/budget.mjs
import { readFileSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';

const SYM = Object.fromEntries(readFileSync('tools/build/toywars.sym', 'latin1').split(/\r?\n/)
  .map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const m = new Machine(readFileSync('toywars.bin'));
const set = (n, v, i = 0) => m.poke(SYM[`W_${n}`] + i, v);
const get = (n, i = 0) => m.ram(SYM[`W_${n}`] + i);
const WAIT = SYM['0.osWait'], CALL = SYM.CallLogic;
let start = -1, spent = 0;
const PROF = process.env.PROF !== undefined;
const logicLabels = new Set([...readFileSync('logic.asm', 'latin1').matchAll(/^([A-Za-z]\w*):/gm)].map((x) => x[1]));
const labels = Object.entries(SYM).filter(([n]) => logicLabels.has(n)).sort((a, b) => a[1] - b[1]);
const labelOf = (pc) => { let best = '?'; for (const [n, a] of labels) { if (a <= pc) best = n; else break; } return best; };
let prof = new Map();
function frame(input = {}) {
  m.bus.swcha = 0xff; m.bus.inpt4 = input.fire ? 0 : 0x80; m.bus.swchb = 0x0b;
  const f = m.bus.frame; start = -1; spent = 0;
  while (m.bus.frame === f) {
    const pc = m.cpu.pc;
    if (pc === CALL && m.bus.bank === 0 && start < 0) start = m.cpu.cycles;
    if (PROF && start >= 0 && !spent && m.bus.bank === 2) { const c0 = m.cpu.cycles; m.cpu.step(); const l = labelOf(pc); prof.set(l, (prof.get(l) ?? 0) + m.cpu.cycles - c0); continue; }
    if (pc === WAIT && m.bus.bank === 0 && start >= 0 && !spent) spent = m.cpu.cycles - start;
    m.cpu.step();
  }
  return spent;
}
for (let i = 0; i < 3; i += 1) frame();
frame({ fire: true }); frame(); frame(); frame();
set('wave', 14); set('unlock', 6); set('batt', 99); set('dirty', 7);
const toys = [...(process.argv[2] ?? '135123145')].map(Number);
const fill = () => toys.forEach((t, s) => { set('slotType', t, s); set('slotHP', 40, s); });
fill(); toys.forEach((t, s) => set('slotCool', 0, s));
const worst = [[0, 0], [0, 0]];
for (let f = 0; f < 3000; f += 1) {
  if (f % 300 === 0) fill();
  set('spawnLeft', 20);
  for (let i = 0; i < 5; i += 1) if (!get('eType', i)) { const k = (f + i) % 9; set('eType', 1 + k, i); set('eLane', ((f + i) % 3) | (k === 8 ? 4 : 0), i); set('eX', 151 - ((f * 7 + i * 23) % 60), i); set('eHP', 9, i); set('eState', 0, i); }
  prof = new Map();
  const c = frame();
  const odd = m.ram(SYM.frame) & 1;
  const L = m.layout(); if (L.total !== 262 || L.vb[0][0] !== 40) console.log('mistimed frame', f, 'logic', c, 'lines', L.total);
  if (c > worst[odd][0]) { worst[odd] = [c, f]; if (PROF) worst[odd][2] = [...prof].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, v]) => `${n} ${v}`).join(', '); }
}
if (PROF) console.log(worst.map((w) => w[2]).join('\n'));
console.log(`budget about ${35 * 64} cycles; worst logic: even ${worst[0][0]} (frame ${worst[0][1]}), odd ${worst[1][0]} (frame ${worst[1][1]})`);
