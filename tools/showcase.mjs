// A scripted showcase GIF: a staged board (toys and monsters poked into RAM,
// the spawner held), then the game plays it out under joystick and fire: a
// jack-in-the-box chosen and set before a mouse pack (boing), a cannon
// splashing the crowd at a teddy, two jets at a T-Rex (left badly hurt,
// blinking) and the army man finishing it.
// usage: node tools/showcase.mjs [out.gif]   (ffmpeg on PATH; env EVERY, SCALE as tools/gif.mjs)
import { readFileSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';
import { gifWriter } from './gifenc.mjs';

const out = process.argv[2] ?? 'tools/out/showcase.gif';
const SYM = Object.fromEntries(readFileSync('tools/build/toywars.sym', 'latin1').split(/\r?\n/)
  .map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const [xs, ys] = (process.env.SCALE ?? '4x2').split('x').map(Number);
const m = new Machine(readFileSync('toywars.bin'));
const sc = (n, i = 0) => m.ram(SYM[`W_${n}`] + i);
const set = (n, v, i = 0) => m.poke(SYM[`W_${n}`] + i, v);
const STICK = { up: 0x10, down: 0x20, left: 0x40, right: 0x80 };
const [ARMY, TEDDY, TANK, JACK, CANNON, JET] = [1, 2, 3, 4, 5, 6];
const [DINO, , CRAWLER, MOUSE, , , , TREX] = [1, 2, 3, 4, 5, 6, 7, 8];
let gif = null;

// one frame with the given input; the spawner held, so only the staged monsters come
function frame({ stick = 0, fire = false } = {}) {
  m.bus.swcha = 0xff ^ stick; m.bus.inpt4 = fire ? 0 : 0x80; m.bus.swchb = 0x0b;
  set('spawnTimer', 200); set('spawnLeft', 5);
  m.runFrame();
  if (gif) gif.add(m.bus.tia.lastFrame);
}
const wait = (n) => { for (let i = 0; i < n; i += 1) frame(); };
const until = (cond, max = 600) => { for (let i = 0; i < max && !cond(); i += 1) frame(); };
const tap = (input, hold = 2) => { for (let i = 0; i < hold; i += 1) frame(input); for (let i = 0; i < 6; i += 1) frame(); };
// fire held, right until the toy is chosen, then let go (a change places nothing)
function choose(toy) {
  if (sc('toy') === toy) return; // (a press and release with no change would place it)
  frame({ fire: true });
  while (sc('toy') !== toy) { frame({ fire: true, stick: STICK.right }); for (let i = 0; i < 9; i += 1) frame({ fire: true }); }
  wait(8);
}
function moveTo(slot) {
  while (sc('cursor') !== slot) {
    const c = sc('cursor');
    const dir = Math.floor(slot / 3) < Math.floor(c / 3) ? 'up' : Math.floor(slot / 3) > Math.floor(c / 3) ? 'down' : slot % 3 < c % 3 ? 'left' : 'right';
    tap({ stick: STICK[dir] });
  }
}
const place = () => tap({ fire: true });
const MAXHP = (kind, wave) => [0, 6, 5, 3, 1, 6, 2, 3, 20][kind] + ((wave >> 2) >> (kind === MOUSE ? 1 : 0));
function monster(i, kind, lane, x, wave = 10) {
  const hp = MAXHP(kind, wave);
  set('eLane', lane, i); set('eX', x, i); set('eType', kind, i); set('eHP', hp, i); set('eState', Math.min(15, hp >> 1), i);
}

// ---- the stage: a game started, wave 10 with every toy, a full battery
for (let i = 0; i < 3; i += 1) frame();
frame({ fire: true }); wait(3);
set('wave', 10); set('unlock', JET); set('batt', 99); set('dirty', 7);
for (let i = 0; i < 5; i += 1) { set('eType', 0, i); set('eLane', 0xff, i); }
const toys = [[0, ARMY, 8], [3, CANNON, 10], [5, TEDDY, 40], [6, ARMY, 8], [7, TANK, 12]];
for (let s = 0; s < 9; s += 1) { set('slotType', 0, s); set('slotHP', 0, s); }
for (const [s, t, hp] of toys) { set('slotType', t, s); set('slotHP', hp, s); set('slotCool', 0, s); }
set('cursor', 4); set('toy', ARMY);
wait(40); // (every shelf's pointers redrawn)

gif = gifWriter(out, { every: Number(process.env.EVERY ?? 2), xs, ys });
// a crowd walks to the teddy on the middle shelf, where the cannon splashes it
monster(2, DINO, 1, 140); monster(3, CRAWLER, 1, 151);
wait(30);
// the jack-in-the-box, chosen and set on the top shelf
choose(JACK);
moveTo(2);
place();
wait(20);
// a mouse pack and a dino run into it
monster(0, MOUSE, 0, 151); monster(1, MOUSE, 0, 145); monster(4, DINO, 0, 151);
until(() => sc('slotType', 2) !== JACK, 400);
wait(70);
// the T-Rex on the bottom shelf: two jets
choose(JET);
moveTo(8);
until(() => [0, 1, 2, 3, 4].every((i) => !sc('eType', i) || sc('eLane', i) !== 2) && [0, 1, 4].some((i) => !sc('eType', i)), 300);
const rex = [0, 1, 4].find((i) => !sc('eType', i));
monster(rex, TREX, 2, 151);
until(() => sc('eX', rex) <= 128, 900);
place();
wait(60);
place();
until(() => sc('eType', rex) !== TREX, 900);
wait(60);
await gif.end();
console.log(`${out}: ${gif.frames} frames, ${(gif.frames * Number(process.env.EVERY ?? 2) / 60).toFixed(1)} s`);
