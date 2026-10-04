// Runs a 2600 ROM image in the page: the 6502 core on the shared bus (RAM,
// RIOT, TIA model). runFrame() plays one frame, up to the next VSYNC; the
// picture is in bus.tia.lastFrame and the sound registers in bus.audio.
import { M6502 } from './cpu6502.mjs';
import { VcsBus } from './vcsBus.mjs';

export class RomMachine {
  constructor(rom) {
    this.bus = new VcsBus(rom);
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
}
