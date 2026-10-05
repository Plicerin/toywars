// A playtesting bot for Toy Wars that plays with the joystick, fire button
// and console switches only. It reads RAM to see the board (as a human reads
// the screen) but never writes it.
//  - keeps a per-shelf layout (front teddy, shooters behind, heavier toys as
//    they unlock), rebuilds what gets chewed, swaps worn teddies between
//    chewers (a toy can't go down on a standing monster), salvages toys
//    about to be eaten; OPTS {"legacy":true} is the old drop-on-the-monster player
//  - reacts to the shelf under pressure, spends jets on monsters that got
//    past every toy or that bunch up chewing behind the front teddy (jetChew:
//    their health; no jet reserve kept), blocks with a teddy dropped in front
//    of a runaway; cannon strategy, second lap (wave 13+): a cannon by the box too (lap2)
//    (the previous defaults: OPTS {"jetChew":0,"jetReserve":true,"lap2":null,"repairAt":30})
//  - checks a few rules while it watches (logged as "anomalies"; result.stats:
//    refused drops, jet take-off x, lasso distances and holds, jet bursts,
//    batteries spent per toy and refunded, spawns per shelf, frames per wave)
// usage: node tools/player.mjs [games] [strategy: cannon (best), tank, heavy, cannon0, army, wall, wallArmy, cowboy] [seedBase] [maxFrames]
//   env: OPTS='{"repairAt":20}' (strategy knobs), LOG=1 (actions), TRACE=a-b (board per frame), PROF_AT=f,f (logic cycle profile)
import { readFileSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';

const SYM = Object.fromEntries(readFileSync('tools/build/toywars.sym', 'latin1').split(/\r?\n/).map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const ROM = readFileSync(process.env.ROM ?? 'toywars.bin'); // (ROM=path: a variant cartridge, same symbols)

const ARMY = 1, TEDDY = 2, TANK = 3, COWBOY = 4, CANNON = 5, JET = 6;
const COST = [0, 10, 5, 25, 15, 20, 30];
const TOYHP = [0, 8, 40, 12, 8, 10, 1];
const TOYNAME = ['-', 'army', 'teddy', 'tank', 'cowboy', 'cannon', 'jet'];
const DINO = 1, HELI = 2, CRAWL = 3, MOUSE = 4, KNIGHT = 5, BALLOON = 6, POGO = 7, TREX = 8, EJET = 9;
const ENAME = ['-', 'dino', 'heli', 'crawler', 'mouse', 'knight', 'balloon', 'pogo', 'trex', 'jet'];
const COLX = [48, 80, 112];
const BREACH_X = 41;
const UP = 0x10, DOWN = 0x20, LEFT = 0x40, RIGHT = 0x80; // SWCHA bits (active low)

// Layouts: per column (0 = by the box, 2 = front), a list of [unlock, toy];
// the last entry the unlock allows is the wanted toy.
const STRATEGIES = {
  // front teddy, army man in the middle, tank by the box
  tank: { cols: [[[1, ARMY], [3, TANK]], [[1, ARMY]], [[2, TEDDY]]] },
  // front teddy, cannon in the middle (splashes the pile at the teddy), army by the box
  cannon: { cols: [[[1, ARMY]], [[1, ARMY], [5, CANNON]], [[2, TEDDY]]] },
  // front teddy, army in the middle, cannon by the box (tank before it)
  cannon0: { cols: [[[1, ARMY], [3, TANK], [5, CANNON]], [[1, ARMY]], [[2, TEDDY]]] },
  // two army men behind a teddy (cheapest shooters)
  army: { cols: [[[1, ARMY]], [[1, ARMY]], [[2, TEDDY]]] },
  // tank by the box, cannon in the middle, teddy in front
  heavy: { cols: [[[1, ARMY], [3, TANK]], [[1, ARMY], [5, CANNON]], [[2, TEDDY]]] },
  // two teddy walls (monsters chewing the second while the first is put back), cannon by the box
  wall: { cols: [[[1, ARMY], [5, CANNON]], [[1, ARMY], [2, TEDDY]], [[2, TEDDY]]] },
  // the same with an army man by the box
  // a cowboy in the middle lassoes whatever chews the front teddy (40 pixels ahead); cannon by the box
  cowboy: { cols: [[[1, ARMY], [5, CANNON]], [[1, ARMY], [4, COWBOY]], [[2, TEDDY]]] },
  // two cannons behind a teddy (used for the second lap: OPTS lap2)
  cannon2: { cols: [[[1, ARMY], [5, CANNON]], [[1, ARMY], [5, CANNON]], [[2, TEDDY]]] },
  wallArmy: { cols: [[[1, ARMY]], [[1, ARMY], [2, TEDDY]], [[2, TEDDY]]] },
};

// debugging: PROF_AT=frame,frame,... prints where the overscan logic spends its cycles on those frames
const PROF_AT = new Set((process.env.PROF_AT ?? '').split(',').filter(Boolean).map(Number));
const labelSet = (file) => new Set([...readFileSync(file, 'latin1').matchAll(/^([A-Za-z]\w*):?/gm)].map((x) => x[1]));
const LOGIC = labelSet('logic.asm');
const LISTS = [false, true].map((logic) => Object.entries(SYM).filter(([n]) => LOGIC.has(n) === logic && /^[A-Za-z]\w*$/.test(n) && !/^[WR]_/.test(n)).sort((a, b) => a[1] - b[1]));
function profileFrame(m, at) {
  const labelOf = (pc, bank) => { let best = '?'; for (const [n, a] of LISTS[bank === 2 ? 1 : 0]) { if (a <= pc) best = n; else break; } return best; };
  const CALL = SYM.CallLogic, WAIT = SYM['0.osWait'];
  const f = m.bus.frame, prof = new Map();
  let start = -1, spent = 0;
  while (m.bus.frame === f) {
    const pc = m.cpu.pc;
    if (pc === CALL && start < 0) start = m.cpu.cycles;
    if (pc === WAIT && start >= 0 && !spent) spent = m.cpu.cycles - start;
    const c0 = m.cpu.cycles, bank = m.bus.bank; m.cpu.step();
    if (start >= 0 && !spent) { const l = labelOf(pc, bank); prof.set(l, (prof.get(l) ?? 0) + m.cpu.cycles - c0); }
  }
  console.log(`PROF frame ${at}: logic ${spent} cycles (budget ~${35 * 64}):`, [...prof].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, v]) => `${n} ${v}`).join(', '));
}

