// Runs a 2600 ROM image on the 6502 core and the shared bus (RAM, RIOT, TIA
// model). runFrame() plays one frame, up to the next VSYNC.
import { M6502 } from '../../src/cpu6502.mjs';
import { VcsBus, TIA, CYCLES_PER_LINE } from '../../src/vcsBus.mjs';

export { TIA, CYCLES_PER_LINE };

export class Machine {
  constructor(rom, options = {}) {
    this.bus = new VcsBus(rom, options);
    this.cpu = new M6502(this.bus);
    this.bus.cpu = this.cpu;
    this.cpu.reset();
  }
  runFrame(limit = 400000) {
    const start = this.cpu.cycles, frame = this.bus.frame;
    while (this.bus.frame === frame) {
      this.cpu.step();
      if (this.cpu.cycles - start > limit) throw new Error(`frame did not end (pc $${this.cpu.pc.toString(16)})`);
    }
  }
  // zero-page RAM ($80-$FF) or Super Chip RAM (any $x000-$x0FF address)
  ram(addr) { return addr >= 0x1000 ? this.bus.scram[addr & 0x7f] : this.bus.ram[addr & 0x7f]; }
  poke(addr, v) { if (addr >= 0x1000) this.bus.scram[addr & 0x7f] = v; else this.bus.ram[addr & 0x7f] = v; }
  // VBLANK changes in the last frame as [line, on]
  layout() {
    const w = this.bus.lastFrameWrites;
    const vb = w.filter((x) => x.reg === TIA.VBLANK).map((x) => [Math.floor(x.cycle / CYCLES_PER_LINE) + ((x.cycle % CYCLES_PER_LINE) * 3 >= 68 ? 1 : 0), (x.value & 2) !== 0]);
    const total = Math.round(w.at(-1).cycle / CYCLES_PER_LINE);
    return { vb, total };
  }
}
