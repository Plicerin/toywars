// Animated GIF writer for emulator frames: pipes RGB frames to ffmpeg (on
// PATH), which builds one palette from them all, so the 2600's colors stay exact.
// gifWriter(out, { every, xs, ys }).add(tiaFrame) per emulated frame; every
// `every` frames merge into one GIF frame (a later frame's object over an
// earlier one, so the monsters that take turns being drawn all show);
// end() resolves when the file is written.
import { spawn } from 'node:child_process';
import { NTSC_PALETTE_RGB } from '../src/palette.mjs';

const TOP = 40, LINES = 192; // the visible picture
const RGB = NTSC_PALETTE_RGB.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);

export function gifWriter(out, { every = 2, xs = 4, ys = 2 } = {}) {
  const W = 160 * xs, H = LINES * ys;
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(60 / every), '-i', '-',
    '-vf', 'split[a][b];[a]palettegen=stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-loop', '0', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((res, rej) => ff.on('close', (code) => (code ? rej(new Error(`ffmpeg failed (${code})`)) : res())));
  const merged = Array.from({ length: LINES }, () => new Uint8Array(160));
  let inGroup = 0, frames = 0;
  const emit = () => {
    const buf = Buffer.alloc(W * H * 3);
    for (let y = 0; y < LINES; y += 1) {
      const row = merged[y];
      for (let x = 0; x < 160; x += 1) {
        const [r, g, b] = RGB[(row[x] >> 1) & 0x7f];
        for (let dy = 0; dy < ys; dy += 1) for (let dx = 0; dx < xs; dx += 1) { const o = ((y * ys + dy) * W + x * xs + dx) * 3; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; }
      }
    }
    ff.stdin.write(buf);
    frames += 1;
  };
  return {
    get frames() { return frames; },
    add(frame) {
      for (let y = 0; y < LINES; y += 1) {
        const src = frame[TOP + y], dst = merged[y];
        for (let x = 0; x < 160; x += 1) if (inGroup === 0 || src[x]) dst[x] = src[x];
      }
      inGroup += 1;
      if (inGroup === every) { emit(); inGroup = 0; }
    },
    end() { ff.stdin.end(); return closed; },
  };
}