export function playGame({ seedFrames = 0, strategy = 'cannon', maxFrames = 216000, opts = {}, log = false } = {}) {
  // legacy: the old player (repairs by picking up a chewed toy and dropping a
  // fresh one on the monster; the game now refuses that drop)
  const o = { jetChew: 6, lap2: strategy === 'cannon' ? 'cannon2' : null, jetReserve: false, repairAt: 24, upgrade: true, jetX: 90, trexJetX: 110, cowboyTrex: true, bossPrep: true, trexGap: 40, overflow: 90, overflowHp: 12, repairShooters: false, shooterRepairAt: 2, legacy: false, salvage: true, cover: true, balloonFree: true, ...opts };
  if (o.legacy) { if (!('repairShooters' in opts)) o.repairShooters = true; if (!('repairAt' in opts)) o.repairAt = 12; if (!('salvage' in opts)) o.salvage = false; if (!('cover' in opts)) o.cover = false; }
  const strat = STRATEGIES[strategy];
  const m = new Machine(ROM);
  const sc = (n, i = 0) => m.ram(SYM[`W_${n}`] + i);
  let mistimed = 0, frames = 0;
  const mistimedAt = [];
  const anomalies = [];
  const events = [];
  const jetFrames = [];
  const mistimedAll = [];
  // rule checks for the new rules
  const stats = { refused: 0, refusedAnom: 0, placedOnMonster: 0, jetLaunchX: {}, jetMissed: 0, jetHits: 0, lassoD: {}, lassoMax: 0, lassos: 0, lassoImmuneBroken: 0, longestHold: 0, jetBursts: 0, balloonDrops: 0, spent: {}, spawns: {}, spawnSeq: {}, waveFrames: {}, longestWave: 0, battAtWave: {}, framesAtCap: 0, playFrames: 0 };
  let jetWatch = null; let waveStart = 0;
  const note = (s) => { events.push(`f${frames} w${sc('wave')} ${s}`); if (log) console.log(`f${frames} w${sc('wave')} ${s}`); };
  const anomaly = (s) => { if (anomalies.length < 40) anomalies.push(`f${frames} w${sc('wave')} ${s}`); if (log) console.log('ANOMALY', s); };

  // ---- watching (read only)
  const enemies = () => [0, 1, 2, 3, 4].filter((i) => sc('eType', i)).map((i) => ({ i, type: sc('eType', i), lane: sc('eLane', i), x: sc('eX', i), hp: sc('eHP', i), st: sc('eState', i) }));
  const slots = () => [...Array(9).keys()].map((s) => ({ s, type: sc('slotType', s), hp: sc('slotHP', s) }));
  let prev = null;
  const watch = () => {
    const cur = { en: enemies(), sl: slots(), batt: sc('batt'), lids: sc('lids'), wave: sc('wave'), state: sc('state') };
    if (cur.batt > 99) anomaly(`batteries ${cur.batt} > 99`);
    for (const e of cur.en) {
      if (e.type !== EJET && e.lane > 2) anomaly(`enemy ${ENAME[e.type]} on shelf ${e.lane}`);
      if (e.type !== EJET && e.x < BREACH_X && cur.state === 1) anomaly(`enemy ${ENAME[e.type]} alive at x ${e.x}`);
    }
    if (prev) {
      for (const e of cur.en) {
        const p = prev.en.find((q) => q.i === e.i && q.type === e.type && q.lane === e.lane);
        if (!p || e.type === EJET) continue;
        // a walker that crossed an occupied toy's blocking span without stopping
        if ([DINO, CRAWL, MOUSE, KNIGHT].includes(e.type) || (e.type === POGO && (p.st & 0x40))) {
          for (let c = 0; c < 3; c += 1) {
            const s = e.lane * 3 + c;
            if (prev.sl[s].type && cur.sl[s].type && p.x > COLX[c] + 8 && e.x < COLX[c]) anomaly(`${ENAME[e.type]} passed ${TOYNAME[cur.sl[s].type]} at slot ${s} (x ${p.x} -> ${e.x})`);
          }
        }
        if (p.x - e.x > 9 && e.type !== HELI) anomaly(`${ENAME[e.type]} jumped x ${p.x} -> ${e.x}`);
      }
      for (const e of cur.en) if (e.type !== EJET && e.x >= 139 && !prev.en.some((q) => q.i === e.i && q.type === e.type)) { const k = ENAME[e.type]; (stats.spawns[k] ??= [0, 0, 0])[e.lane] += 1; (stats.spawnSeq[cur.wave] ??= []).push(`${k[0]}${k === 'trex' ? 'X' : ''}${e.lane}`); }
      if (cur.state === 1) { stats.playFrames += 1; if (cur.batt >= 95) stats.framesAtCap += 1; } // (95+: at or near the cap)
      if (cur.lids !== prev.lids && cur.state === 1) {
        const lane = [0, 1, 2].find((L) => (cur.lids ^ prev.lids) & (1 << L));
        note(`LID slammed on shelf ${lane}; enemies there before: ${prev.en.filter((e) => e.lane === lane).map((e) => `${ENAME[e.type]}@${e.x}hp${e.hp}`).join(' ')}; toys ${[0, 1, 2].map((c) => TOYNAME[prev.sl[lane * 3 + c].type]).join('/')}`);
      }
      if (cur.state === 2 && prev.state === 1) {
        note(`GAME OVER; enemies: ${prev.en.map((e) => `${ENAME[e.type]}@L${e.lane}x${e.x}hp${e.hp}`).join(' ')}; toys ${prev.sl.map((s) => TOYNAME[s.type][0] ?? '-').join('')} batt ${prev.batt}`);
      }
      if (cur.wave !== prev.wave) {
        note(`wave ${cur.wave} starts; batt ${cur.batt}; toys ${cur.sl.map((s) => TOYNAME[s.type]).join(',')}`);
        stats.waveFrames[prev.wave] = frames - waveStart; waveStart = frames;
        stats.battAtWave[cur.wave] = cur.batt;
      }
      // a lasso thrown this update (its count set to 60: held 60 frames, then
      // 60 frames it can't be roped again): how far ahead of the nearest cowboy
      for (const e of cur.en) {
        const p = prev.en.find((q) => q.i === e.i && q.type === e.type);
        if (!p || e.type === EJET) continue;
        const c = e.st & 0x3f, pc = p.st & 0x3f;
        // held: count 30-59 after the throw; track the longest unbroken hold
        const held = c >= 30;
        if (held) { e.holdSince = p.holdSince ?? frames; stats.longestHold = Math.max(stats.longestHold, frames - e.holdSince + 1); }
        if (c !== 60 || pc === 60) continue;
        stats.lassos += 1;
        if (pc !== 0) { stats.lassoImmuneBroken += 1; anomaly(`${ENAME[e.type]} lassoed again while its count was ${pc}`); }
        const ds = [0, 1, 2].filter((c) => cur.sl[e.lane * 3 + c].type === COWBOY && e.x > COLX[c]).map((c) => e.x - COLX[c]);
        if (!ds.length) { anomaly(`${ENAME[e.type]} lassoed at x ${e.x} with no cowboy behind it`); continue; }
        const d = Math.min(...ds);
        stats.lassoD[d] = (stats.lassoD[d] ?? 0) + 1; stats.lassoMax = Math.max(stats.lassoMax, d);
        if (d > 40) anomaly(`${ENAME[e.type]} lassoed ${d} px ahead of a cowboy`);
      }
      // a launched jet: where it took off, and whether it hit everything on its shelf
      if (jetWatch) {
        const j = cur.en.find((q) => q.type === EJET && (q.lane & 3) === jetWatch.lane);
        if (j && jetWatch.x0 === undefined) { jetWatch.x0 = j.x; stats.jetLaunchX[j.x] = (stats.jetLaunchX[j.x] ?? 0) + 1; }
        if (!j && jetWatch.x0 !== undefined || frames - jetWatch.at > 120) {
          for (const t of jetWatch.targets) {
            const now = cur.en.find((q) => q.i === t.i && q.type === t.type);
            if (now && now.lane === jetWatch.lane && now.x <= t.x && t.hp - now.hp < 10 && !jetWatch.hit.has(t.i)) { stats.jetMissed += 1; anomaly(`jet on shelf ${jetWatch.lane} missed ${ENAME[t.type]} (x ${t.x} hp ${t.hp} -> ${now.hp} x ${now.x})`); } else stats.jetHits += 1;
          }
          jetWatch = null;
        } else for (const t of jetWatch.targets) { const now = cur.en.find((q) => q.i === t.i && q.type === t.type); if (now && t.hp - now.hp >= 10) jetWatch.hit.add(t.i); }
      }
    }
    if (process.env.TRACE && frames >= +process.env.TRACE.split('-')[0] && frames <= +process.env.TRACE.split('-')[1]) console.log('T', frames, sc('batt'), cur.sl.map((q) => q.type + ':' + q.hp).join(' '), '|', cur.en.map((e) => `${ENAME[e.type]}L${e.lane}x${e.x}hp${e.hp}s${e.st.toString(16)}`).join(' '));
    prev = cur;
  };

  // ---- the hands
  const run = (bits = 0, fire = false, swchb = o.diffA ? 0x4b : 0x0b) => {
    m.bus.swcha = 0xff ^ bits; m.bus.inpt4 = fire ? 0 : 0x80; m.bus.swchb = swchb;
    if (PROF_AT.has(frames)) profileFrame(m, frames); else m.runFrame();
    const { total, vb } = m.layout();
    if (total !== 262 || vb[0][0] !== 40) { mistimed += 1; mistimedAll.push(frames); if (mistimedAt.length < 10) mistimedAt.push({ frame: frames, wave: sc('wave'), total, vb: JSON.stringify(vb), en: enemies().map((e) => `${ENAME[e.type]}@L${e.lane}x${e.x}`).join(' '), toys: slots().map((q) => TOYNAME[q.type][0] ?? '-').join(''), shots: [0, 1, 2].map((L) => sc('shotDmg', L)).join(','), splashN: sc('splashN'), cursor: sc('cursor'), stick: m.bus.swcha.toString(16), fire: m.bus.inpt4 === 0, sound: sc('sndPos') }); }
    frames += 1;
    watch();
  };

  // power on, wait (varies the game), press Game Reset
  for (let i = 0; i < 3; i += 1) m.runFrame();
  for (let i = 0; i < seedFrames; i += 1) run();
  mistimed = 0; mistimedAt.length = 0;
  run(0, false, o.diffA ? 0x4a : 0x0a); run();
  frames = 0;
  if (sc('state') !== 1) throw new Error('game did not start');

  const moveTo = (slot) => { // one diagonal-capable step toward a slot (2 frames)
    const cur = sc('cursor');
    let bits = 0;
    if (Math.floor(slot / 3) < Math.floor(cur / 3)) bits |= UP; else if (Math.floor(slot / 3) > Math.floor(cur / 3)) bits |= DOWN;
    if (slot % 3 < cur % 3) bits |= LEFT; else if (slot % 3 > cur % 3) bits |= RIGHT;
    run(bits); run();
  };
  const selectToy = (toy) => { // hold fire, flick left/right, release
    const n = sc('unlock');
    const fwd = (toy - sc('toy') + n) % n;
    const dir = fwd <= n - fwd ? RIGHT : LEFT;
    run(0, true);
    let guard = 0;
    while (sc('toy') !== toy && guard++ < 8) { run(dir, true); run(0, true); }
    run();
  };
  const tap = () => { run(0, true); run(); };

  // ---- the brain
  const unlock = () => sc('unlock');
  const wanted = (col) => { let t = 0; const st = o.lap2 && sc('wave') >= 13 ? STRATEGIES[o.lap2] : strat; for (const [u, toy] of st.cols[col]) if (u <= unlock()) t = toy; return t; };
  const blockerAt = (en, sl) => { // the column that will next stop this enemy (or -1)
    if (en.type === BALLOON) return -1;
    let hopped = en.type !== HELI || (en.st & 0x40);
    for (let c = 2; c >= 0; c -= 1) {
      if (!sl[en.lane * 3 + c].type || COLX[c] > en.x) continue;
      if (!hopped) { hopped = true; continue; }
      return c;
    }
    return -1;
  };

  // the game refuses a toy (not a jet) on a slot where a monster stands: its x
  // is the toy's x to x + 8. margin: pixels it may still walk before the drop
  const PXF = [[0, 0.5, 1, 1, 2, 0.5, 0.5, 1, 0.25], [0, 1, 2, 2, 3, 1, 1, 2, 0.5]]; // pixels per frame, laps 1/2
  const pace = (e) => (e.type === KNIGHT && (e.st & 0x40) ? [2, 3] : PXF.map((r) => r[e.type]))[m.ram(SYM.fast) & 0x80 ? 1 : 0] ?? 1;
  const standing = (en, slot, margin = true) => {
    if (o.legacy) return false;
    const L = Math.floor(slot / 3), x0 = COLX[slot % 3];
    return en.some((e) => e.type !== EJET && !(o.balloonFree && e.type === BALLOON) && e.lane === L && e.x >= x0 && e.x - x0 <= 8 + (margin ? Math.ceil(pace(e) * 12) + 1 : 0));
  };

  let lastLog = 0;
  // a jet in flight on the shelf, or one placed in the last 20 frames (with every
  // enemy slot taken it strikes as a burst over 10 frames, with no jet to see)
  const jetAt = [-999, -999, -999];
  const jetBusy = (L) => frames - jetAt[L] < 20 || enemies().some((q) => q.type === EJET && (q.lane & 3) === L);
  const decide = () => {
    const en = enemies().filter((e) => e.type !== EJET && e.lane <= 2);
    const sl = slots();
    const batt = sc('batt');
    const lids = sc('lids');
    const u = unlock();
    const cands = [];
    const add = (score, slot, op, toy, why) => cands.push({ score, slot, op, toy, why });
    const wi = (sc('wave') - 1) % 12;
    const bossSoon = o.bossPrep && (wi === 4 || wi === 5 || wi === 10 || wi === 11);
    const pressure = [0, 1, 2].map((L) => en.filter((e) => e.lane === L).reduce((a, e) => a + e.hp + (e.type === TREX ? 10 : 0) + (151 - e.x) / 20, 0));

    // emergencies: an enemy with nothing left to stop it
    for (const e of en) {
      const b = blockerAt(e, sl);
      const trexRun = e.type === TREX && e.x < o.trexJetX;
      if (b >= 0 && !trexRun) continue;
      const lidUsed = !!(lids & (1 << e.lane));
      // jet: start it left of the enemy so the nose passes its middle
      const jetFlying = jetBusy(e.lane);
      if (u >= JET && !jetFlying && (e.x <= o.jetX || trexRun) && e.x >= (o.legacy ? 49 : 44) && (lidUsed || e.type === TREX || (o.jetBalloon && e.type === BALLOON) || en.filter((q) => q.lane === e.lane).length < 3)) {
        // (the jet takes off from the toy box end whatever slot it is placed in)
        const col = o.legacy ? [0, 1, 2].find((c) => !sl[e.lane * 3 + c].type && COLX[c] + ((e.st & 0x80) ? 1 : 3) <= e.x) : [0, 1, 2].find((c) => !sl[e.lane * 3 + c].type);
        if (col !== undefined) add(200 + (lidUsed ? 50 : 0), e.lane * 3 + col, 'place', JET, `jet ${ENAME[e.type]}@${e.x}`);
        else if ((lidUsed || e.type === TREX) && batt + (COST[sl[e.lane * 3].type] >> 1) >= COST[JET]) add(190, e.lane * 3, 'pick', 0, 'clear runway for jet');
      }
      // block: a teddy where it will arrive (not for balloons or a T-Rex)
      if (u >= TEDDY && e.type !== BALLOON && e.type !== TREX) {
        for (let c = 2; c >= 0; c -= 1) {
          if (!sl[e.lane * 3 + c].type && COLX[c] <= e.x && !standing(en, e.lane * 3 + c) && (c > 0 || e.x >= 52 || lidUsed)) { add(150 + (lidUsed ? 50 : 0) - (e.x - COLX[c]) / 10, e.lane * 3 + c, 'place', TEDDY, `block ${ENAME[e.type]}@${e.x}`); break; }
        }
      }
      // no teddies yet: an army man in its path still delays it
      if (u < TEDDY) {
        for (let c = 2; c >= 0; c -= 1) {
          if (!sl[e.lane * 3 + c].type && COLX[c] <= e.x && !standing(en, e.lane * 3 + c)) { add(140, e.lane * 3 + c, 'place', ARMY, `block ${ENAME[e.type]}@${e.x}`); break; }
        }
      }
    }
    // a T-Rex: cowboy within lasso reach behind it
    if (o.cowboyTrex && u >= COWBOY) {
      for (const e of en.filter((q) => q.type === TREX)) {
        for (let c = 2; c >= 0; c -= 1) {
          const s = e.lane * 3 + c;
          if (e.x - COLX[c] > (o.legacy ? 24 : 14) && e.x - COLX[c] < 40 && !sl[s].type) { add(120, s, 'place', COWBOY, 'lasso trex'); break; }
        }
      }
    }
    // cover: every shelf needs a shooter before anything else (the opening:
    // an army man by the box on each shelf, where it has the longest shot at
    // whatever comes; later, whenever a shelf's last shooter is eaten)
    if (o.cover) {
      const SHOOTS = new Set([ARMY, TANK, CANNON]);
      for (let L = 0; L < 3; L += 1) {
        if ([0, 1, 2].some((c) => SHOOTS.has(sl[L * 3 + c].type))) continue;
        const front = en.filter((e) => e.lane === L);
        for (let c = 0; c < 3; c += 1) {
          const s = L * 3 + c;
          if (sl[s].type || standing(en, s) || front.some((e) => e.x < COLX[c] + 4)) continue; // (it must have something to shoot at ahead)
          add(170 + (lids & (1 << L) ? 20 : 0) - c * 5, s, 'place', ARMY, `cover shelf ${L}`);
          break;
        }
      }
    }
    // the layout
    for (let L = 0; L < 3; L += 1) {
      for (let c = 0; c < 3; c += 1) {
        const s = L * 3 + c, want = wanted(c);
        if (!want) continue;
        const front = en.filter((e) => e.lane === L);
        // don't place a shooter where an enemy is already left of it (it can't shoot back)
        const passed = front.some((e) => e.x < COLX[c] + 4);
        if (!sl[s].type) {
          if (passed && want !== TEDDY) continue;
          if (standing(en, s)) continue; // (refused while a monster stands there)
          // a T-Rex crushes whatever is put in front of it
          if (front.some((e) => e.type === TREX && e.x >= COLX[c] - 2 && e.x <= COLX[c] + o.trexGap)) continue;
          const colW = c === 2 ? 30 : c === 1 ? 26 : 22;
          add(colW + pressure[L] * 2 + (want === TEDDY ? 10 : 0), s, 'place', want, `layout ${TOYNAME[want]}`);
        } else if (sl[s].type === TEDDY && want === TEDDY && sl[s].hp < o.repairAt && batt >= 6 && !standing(en, s)) {
          // (only between chewers: with one on it the fresh teddy would be refused)
          add(60 + pressure[L], s, 'pick', 0, 'repair teddy');
        } else if (o.salvage && sl[s].type !== JET && sl[s].hp <= 1 && standing(en, s, false)) {
          // about to be eaten anyway, and can't be put back: take half its cost
          add(65, s, 'pick', 0, `salvage ${TOYNAME[sl[s].type]}`);
        } else if (o.repairShooters && sl[s].type !== TEDDY && sl[s].type !== JET && sl[s].hp <= o.shooterRepairAt && batt >= COST[sl[s].type] - (COST[sl[s].type] >> 1) + 1
          && front.some((e) => e.x >= COLX[c] && e.x <= COLX[c] + 8 && e.type !== TREX)) {
          add(70 + pressure[L], s, 'pick', 0, `repair ${TOYNAME[sl[s].type]}`);
        } else if (o.upgrade && !bossSoon && sl[s].type !== want && sl[s].type !== JET && (want !== TEDDY || c < 2)) {
          const quiet = !front.some((e) => e.x < 140);
          if (quiet && batt + (COST[sl[s].type] >> 1) >= COST[want] + (u >= JET && o.jetReserve ? COST[JET] : 0)) add(10, s, 'pick', 0, `upgrade to ${TOYNAME[want]}`);
        }
      }
    }
    // monsters through the front column (chewing the shooters behind it): a
    // jet clears them while they bunch (jetChew: their health, 10 each at most)
    if (o.jetChew && u >= JET && batt >= COST[JET]) {
      for (let L = 0; L < 3; L += 1) {
        if (jetBusy(L)) continue;
        const hp = en.filter((e) => e.lane === L && e.x < COLX[2] && e.x >= 44).reduce((a2, e) => a2 + Math.min(10, e.hp), 0);
        if (hp < o.jetChew) continue;
        const col = [0, 1, 2].find((c) => !sl[L * 3 + c].type);
        if (col !== undefined) add(185, L * 3 + col, 'place', JET, `jet pack ${hp}`);
      }
    }
    // batteries near the cap: spend a jet on the most crowded shelf
    if (u >= JET && o.overflow && batt >= o.overflow) {
      let best = -1, bestHp = 0;
      for (let L = 0; L < 3; L += 1) {
        if (jetBusy(L)) continue;
        const hp = en.filter((e) => e.lane === L && e.x >= 84).reduce((a, e) => a + Math.min(10, e.hp), 0);
        if (hp > bestHp) { bestHp = hp; best = L; }
      }
      if (best >= 0 && bestHp >= o.overflowHp) {
        const s1 = best * 3 + 1, s0 = best * 3;
        if (!sl[s0].type) add(80, s0, 'place', JET, 'overflow jet');
        else if (!sl[s1].type) add(80, s1, 'place', JET, 'overflow jet');
        else if (!o.legacy && !sl[s1 + 1].type) add(80, s1 + 1, 'place', JET, 'overflow jet');
        else if (sl[s1].type !== TEDDY) add(80, s1, 'pick', 0, 'clear runway for jet');
      }
    }
    cands.sort((a, b) => b.score - a.score);
    // the best one; if it's a placement we can't afford, wait for it (unless
    // something cheaper is also urgent), keeping the jet reserve in mind
    const doomed = (slot) => en.some((e) => e.type === TREX && e.lane === Math.floor(slot / 3) && e.x >= COLX[slot % 3] - 2 && e.x <= COLX[slot % 3] + o.trexGap);
    for (const c of cands) {
      if (c.op === 'pick') return c;
      if (c.toy !== JET && doomed(c.slot)) continue;
      const reserve = (u >= JET && o.jetReserve && c.toy !== JET && c.score < 150 && !(c.toy === TEDDY && c.score >= 40)) ? COST[JET] : 0;
      if (batt >= COST[c.toy] + reserve) return c;
      if (c.score >= 100) continue; // emergencies: try the next affordable one
      if (reserve && batt >= COST[c.toy]) continue;
      return { ...c, wait: true };
    }
    return null;
  };

  let pickedFor = null; // after a repair pick-up, put a teddy straight back
  while (sc('state') === 1 && frames < maxFrames) {
    let act = decide();
    if (pickedFor !== null) {
      if (!sc('slotType', pickedFor.slot) && sc('batt') >= COST[pickedFor.toy] && frames - pickedFor.at < 90) act = { slot: pickedFor.slot, op: 'place', toy: pickedFor.toy, why: 'replace' };
      else pickedFor = null;
    }
    if (!act || act.wait) { if (act && act.slot !== sc('cursor')) moveTo(act.slot); else run(); continue; }
    if (sc('cursor') !== act.slot) { moveTo(act.slot); continue; }
    if (act.op === 'place') {
      if (sc('toy') !== act.toy) { selectToy(act.toy); continue; }
      if (sc('slotType', act.slot) || sc('batt') < COST[act.toy]) { run(); continue; }
      if (act.toy !== JET && standing(enemies(), act.slot, false)) { run(); continue; } // (it would be refused)
      if (log) console.log(`f${frames} place ${TOYNAME[act.toy]} at ${act.slot} (${act.why})`);
      const standRaw = () => { const L = Math.floor(act.slot / 3), x0 = COLX[act.slot % 3]; return enemies().some((e) => e.type !== EJET && e.type !== BALLOON && e.lane === L && e.x >= x0 && e.x - x0 <= 8); };
      const before = standRaw(), b0 = sc('batt');
      const full = enemies().length === 5;
      const balloonUnder = (() => { const L = Math.floor(act.slot / 3), x0 = COLX[act.slot % 3]; return enemies().some((e) => e.type === BALLOON && e.lane === L && e.x >= x0 && e.x - x0 <= 8); })();
      if (act.toy === JET) jetWatch = { lane: Math.floor(act.slot / 3), at: frames, targets: enemies().filter((e) => e.type !== EJET && e.lane === Math.floor(act.slot / 3) && e.x >= 41), hit: new Set() };
      run(0, true);
      const during = standRaw();
      run();
      if (sc('batt') < b0) stats.spent[TOYNAME[act.toy]] = (stats.spent[TOYNAME[act.toy]] ?? 0) + COST[act.toy];
      if (act.toy === JET) { if (sc('batt') < b0) jetAt[Math.floor(act.slot / 3)] = frames; jetFrames.push(frames); if (full && sc('batt') < b0) { stats.jetBursts += 1; note(`jet burst on shelf ${Math.floor(act.slot / 3)}`); } }
      else {
        if (balloonUnder && sc('slotType', act.slot) === act.toy) stats.balloonDrops += 1;
        const placed = sc('slotType', act.slot) === act.toy;
        if (!placed && sc('state') === 1) { stats.refused += 1; if (!before && !during && b0 >= COST[act.toy]) { stats.refusedAnom += 1; anomaly(`${TOYNAME[act.toy]} refused at slot ${act.slot} with no monster standing there`); } }
        if (placed && before && during) { stats.placedOnMonster += 1; anomaly(`${TOYNAME[act.toy]} placed at slot ${act.slot} on a standing monster`); }
        if (!placed && pickedFor) { /* the replacement after a repair was refused */ }
      }
      pickedFor = null;
    } else {
      const t = sc('slotType', act.slot);
      if (!t) { run(); continue; }
      const pre = act.why.startsWith('repair ') && !act.why.startsWith('salvage') ? t : act.why === 'clear runway for jet' ? JET : 0;
      if (pre && sc('toy') !== pre) { selectToy(pre); continue; }
      if (log) console.log(`f${frames} pick ${TOYNAME[t]} at ${act.slot} (${act.why})`);
      const bp = sc('batt'); tap(); stats.refund = (stats.refund ?? 0) + Math.max(0, sc('batt') - bp);
      if (act.why.startsWith('repair ')) pickedFor = { slot: act.slot, toy: t, at: frames };
      if (act.why === 'clear runway for jet') pickedFor = { slot: act.slot, toy: JET, at: frames };
    }
  }
  const score = Number([0, 1, 2].map((i) => sc('score', i).toString(16).padStart(2, '0')).join(''));
  const final = { enemies: enemies().map((e) => `${ENAME[e.type]}@L${e.lane}x${e.x}hp${e.hp}st${e.st.toString(16)}`), slots: slots().map((q) => `${TOYNAME[q.type]}${q.type ? q.hp : ''}`), spawnLeft: sc('spawnLeft'), spawnTimer: sc('spawnTimer'), packLeft: sc('packLeft'), bossLeft: sc('bossLeft'), batt: sc('batt') };
  return { strategy, seedFrames, final, wave: sc('wave'), seconds: Math.round(frames / 60), frames, score, over: sc('state') === 2, lids: sc('lids'), mistimed, mistimedAt, mistimedAll: mistimedAll.slice(0, 200), jetFrames, stats: { ...stats, longestWave: Math.max(0, ...Object.values(stats.waveFrames), frames - waveStart) }, scViolations: m.bus.scViolations, anomalies, events: events.filter((e) => /LID|GAME OVER|burst/.test(e)) };
}

if (process.argv[1]?.endsWith('player.mjs')) {
  const n = Number(process.argv[2] ?? 4);
  const strategy = process.argv[3] ?? 'cannon';
  const base = Number(process.argv[4] ?? 0);
  const maxFrames = Number(process.argv[5] ?? 216000);
  const opts = process.env.OPTS ? JSON.parse(process.env.OPTS) : {};
  for (let g = 0; g < n; g += 1) {
    const r = playGame({ seedFrames: base + g * 37, strategy, maxFrames, opts, log: !!process.env.LOG });
    console.log(JSON.stringify(r));
  }
}
