// Records an animated GIF of the playtest player's game (tools/player.mjs),
// encoded by ffmpeg (on PATH) with a palette made from the frames, so the
// 2600's colors stay exact.
// usage: node tools/gif.mjs [strategy] [seed] [start] [seconds] [out.gif]
//   start: a frame number (counted from power-on), wN (the first frame of wave N), or
//   wN+S (S seconds into wave N)
//   env: OPTS (the player's knobs, e.g. '{"diffA":true}'), EVERY=2 (frames merged
//   into one GIF frame: 2 = 30 fps, 3 = 20 fps; merging shows the monsters that
//   take turns being drawn), SCALE=4x2 (pixel size), ROM=path SYM=path (another build)
// e.g. node tools/gif.mjs heavy 0 w7+8 12 img/play.gif
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { VcsBus } from '../src/vcsBus.mjs';
import { NTSC_PALETTE_RGB } from '../src/palette.mjs';
import { playGame } from './player.mjs';

const [strategy = 'heavy', seedArg = '0', startArg = 'w5', secondsArg = '10', out = 'tools/out/play.gif'] = process.argv.slice(2);
const SYM = Object.fromEntries(readFileSync(process.env.SYM ?? 'tools/build/toywars.sym', 'latin1').split(/\r?\n/)
  .map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const EVERY = Number(process.env.EVERY ?? 2);
const [XS, YS] = (process.env.SCALE ?? '4x2').split('x').map(Number);
const opts = process.env.OPTS ? JSON.parse(process.env.OPTS) : {};
const want = Math.round(Number(secondsArg) * 60 / EVERY); // GIF frames
const waveStart = /^w(\d+)(?:\+([\d.]+))?$/.exec(startArg);
let waveAt = -1; // the frame wave N began
const TOP = 40, LINES = 192, W = 160 * XS, H = LINES * YS;

const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(60 / EVERY), '-i', '-',
  '-vf', 'split[a][b];[a]palettegen=stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-loop', '0', out], { stdio: ['pipe', 'inherit', 'inherit'] });

const rgb = NTSC_PALETTE_RGB.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
const merged = Array.from({ length: LINES }, () => new Uint8Array(160));
let started = false, inGroup = 0, written = 0;
const DONE = Symbol('done');
const emit = () => {
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < LINES; y += 1) {
    const row = merged[y];
    for (let x = 0; x < 160; x += 1) {
      const [r, g, b] = rgb[(row[x] >> 1) & 0x7f];
      for (let dy = 0; dy < YS; dy += 1) for (let dx = 0; dx < XS; dx += 1) { const o = ((y * YS + dy) * W + x * XS + dx) * 3; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; }
    }
  }
  ff.stdin.write(buf);
};

// every frame the game finishes (the emulator's hook): merge, and write each group as one GIF frame
const onFrame = (bus) => {
  if (!started) {
    if (waveStart) {
      if (waveAt < 0 && bus.scram[SYM.W_wave & 0x7f] >= Number(waveStart[1]) && bus.scram[SYM.W_state & 0x7f] === 1) waveAt = bus.frame;
      started = waveAt >= 0 && bus.frame >= waveAt + Math.round(60 * Number(waveStart[2] ?? 0));
    }
    else started = bus.frame >= Number(startArg);
    if (!started) return;
  }
  const f = bus.tia.lastFrame;
  for (let y = 0; y < LINES; y += 1) {
    const src = f[TOP + y], dst = merged[y];
    for (let x = 0; x < 160; x += 1) if (inGroup === 0 || src[x]) dst[x] = src[x]; // (a later frame's object over an earlier one)
  }
  inGroup += 1;
  if (inGroup === EVERY) { emit(); inGroup = 0; written += 1; if (written >= want) throw DONE; }
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
ff.stdin.end();
ff.on('close', (code) => {
  if (code) { console.error(`ffmpeg failed (${code}) after ${written} frames`); process.exit(1); }
  console.log(`${out}: ${written} frames at ${60 / EVERY} fps, ${(written * EVERY / 60).toFixed(1)} s (${result})`);
});
