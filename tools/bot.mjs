// A simple player that uses only the joystick: keeps army men in the first
// column, teddies in the second and tanks in the third (as they unlock and
// batteries allow), and rebuilds what gets chewed. Reports how far it gets.
// usage: node tools/bot.mjs [games]
import { readFileSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';

const SYM = Object.fromEntries(readFileSync('tools/build/toywars.sym', 'latin1').split(/\r?\n/).map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const ROM = readFileSync('toywars.bin');
const COST = [0, 10, 5, 25, 15, 20, 30];
const PLAN = [[3, 1], [0, 1], [6, 1], [4, 2], [1, 2], [7, 2], [5, 3], [2, 3], [8, 3]]; // [slot, toy]
const RIGHT = 0x7f, LEFT = 0xbf, DOWN = 0xdf, UP = 0xef;

export function playGame(seedFrames = 0, maxFrames = 60000) {
  const m = new Machine(ROM);
  const sc = (n, i = 0) => m.ram(SYM[`W_${n}`] + i);
  let mistimed = 0;
  const run = (stick = 0xff, fire = false) => {
    m.bus.swcha = stick; m.bus.inpt4 = fire ? 0 : 0x80; m.runFrame();
    const { total, vb } = m.layout();
    if (total !== 262 || vb[0][0] !== 40) {
      mistimed += 1;
      if (process.env.WHY) console.log('mistimed', JSON.stringify({ total, vb, frame: m.ram(SYM.frame), wave: sc('wave'), alive: [0, 1, 2, 3, 4].filter((i) => sc('eType', i)).length, toys: [...Array(9).keys()].filter((i) => sc('slotType', i)).length, dirty: sc('dirty') }));
    }
  };
  for (let i = 0; i < 3 + seedFrames; i += 1) run();
  mistimed = 0; // the frame running at power-on is partial
  run(0xff, true); run();
  let frames = 0, maxWave = 1;
  while (sc('state') === 1 && frames < maxFrames) {
    const want = PLAN.find(([s, t]) => !sc('slotType', s) && t <= sc('unlock') && sc('batt') >= COST[t]);
    if (!want) { run(); frames += 1; continue; }
    const [slot, toy] = want, cur = sc('cursor');
    if (cur !== slot) {
      const dir = Math.floor(slot / 3) < Math.floor(cur / 3) ? UP : Math.floor(slot / 3) > Math.floor(cur / 3) ? DOWN : slot % 3 > cur % 3 ? RIGHT : LEFT;
      run(dir); run(); frames += 2;
    } else if (sc('toy') !== toy) {
      run(0xff, true); run(RIGHT, true); run(0xff, true); run(); frames += 4;
    } else { run(0xff, true); run(); frames += 2; }
    maxWave = Math.max(maxWave, sc('wave'));
  }
  const score = [0, 1, 2].map((i) => sc('score', i).toString(16).padStart(2, '0')).join('');
  return { wave: sc('wave'), seconds: Math.round(frames / 60), score: Number(score), over: sc('state') === 2, lids: sc('lids'), mistimed, scViolations: m.bus.scViolations };
}

if (process.argv[1]?.endsWith('bot.mjs')) {
  const n = Number(process.argv[2] ?? 4);
  for (let g = 0; g < n; g += 1) console.log(JSON.stringify(playGame(g * 37)));
}
