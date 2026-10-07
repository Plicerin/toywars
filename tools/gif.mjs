// Records an animated GIF of the playtest player's game (tools/player.mjs)
// through tools/gifenc.mjs (ffmpeg on PATH).
// usage: node tools/gif.mjs [strategy] [seed] [start] [seconds] [out.gif]
//   start: a frame number (counted from power-on), wN (the first frame of wave N), or
//   wN+S (S seconds into wave N)
//   env: OPTS (the player's knobs, e.g. '{"diffA":true}'), EVERY=2 (frames merged
//   into one GIF frame: 2 = 30 fps, 3 = 20 fps; merging shows the monsters that
//   take turns being drawn), SCALE=4x2 (pixel size), ROM=path SYM=path (another build)
// e.g. node tools/gif.mjs army 0 w16+6 12 img/play.gif
import { readFileSync } from 'node:fs';
import { VcsBus } from '../src/vcsBus.mjs';
import { gifWriter } from './gifenc.mjs';
import { playGame } from './player.mjs';

const [strategy = 'heavy', seedArg = '0', startArg = 'w5', secondsArg = '10', out = 'tools/out/play.gif'] = process.argv.slice(2);
const SYM = Object.fromEntries(readFileSync(process.env.SYM ?? 'tools/build/toywars.sym', 'latin1').split(/\r?\n/)
  .map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const every = Number(process.env.EVERY ?? 2);
const [xs, ys] = (process.env.SCALE ?? '4x2').split('x').map(Number);
const opts = process.env.OPTS ? JSON.parse(process.env.OPTS) : {};
const want = Math.round(Number(secondsArg) * 60 / every); // GIF frames
const waveStart = /^w(\d+)(?:\+([\d.]+))?$/.exec(startArg);
let waveAt = -1; // the frame wave N began

const gif = gifWriter(out, { every, xs, ys });
const DONE = Symbol('done');
let started = false;
const onFrame = (bus) => {
  if (!started) {
    if (waveStart) {
      if (waveAt < 0 && bus.scram[SYM.W_wave & 0x7f] >= Number(waveStart[1]) && bus.scram[SYM.W_state & 0x7f] === 1) waveAt = bus.frame;
      started = waveAt >= 0 && bus.frame >= waveAt + Math.round(60 * Number(waveStart[2] ?? 0));
    } else started = bus.frame >= Number(startArg);
    if (!started) return;
  }
  gif.add(bus.tia.lastFrame);
  if (gif.frames >= want) throw DONE;
};
// (the player's machine is made inside playGame; its bus sets onFrame = null, which this accessor ignores)
Object.defineProperty(VcsBus.prototype, 'onFrame', { get: () => onFrame, set: () => {} });

let result = 'the game ended first';
try {
  playGame({ seedFrames: Number(seedArg), strategy, maxFrames: 1e7, opts });
} catch (e) {
  if (e !== DONE) throw e;
  result = 'done';
}
await gif.end();
console.log(`${out}: ${gif.frames} frames at ${60 / every} fps, ${(gif.frames * every / 60).toFixed(1)} s (${result})`);
