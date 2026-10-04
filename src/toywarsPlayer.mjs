// Playable Toy Wars: toywars.bin (16K F6 + Super Chip) on the 6502 core
// (romMachine.mjs), drawn on a canvas, with keyboard input while the game has
// focus, a gamepad, touch buttons on phones, Game Reset and Game Select, and
// the TIA sound worklet. Mount with mountPlayer(root, rom, symbols); root
// holds the canvas and the [data-*] controls, symbols maps the assembler's
// labels (tools/build/toywars.sym) to addresses.
import { RomMachine } from './romMachine.mjs';
import { NTSC_PALETTE_RGB } from './palette.mjs';
import { createTiaAudio } from './tiaAudio.mjs';
import { readGamepad, gamepadEdges } from './gamepad.mjs';

export const FIRST_LINE = 40;    // VBLANK goes off early in frame line 40 and back on early in line 232
export const VISIBLE_LINES = 192;
const FRAME_MS = 1000 / 60;
const KEYS = {
  ArrowRight: 'right', KeyD: 'right', ArrowLeft: 'left', KeyA: 'left',
  ArrowDown: 'down', KeyS: 'down', ArrowUp: 'up', KeyW: 'up', Space: 'fire', KeyZ: 'fire',
};

export function mountPlayer(root, rom, symbols) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const playButton = root.querySelector('[data-play]');
  const poster = root.querySelector('[data-poster]');
  const hint = root.querySelector('[data-hint]');
  const muteButton = root.querySelector('[data-mute]');
  const pauseButton = root.querySelector('[data-pause]');

  const game = new RomMachine(rom);
  const held = new Set();
  const audio = createTiaAudio(new URL('./tiaSound.worklet.js', import.meta.url).href);
  const screen = document.createElement('canvas');
  screen.width = 160;
  screen.height = VISIBLE_LINES;
  const screenCtx = screen.getContext('2d');
  const image = screenCtx.createImageData(160, VISIBLE_LINES);

  let started = false, paused = false, muted = false, resetHold = 0, resetDown = false, selectHold = 0, selectDown = false;
  let last = 0, acc = 0, pad = null, lastState = '';

  const setHint = (text) => { if (hint) hint.textContent = text; };
  const silence = () => audio.setSilent(muted || paused || !started);
  const sc = (name) => game.bus.scram[symbols[`W_${name}`] & 0x7f]; // Super Chip RAM

  function step() {
    const on = (control) => held.has(control) || !!pad?.[control];
    let swcha = 0xff;
    if (on('right')) swcha &= ~0x80;
    if (on('left')) swcha &= ~0x40;
    if (on('down')) swcha &= ~0x20;
    if (on('up')) swcha &= ~0x10;
    game.bus.swcha = swcha;
    game.bus.inpt4 = on('fire') ? 0x00 : 0x80;
    // SWCHB: bit 0 RESET, bit 1 SELECT (low = pressed)
    game.bus.swchb = (resetHold > 0 || resetDown ? 0 : 0x01) | (selectHold > 0 || selectDown ? 0 : 0x02) | 0x08;
    game.runFrame();
    if (resetHold > 0) resetHold -= 1;
    if (selectHold > 0) selectHold -= 1;
    audio.update(game.bus.audio);
    // hints follow the game: before a game, playing, game over
    const state = ['waiting', 'playing', 'over'][sc('state')] ?? 'waiting';
    if (started && state !== lastState) {
      if (state === 'waiting') setHint('Fire or Enter starts a game.');
      else if (state === 'playing') setHint('Joystick or arrows move the cursor over the nine slots. Space places the chosen toy (or picks one up). Hold Space and press left/right to choose another toy. Enter restarts.');
      else setHint('Game over. Fire starts a new game.');
    }
    lastState = state;
  }

  function draw() {
    const rows = game.bus.tia.lastFrame;
    if (!rows) return;
    const data = image.data;
    for (let y = 0; y < VISIBLE_LINES; y += 1) {
      const row = rows[FIRST_LINE + y];
      for (let x = 0; x < 160; x += 1) {
        const rgb = NTSC_PALETTE_RGB[(row[x] >> 1) & 0x7f];
        const o = (y * 160 + x) * 4;
        data[o] = rgb >> 16; data[o + 1] = (rgb >> 8) & 0xff; data[o + 2] = rgb & 0xff; data[o + 3] = 255;
      }
    }
    screenCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(screen, 0, 0, canvas.width, canvas.height);
  }

  function frame(t) {
    if (!last) last = t;
    const dt = Math.min(100, t - last);
    last = t;
    pad = readGamepad();
    const edges = gamepadEdges(pad);
    if (edges.start) (started ? pressReset() : play());
    if (edges.back && started) togglePause();
    if (!paused && !document.hidden) {
      acc += dt;
      while (acc >= FRAME_MS) { step(); acc -= FRAME_MS; }
    }
    draw();
    requestAnimationFrame(frame);
  }

  function pressReset() {
    resetHold = 2;
    paused = false;
    if (pauseButton) pauseButton.textContent = 'Pause';
    silence();
  }

  async function play() {
    started = true;
    lastState = ''; // show the hint for wherever the game is now
    if (poster) poster.hidden = true;
    canvas.focus({ preventScroll: true });
    pressReset(); // before the audio: starting it can take a moment, the game should not wait
    await audio.start();
    silence();
  }

  function togglePause() {
    paused = !paused;
    if (pauseButton) pauseButton.textContent = paused ? 'Resume' : 'Pause';
    silence();
  }

  function toggleMute() {
    muted = !muted;
    if (muteButton) {
      muteButton.textContent = muted ? 'Sound on' : 'Mute';
      muteButton.setAttribute('aria-pressed', String(muted));
    }
    silence();
  }

  playButton?.addEventListener('click', play);
  pauseButton?.addEventListener('click', () => { if (started) togglePause(); });
  muteButton?.addEventListener('click', toggleMute);
  const resetButton = root.querySelector('[data-reset]');
  resetButton?.addEventListener('pointerdown', () => { if (!started) play(); else pressReset(); resetDown = true; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) resetButton?.addEventListener(ev, () => { resetDown = false; });
  const selectButton = root.querySelector('[data-select]');
  selectButton?.addEventListener('pointerdown', () => { if (!started) play(); selectHold = 2; selectDown = true; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) selectButton?.addEventListener(ev, () => { selectDown = false; });

  canvas.addEventListener('keydown', (event) => {
    const control = KEYS[event.code];
    if (control) { event.preventDefault(); held.add(control); }
    if (event.code === 'Enter') { event.preventDefault(); if (!started) play(); else { if (!event.repeat) pressReset(); resetDown = true; } }
    if (event.code === 'KeyG') { if (!event.repeat) selectHold = 2; selectDown = true; }
    if (event.code === 'KeyP') togglePause();
    if (event.code === 'KeyM') toggleMute();
  });
  canvas.addEventListener('keyup', (event) => {
    const control = KEYS[event.code];
    if (control) held.delete(control);
    if (event.code === 'Enter') resetDown = false;
    if (event.code === 'KeyG') selectDown = false;
  });
  canvas.addEventListener('blur', () => { held.clear(); resetDown = selectDown = false; });
  canvas.addEventListener('pointerdown', () => { if (!started) play(); });

  // touch controls: hold to press
  root.querySelectorAll('[data-hold]').forEach((button) => {
    const control = button.dataset.hold;
    const down = (event) => {
      event.preventDefault();
      held.add(control);
      if (!started) play();
      try { button.setPointerCapture(event.pointerId); } catch { /* finger already lifted: the press still counts */ }
    };
    const up = () => held.delete(control);
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  });

  document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));

  step();
  draw();
  requestAnimationFrame(frame);

  // dev hook for headless checks: runs frames without the animation loop
  return {
    machine: game,
    step(n = 1) { for (let i = 0; i < n; i += 1) step(); draw(); },
    hold(control, on) { if (on) held.add(control); else held.delete(control); },
    reset: pressReset,
    play,
  };
}
