// Runs toywars.bin and writes frames as PNGs; prints frame layout.
// usage: node tools/shot.mjs [frames]
import { readFileSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';
import { writeFramePng } from './atari/png.mjs';
const m = new Machine(readFileSync('toywars.bin'));
const n = Number(process.argv[2] ?? 10);
for (let f = 0; f < n; f++) { m.runFrame(); if (f > 1) console.log(f, JSON.stringify(m.layout())); }
writeFramePng('tools/out/frameA.png', m.bus.tia.lastFrame.slice(0, 262), 3, 2);
m.runFrame();
writeFramePng('tools/out/frameB.png', m.bus.tia.lastFrame.slice(0, 262), 3, 2);
