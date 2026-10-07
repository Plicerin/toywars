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
//  - trexSalvage (default on): picks up a shooter a T-Rex is about to crush (half its cost back);
//    bossSave (batteries kept for jets while a lap-2 T-Rex is due), lap2At (wave the lap-2 layout starts)
//  - checks the jet (hits per update from its hit mask, a monster hit twice, kills per frame on its
//    shelf, monsters it passed without hitting), mouse packs (followers = 2 x packs per wave, none
//    left at a wave's end) and the spawn bag (every aligned six spawns: each shelf twice; kind x shelf)
//  - checks a few rules while it watches (logged as "anomalies"; result.stats:
//    refused drops, jet take-off x, jet bursts,
//    batteries spent per toy and refunded, spawns per shelf, frames per wave)
//  - result.stats.killSkips: even frames with a kill (KILLED), on which the spawner waits (each delays spawning 2 frames)
//  - the per-frame cap at the toy box: stats.boxHeld (frames an enemy one step from the box sat out its
//    update because of a kill that frame), boxWaits/boxWaitMax/boxSaved (its extra frames there, and
//    whether it then died instead of breaching); stats.jetPassedDied: monsters the jet had passed that
//    something else killed before the jet's hit landed (not counted as skipped)
//  - runway (off: on baf0363 heavy B +0.3 waves, heavy A -0.6, cannon B 0, paired seeds): with no free
//    slot for a jet, pick up the cheapest toy nothing stands on (balloonRunway: only for balloons)
//  - result.stats.jack: jack-in-the-box springs (placed, sprung, by: the kind that sprang it), every
//    sweep check (hits, kills, thrown, capped at x 151, landedOn: a toy whose slot a thrown monster
//    landed in, missOut/missD: monsters on the shelf out of reach and their distance, escaped: in
//    reach at the spring but not at its check), bites (taken while another burst was busy) and
//    eaten (gone without springing), cut (its sweep replaced by a jet's full-slots burst)
//  - jackTrap knobs: jackBunch (walkers within jackSpan pixels of the lead, default 2 within 10),
//    jackTrex (a T-Rex on the shelf, default on). On a328fe5 every jack the cannon player placed came
//    from the T-Rex rule (jackBunch 99: identical games; jackTrex false: identical to no jacks)
//  - result.stats.cyc: overscan logic (CallLogic -> osWait) and VBLANK (SelectEnemies -> vbWait) cycles per
//    frame (max, where, histograms; logicOver: frames over ~2216); result.stats.overflow: batteries over
//    the cap turned into points (GainBatt entered with A > 99: points, calls, per wave); result.stats.display:
//    longest runs of frames the status line's score / batteries differ from the real ones;
//    stats.jack.offMid: the springer's x (the reach's centre, splashX) minus the jack's middle
//  - jackSwap is on for every strategy now (3527460, heavy, 16 games each: B seeds 0 mean 25.3 -> 28.6, median 24 -> 28,
//    seeds 1000 24.8 -> 26.8; A 19.8 -> 20.4; T-Rex lids at wave 24 8 -> 1): a jack in front of a lap-2 T-Rex kills it
//  - jackSwapTrex: swap the front teddy for a jack only for a T-Rex (on 3527460 heavy: identical to jackSwap)
//  - DBGCYC=frame prints the measured cycles for frames around it
//  - result.stats.placeHolds (placeHoldsW per wave): even frames the spawner sat out only because of a
//    placement (f385c4b: no kill or lid that frame; each slips the spawn schedule 2 frames). Heavy B: ~56 a
//    game, ~110 frames of ~64,600; paired with the hold patched out (48 games) final waves -0.5, i.e. noise
//  - stats.jetLastHit: monsters the jet hit on its last update (it leaves the same frame, so no mask to
//    read; counted by the health drop). They used to be reported as "jet passed ... without hitting it"
//  - f385c4b, 64 heavy B games: OPTS jetBalloon (identical games), bossSave 30/45 (26.8/26.5 vs 27.0),
//    salvage false (25.9), runway (26.6; balloon lids 20 -> 7 but T-Rex lids 2 -> 11): none kept
//  - LOGIC_ASM=path: the logic.asm matching ROM/SYM (the profiler's labels), for pinned builds
//  - probes (not play): probeCut (a jet placed during a jack's sweep with every enemy slot taken),
//    probeLand (a jack in the middle slot and a teddy behind a T-Rex: the throw lands on the teddy)
//  - 2dfa633 fix: a jet chosen for a full slot (jets take off from any slot) used to stall the player
//    (the place step waited for the slot to empty, doing nothing else) until the target passed; the
//    stall kept batteries for wave 24. Fixed, 24 games each (B): heavy mean 26.3 -> 25.4, tank 26.0 ->
//    25.0, cannon 21.5 -> 21.3, army 17.5 -> 17.5; A heavy 20.5 -> 20.9. OPTS {"overflow":0} (no
//    overflow jets), paired: heavy B 16 games 25.4 -> 26.3, tank B 8 games 24.5 -> 24.0 (not kept)
//  - stats.hurt (3f75347 hurt colors): per kind lives, hurt/badly hurt lives and frames, steadyF (badly
//    hurt frames whose last 16 frames showed 3+ draws all in one color: the flicker hidden; since the
//    flicker runs 4 frames of every 8, the turn-taking parity no longer hides it), steadyPlainF (shown in its full-health color), steadyFullF (steadyF
//    with a full 16-frame window: not just the first frames after turning badly hurt), halfBad, capped; stats.hurtOneColor:
//    badly hurt lives drawn 8+ times all in one color (kind, draws, frames from-to);
//    stats.hurtMarkBad: frames whose marks disagree with health vs the kept half
//  - 3f08647 (10 games each, seeds 0..333): B heavy median 24 (8 of 10 end in wave 24), tank 24, cannon 22, army 17;
//    A heavy 21, cannon 20.5. OPTS {"bossSave":60} on heavy B: 24.5 vs 24.6 mean (T-Rex lids 7 -> 4, mouse lids up; not kept)
//  - HURTDBG=a-b prints, per frame, every enemy slot and which were drawn (the hurt-color flicker)
// usage: node tools/player.mjs [games] [strategy: heavy (best; on 3f08647 B median 24), tank, cannon, cannon0, army, wall, wallArmy, jackFront, jackMid] [seedBase] [maxFrames]
//   env: OPTS='{"repairAt":20}' (strategy knobs), ROM=path SYM=path (another build), LOG=1 (actions), TRACE=a-b (board, shots and splash per frame), PROF_AT=f,f (logic cycle profile)
import { readFileSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';

const SYM = Object.fromEntries(readFileSync(process.env.SYM ?? 'tools/build/toywars.sym', 'latin1').split(/\r?\n/).map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const ROM = readFileSync(process.env.ROM ?? 'toywars.bin'); // (ROM=path: a variant cartridge, same symbols)

const ARMY = 1, TEDDY = 2, TANK = 3, JACK = 4, CANNON = 5, JET = 6;
const COST = [0, 10, 5, 25, 15, 20, 30];
const TOYHP = [0, 8, 40, 12, 8, 10, 1];
const TOYNAME = ['-', 'army', 'teddy', 'tank', 'jack', 'cannon', 'jet'];
const DINO = 1, HELI = 2, CRAWL = 3, MOUSE = 4, KNIGHT = 5, BALLOON = 6, POGO = 7, TREX = 8, EJET = 9;
const ENAME = ['-', 'dino', 'heli', 'crawler', 'mouse', 'knight', 'balloon', 'pogo', 'trex', 'jet'];
const COLX = [48, 80, 112];
const EN_MASK = [[0, 1, 0, 0, 0, 1, 1, 0, 3], [0, 0, 0, 0, 0, 0, 1, 0, 1]]; // logic.asm EnMask/EnStep (laps 1/2; knights charging: rows 2/3)
const EN_STEP = [[0, 1, 1, 1, 2, 1, 1, 1, 1], [0, 1, 2, 2, 3, 1, 1, 2, 1], [0, 1, 1, 1, 1, 2, 1, 1, 1], [0, 1, 1, 1, 1, 3, 1, 1, 1]];
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
  // two cannons behind a teddy (used for the second lap: OPTS lap2)
  cannon2: { cols: [[[1, ARMY], [5, CANNON]], [[1, ARMY], [5, CANNON]], [[2, TEDDY]]] },
  wallArmy: { cols: [[[1, ARMY]], [[1, ARMY], [2, TEDDY]], [[2, TEDDY]]] },
  // jack stress layouts (playtest probes, not contenders): a jack kept in the front slot (rebuilt
  // after every spring) in place of the teddy, or in the middle behind a front teddy
  jackFront: { cols: [[[1, ARMY], [3, TANK]], [[1, ARMY], [5, CANNON]], [[2, TEDDY], [5, JACK]]] },
  jackMid: { cols: [[[1, ARMY], [3, TANK]], [[1, ARMY], [5, JACK]], [[2, TEDDY]]] },
};

// debugging: PROF_AT=frame,frame,... prints where the overscan logic spends its cycles on those frames
const PROF_AT = new Set((process.env.PROF_AT ?? '').split(',').filter(Boolean).map(Number));
const labelSet = (file) => new Set([...readFileSync(file, 'latin1').matchAll(/^([A-Za-z]\w*):?/gm)].map((x) => x[1]));
const LOGIC = labelSet(process.env.LOGIC_ASM ?? 'logic.asm'); // (LOGIC_ASM=path: the source matching ROM/SYM, for the profiler's labels)
const LISTS = [false, true].map((logic) => Object.entries(SYM).filter(([n]) => LOGIC.has(n) === logic && /^[A-Za-z]\w*$/.test(n) && !/^[WR]_/.test(n)).sort((a, b) => a[1] - b[1]));
function profileFrame(m, at) {
  const labelOf = (pc, bank) => { let best = '?'; for (const [n, a] of LISTS[bank === 2 ? 1 : 0]) { if (a <= pc) best = n; else break; } return best; };
  const CALL = SYM.CallLogic, WAIT = SYM['0.osWait'];
  const f = m.bus.frame, prof = new Map();
  let start = -1, spent = 0, vs = -1, vb = 0; const vprof = new Map();
  while (m.bus.frame === f) {
    const pc = m.cpu.pc;
    if (pc === CALL && m.bus.bank === 0 && start < 0) start = m.cpu.cycles;
    if (pc === WAIT && m.bus.bank === 0 && start >= 0 && !spent) spent = m.cpu.cycles - start; // (bank 0: logic in bank 2 can pass the same address)
    if (pc === SYM.SelectEnemies && m.bus.bank === 0 && vs < 0) vs = m.cpu.cycles;
    if (pc === SYM['0.vbWait'] && m.bus.bank === 0 && vs >= 0 && !vb) vb = m.cpu.cycles - vs;
    const c0 = m.cpu.cycles, bank = m.bus.bank; m.cpu.step();
    if (start >= 0 && !spent) { const l = labelOf(pc, bank); prof.set(l, (prof.get(l) ?? 0) + m.cpu.cycles - c0); }
    if (vs >= 0 && !vb) { const l = `${labelOf(pc, bank)}@b${bank}`; vprof.set(l, (vprof.get(l) ?? 0) + m.cpu.cycles - c0); }
  }
  console.log(`PROF frame ${at}: logic ${spent} cycles (budget ~${35 * 64}):`, [...prof].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, v]) => `${n} ${v}`).join(', '));
  console.log(`PROF frame ${at}: VBLANK ${vb} cycles (of ~${44 * 64}; labels approximate outside bank 2):`, [...vprof].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, v]) => `${n} ${v}`).join(', '));
}

export function playGame({ seedFrames = 0, strategy = 'cannon', maxFrames = 216000, opts = {}, log = false } = {}) {
  // legacy: the old player (repairs by picking up a chewed toy and dropping a
  // fresh one on the monster; the game now refuses that drop)
  const o = { jetChew: 6, lap2: strategy === 'cannon' ? 'cannon2' : null, jetReserve: false, repairAt: 24, upgrade: true, jetX: 90, trexJetX: 110, jackTrap: true, jackSwap: true, bossPrep: true, trexGap: 40, overflow: 90, overflowHp: 12, repairShooters: false, shooterRepairAt: 2, legacy: false, salvage: true, cover: true, balloonFree: true, bossSave: 0, bossSaveLap1: false, trexSalvage: true, lap2At: 13, balloonRunway: false, runway: false, ...opts };
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
  const stats = { refused: 0, refusedAnom: 0, placedOnMonster: 0, jetLaunchX: {}, jetMissed: 0, jetHits: 0, lassoD: {}, lassoMax: 0, lassos: 0, lassoImmuneBroken: 0, longestHold: 0, jetBursts: 0, balloonDrops: 0, spent: {}, spawns: {}, spawnSeq: {}, waveFrames: {}, longestWave: 0, battAtWave: {}, framesAtCap: 0, playFrames: 0, jetHitsPerUpdate: {}, jetDouble: 0, jetKillsPerFrame: {}, packLeaders: {}, packFollowers: {}, packSpill: 0, bagLanes: [0, 0, 0], bagBlocksBad: 0, kindLane: {}, battMin: {}, battMax: {}, killSkips: 0, killSkipsW: {} };
  stats.boxWaits = {}; stats.boxWaitMax = 0; stats.boxSaved = 0; const boxZone = new Map();
  const bagSeq = [];
  const birth = [0, 0, 0, 0, 0]; const jetLog = new Map(); stats.jetSkipped = 0;
  let jetWatch = null; let waveStart = 0;
  const note = (s) => { events.push(`f${frames} w${sc('wave')} ${s}`); if (log) console.log(`f${frames} w${sc('wave')} ${s}`); };
  const anomaly = (s) => { if (anomalies.length < 40) anomalies.push(`f${frames} w${sc('wave')} ${s}`); if (log) console.log('ANOMALY', s); };

  // ---- watching (read only)
  const enemies = () => [0, 1, 2, 3, 4].filter((i) => sc('eType', i)).map((i) => ({ i, type: sc('eType', i), lane: sc('eLane', i), x: sc('eX', i), hp: sc('eHP', i), st: sc('eState', i) }));
  const slots = () => [...Array(9).keys()].map((s) => ({ s, type: sc('slotType', s), hp: sc('slotHP', s) }));
  let prev = null;
  // ---- the jack-in-the-box (read only): springs (by what), every sweep check (hit, killed,
  // thrown, where it landed, out of reach), bites taken while another burst was busy, jacks
  // eaten, a jack's sweep cut short by a jet's full-slots burst
  const jk = { placed: 0, sprung: 0, by: {}, hits: 0, kills: 0, thrown: 0, capped: 0, dmg: 0, missOut: 0, missD: {}, escaped: {}, landedOn: {}, landedRight: 0, bites: 0, eaten: 0, eatenBy: {}, cut: 0, cutLeft: 0, picked: 0, perSpring: {}, killsBy: {}, thrownBy: {}, thrownInto: 0, chewBusyBy: {}, offMid: {} };
  stats.jack = jk;
  let pickSlot = -1; let curJack = null;
  const jackWatch = (cur, checked) => {
    if (cur.state !== 1 || prev.state !== 1) { curJack = null; return; }
    // a jack's sweep replaced by a jet's burst (all enemy slots taken)
    if (prev.splash >> 4 === 7 && cur.splash >> 4 === 0xF) { jk.cut += 1; jk.cutLeft += prev.splash & 15; anomaly(`jack sweep on shelf ${curJack?.lane} cut by a jet burst with ${prev.splash & 15} slots unchecked`); if (curJack) jk.perSpring[curJack.hit] = (jk.perSpring[curJack.hit] ?? 0) + 1; curJack = null; }
    for (let s = 0; s < 9; s += 1) {
      if (prev.sl[s].type !== JACK) continue;
      if (cur.sl[s].type === JACK) { if (cur.sl[s].hp < prev.sl[s].hp) { jk.bites += prev.sl[s].hp - cur.sl[s].hp; const k = prev.splash >> 4 === 7 ? 'jack' : prev.splash >> 4 === 0xF ? 'jet' : prev.splash ? 'cannon' : 'none?'; jk.chewBusyBy[k] = (jk.chewBusyBy[k] ?? 0) + 1; if (k === 'none?') anomaly(`jack at slot ${s} chewed with no burst going`); } continue; }
      if (s === pickSlot) { jk.picked += 1; continue; }
      const L = Math.floor(s / 3), c = s % 3, mid = COLX[c] + 4;
      const sprang = cur.splash >> 4 === 7 && prev.splash >> 4 !== 7;
      const inSpan = prev.en.concat(cur.en).filter((e) => e.type !== EJET && e.type !== BALLOON && e.lane === L && e.x >= COLX[c] && e.x <= COLX[c] + 8);
      if (sprang) {
        jk.sprung += 1;
        const trig = inSpan.sort((a, b) => Math.abs(a.x - mid) - Math.abs(b.x - mid))[0];
        const by = trig ? ENAME[trig.type] : '?';
        jk.by[by] = (jk.by[by] ?? 0) + 1;
        const cx = sc('splashX'); // (cff0042: the reach is centred on the enemy that sprang it, splashX)
        curJack = { lane: L, col: c, mid: cx, at: frames, by, cands: cur.en.filter((e) => e.type !== EJET && e.lane === L && Math.abs(e.x - cx) <= 8).map((e) => ({ i: e.i, type: e.type })), hit: 0 };
        jk.offMid[cx - mid] = (jk.offMid[cx - mid] ?? 0) + 1;
        note(`jack sprung at slot ${s} by ${by}; in reach ${curJack.cands.map((e) => ENAME[e.type]).join(',')}`);
      } else { jk.eaten += 1; const by = inSpan[0] ? ENAME[inSpan[0].type] : '?'; jk.eatenBy[by] = (jk.eatenBy[by] ?? 0) + 1; note(`jack at slot ${s} eaten by ${by} (burst ${prev.splash.toString(16)})`); }
    }
    if (checked >= 0 && curJack && cur.splash !== prev.splash) {
      const pe = prev.en.find((q) => q.i === checked && q.type !== EJET && q.lane === curJack.lane), ce = cur.en.find((q) => q.i === checked);
      if (pe) {
        if (!ce || ce.type !== pe.type) { jk.kills += 1; jk.hits += 1; jk.dmg += pe.hp; curJack.hit += 1; jk.killsBy[ENAME[pe.type]] = (jk.killsBy[ENAME[pe.type]] ?? 0) + 1; }
        else if (ce.hp <= pe.hp - 10) {
          jk.hits += 1; jk.dmg += pe.hp - ce.hp; curJack.hit += 1;
          if (ce.x > pe.x || pe.x >= 151) {
            jk.thrown += 1; jk.thrownBy[ENAME[pe.type]] = (jk.thrownBy[ENAME[pe.type]] ?? 0) + 1;
            if (ce.x === 151) jk.capped += 1;
            for (let c2 = 0; c2 < 3; c2 += 1) {
              const t = cur.sl[curJack.lane * 3 + c2].type;
              if (t && ce.x >= COLX[c2] && ce.x <= COLX[c2] + 8) { const k = TOYNAME[t] + '@c' + c2; jk.landedOn[k] = (jk.landedOn[k] ?? 0) + 1; note(`thrown ${ENAME[ce.type]} landed on ${k} (x ${pe.x} -> ${ce.x})`); }
            }
            // a jet in flight on the shelf: the thrown monster lands ahead of its nose (hit again?)
            if (cur.en.some((q) => q.type === EJET && (q.lane & 3) === curJack.lane)) { jk.thrownInto += 1; note(`thrown ${ENAME[ce.type]} on shelf ${curJack.lane} with a jet in flight`); }
          } else anomaly(`jack hit ${ENAME[ce.type]} slot ${checked} but didn't throw it (x ${pe.x} -> ${ce.x})`);
        } else {
          jk.missOut += 1; const d = Math.abs(ce.x - curJack.mid); jk.missD[d] = (jk.missD[d] ?? 0) + 1;
          if (curJack.cands.some((q) => q.i === checked && q.type === ce.type)) { jk.escaped[ENAME[ce.type]] = (jk.escaped[ENAME[ce.type]] ?? 0) + 1; note(`${ENAME[ce.type]} escaped the jack: in reach at the spring, ${d} px off at its check`); }
          if (d <= 8) anomaly(`jack missed ${ENAME[ce.type]} ${d} px from its middle`);
        }
      }
      if (cur.splash === 0) { jk.perSpring[curJack.hit] = (jk.perSpring[curJack.hit] ?? 0) + 1; curJack = null; }
    }
  };
  const watch = () => {
    const cur = { en: enemies(), sl: slots(), batt: sc('batt'), lids: sc('lids'), wave: sc('wave'), state: sc('state'), spawnLeft: sc('spawnLeft'), packLeft: sc('packLeft'), splash: sc('splashN') };
    const jetsNow = [0, 1, 2, 3, 4].filter((i) => sc('eType', i) === EJET).map((i) => ({ i, lane: sc('eLane', i) & 3, mask: sc('eHP', i) }));
    if (cur.batt > 99) anomaly(`batteries ${cur.batt} > 99`);
    for (const e of cur.en) {
      if (e.type !== EJET && e.lane > 2) anomaly(`enemy ${ENAME[e.type]} on shelf ${e.lane}`);
      if (e.type !== EJET && e.x < BREACH_X && cur.state === 1) anomaly(`enemy ${ENAME[e.type]} alive at x ${e.x}`);
    }
    // a jack's throw this frame: the slot its sweep checked (the low nibble of splashN once
    // a jack's burst, $7x, is going; $71 -> 0 checks slot 0) moved right
    let thrownI = -1;
    if (prev) {
      const pj = prev.splash >> 4 === 7, cj = cur.splash >> 4 === 7;
      const checked = cj && (cur.splash & 15) < 5 ? cur.splash & 15 : pj && cur.splash === 0 ? 0 : -1;
      if (checked >= 0 && (cur.splash !== prev.splash)) {
        const pe = prev.en.find((q) => q.i === checked), ce = cur.en.find((q) => q.i === checked);
        if (pe && ce && pe.type === ce.type && pe.lane === ce.lane && ce.x > pe.x) thrownI = checked;
      }
      jackWatch(cur, checked);
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
      for (const e of cur.en) if (e.type !== EJET && e.x >= 139 && e.i !== thrownI && !prev.en.some((q) => q.i === e.i && q.type === e.type && e.x - q.x <= 9)) { const k = ENAME[e.type]; (stats.spawns[k] ??= [0, 0, 0])[e.lane] += 1; (stats.spawnSeq[cur.wave] ??= []).push(`${k[0]}${k === 'trex' ? 'X' : ''}${e.lane}`); }
      // births: a slot newly holding a monster
      const prevBirth = [...birth];
      for (const e of cur.en) { const p = prev.en.find((q) => q.i === e.i); if (!p || p.type !== e.type || (e.x - p.x > 9 && e.i !== thrownI)) birth[e.i] = frames; }
      for (const j of jetsNow) {
        const k = j.i + ':' + j.lane; const g = jetLog.get(k) ?? { hit: new Set(), passed: new Map() }; jetLog.set(k, g);
        const pj = prev.jets?.find((q) => q.i === j.i); const nb = j.mask & ~(pj ? pj.mask : 0) & 31;
        for (let b = 0; b < 5; b += 1) if (nb & (1 << b)) g.hit.add(b + ':' + prevBirth[b]);
        const jx = sc('eX', j.i);
        for (const e of cur.en) if (e.type !== EJET && e.lane === j.lane && e.x + 4 < jx + 8) { const id = e.i + ':' + birth[e.i]; if (!g.passed.has(id)) g.passed.set(id, `${ENAME[e.type]}@${e.x} (jet ${jx})`); }
      }
      for (const [k, g] of jetLog) {
        // a monster the jet had passed that died before the jet hit it (a shell, a cannonball,
        // a lid slam) wasn't skipped: drop it
        for (const id of [...g.passed.keys()]) if (!g.hit.has(id) && !cur.en.some((e) => e.type !== EJET && e.i + ':' + birth[e.i] === id)) { g.passed.delete(id); stats.jetPassedDied = (stats.jetPassedDied ?? 0) + 1; }
        if (jetsNow.some((j) => j.i + ':' + j.lane === k)) continue;
        // (the jet's last update can hit a monster as the jet leaves: no mask left to read, but the health fell)
        for (const id of [...g.passed.keys()]) { const e = cur.en.find((q) => q.type !== EJET && q.i + ':' + birth[q.i] === id), p = e && prev.en.find((q) => q.i === e.i && q.type === e.type); if (p && e.hp < p.hp) { g.hit.add(id); stats.jetLastHit = (stats.jetLastHit ?? 0) + 1; } }
        for (const [id, what] of g.passed) if (!g.hit.has(id)) { stats.jetSkipped += 1; anomaly(`jet passed ${what} without hitting it (slot ${id})`); }
        jetLog.delete(k);
      }
      // the jet: hits per update (new bits in its mask), a monster hit twice, kills on its shelf per frame
      for (const j of jetsNow) {
        const pj = prev.jets?.find((q) => q.i === j.i);
        const pm = pj ? pj.mask : 0;
        const nb = j.mask & ~pm & 31; const n = [0, 1, 2, 3, 4].filter((b) => nb & (1 << b)).length;
        if (n) stats.jetHitsPerUpdate[n] = (stats.jetHitsPerUpdate[n] ?? 0) + 1;
        if (n > 2) anomaly(`jet hit ${n} monsters in one update`);
        for (const e of prev.en) {
          if (e.type === EJET || e.lane !== j.lane || !(pm & (1 << e.i))) continue;
          const now = cur.en.find((q) => q.i === e.i && q.type === e.type);
          if (now && e.hp - now.hp >= 10) { stats.jetDouble += 1; anomaly(`jet hit ${ENAME[e.type]} slot ${e.i} twice`); }
        }
        const killed = prev.en.filter((e) => e.type !== EJET && e.lane === j.lane && (nb & (1 << e.i)) && !cur.en.some((q) => q.i === e.i && q.type === e.type)).length; // (killed by the jet: its bit new in the mask; a shell or a lid slam the same frame doesn't count)
        if (killed) stats.jetKillsPerFrame[killed] = (stats.jetKillsPerFrame[killed] ?? 0) + 1;
        if (killed > 2) anomaly(`${killed} monsters died in one frame under a jet`);
      }
      // spawns: a leader (spawnLeft down) goes through the shelf bag; a follower (packLeft down) is the rest of a pack
      if (cur.state === 1 && prev.state === 1) {
        const fresh = cur.en.filter((e) => e.type !== EJET && !prev.en.some((q) => q.i === e.i && q.type === e.type && e.x - q.x <= 9)); // (a slot emptied and refilled in one frame, e.g. a lid slam and a spawn, is fresh too)
        if (cur.spawnLeft === prev.spawnLeft - 1 && cur.wave === prev.wave) {
          const e = fresh.find((q) => q.x >= 139);
          if (e) {
            stats.bagLanes[e.lane] += 1; bagSeq.push(e.lane); (stats.kindLane[ENAME[e.type]] ??= [0, 0, 0])[e.lane] += 1;
            if (e.type === MOUSE) stats.packLeaders[cur.wave] = (stats.packLeaders[cur.wave] ?? 0) + 1;
            if (bagSeq.length % 6 === 0) { const blk = bagSeq.slice(-6); if ([0, 1, 2].some((L) => blk.filter((x) => x === L).length !== 2)) { stats.bagBlocksBad += 1; anomaly(`bag block ${blk.join('')} uneven`); } }
          } else anomaly('spawnLeft fell with no new monster at the edge');
        }
        if (cur.packLeft === prev.packLeft - 1) {
          if (fresh.some((q) => q.type === MOUSE)) stats.packFollowers[cur.wave] = (stats.packFollowers[cur.wave] ?? 0) + 1;
        }
        stats.battMin[cur.wave] = Math.min(stats.battMin[cur.wave] ?? 99, cur.batt); stats.battMax[cur.wave] = Math.max(stats.battMax[cur.wave] ?? 0, cur.batt);
      }
      if (cur.wave !== prev.wave && prev.state === 1 && cur.state === 1) {
        if (prev.packLeft) { stats.packSpill += 1; anomaly(`wave ${prev.wave} ended with ${prev.packLeft} pack mice to come`); }
        const L = stats.packLeaders[prev.wave] ?? 0, F = stats.packFollowers[prev.wave] ?? 0;
        if (F !== 2 * L && !anomalies.some((a) => a.includes('LID'))) anomaly(`wave ${prev.wave}: ${L} packs, ${F} followers`);
      }
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
    // the per-frame cap: an enemy one step from the toy box waits an update while
    // another died that frame. boxWait: frames past its normal pace spent there
    // (stats.boxWaits[excess frames], boxWaitMax, boxSaved: died there after waiting)
    {
      const fastLap = m.ram(SYM.fast) & 0x80 ? 1 : 0;
      const seen = new Set();
      for (const e of cur.en) {
        if (e.type === EJET) continue;
        const kn = e.type === KNIGHT && (e.st & 0x40) ? 2 + fastLap : fastLap;
        const step = EN_STEP[kn][e.type], mask = kn < 2 ? EN_MASK[kn][e.type] : 0;
        const k = e.i + ':' + birth[e.i]; seen.add(k);
        if (e.x >= BREACH_X && e.x - step < BREACH_X && !(e.st & 0x3f)) {
          const z = boxZone.get(k);
          if (!z || z.x !== e.x) boxZone.set(k, { x: e.x, since: frames, norm: 2 * (mask + 1), lane: e.lane });
          else z.excess = Math.max(0, frames - z.since - z.norm);
        } else boxZone.delete(k);
      }
      for (const [k, z] of boxZone) if (!seen.has(k)) {
        if (z.excess) { stats.boxWaits[z.excess] = (stats.boxWaits[z.excess] ?? 0) + 1; stats.boxWaitMax = Math.max(stats.boxWaitMax, z.excess); if (cur.lids === (prev?.lids ?? cur.lids) && cur.state === 1) stats.boxSaved += 1; }
        boxZone.delete(k);
      }
    }
    if (process.env.TRACE && frames >= +process.env.TRACE.split('-')[0] && frames <= +process.env.TRACE.split('-')[1]) console.log('T', frames, sc('batt'), cur.sl.map((q) => q.type + ':' + q.hp).join(' '), '|', cur.en.map((e) => `${ENAME[e.type]}L${e.lane}x${e.x}hp${e.hp}s${e.st.toString(16)}`).join(' '), '| shots', [0, 1, 2].map((L) => sc('shotDmg', L) ? `${'-atc'[sc('shotKind', L)]}${sc('shotDmg', L)}` : '.').join(''), 'splash', sc('splashN').toString(16));
    cur.jets = jetsNow;
    prev = cur;
  };

  // ---- cycle watch (read only): overscan logic (CallLogic -> osWait) and VBLANK (SelectEnemies ->
  // vbWait) cycles per frame; batteries over the cap turned into points (GainBatt entered with A > 99)
  const cyc = { logicMax: 0, logicAt: null, logicOver: 0, vbMax: 0, vbAt: null, vbPlayMax: 0, vbHist: {}, logicHist: {} };
  const ovf = { points: 0, calls: 0, byAmt: {}, byWave: {} };
  stats.cyc = cyc; stats.overflow = ovf;
  const P_CALL = SYM.CallLogic, P_OSW = SYM['0.osWait'], P_SEL = SYM.SelectEnemies, P_VBW = SYM['0.vbWait'], P_GAIN = SYM.GainBatt, P_SCHED = SYM.Schedule;
  let schedSnap = null;
  const stepFrame = () => {
    const cpu = m.cpu, bus = m.bus, f = bus.frame;
    let ls = -1, lg = 0, vs = -1, vb = 0;
    schedSnap = null;
    while (bus.frame === f) {
      const pc = cpu.pc;
      if (pc === P_SCHED && bus.bank === 0 && !schedSnap) schedSnap = { fr: m.ram(SYM.frame), st: [0, 1, 2, 3, 4].map((i) => sc('eState', i)), ty: [0, 1, 2, 3, 4].map((i) => sc('eType', i)) };
      if (pc === P_CALL && bus.bank === 0 && ls < 0) ls = cpu.cycles;
      else if (pc === P_OSW && bus.bank === 0 && ls >= 0 && !lg) lg = cpu.cycles - ls;
      else if (pc === P_SEL && bus.bank === 0 && vs < 0) vs = cpu.cycles;
      else if (pc === P_VBW && bus.bank === 0 && vs >= 0 && !vb) vb = cpu.cycles - vs;
      else if (pc === P_GAIN && bus.bank === 2 && cpu.a >= 100) { const n = cpu.a - 99; ovf.points += n; ovf.calls += 1; ovf.byAmt[n] = (ovf.byAmt[n] ?? 0) + 1; const w = sc('wave'); ovf.byWave[w] = (ovf.byWave[w] ?? 0) + n; }
      cpu.step();
    }
    if (process.env.DBGCYC && Math.abs(frames - +process.env.DBGCYC) <= 3) console.log("CYC", frames, "logic", lg, "vb", vb, "ls", ls, "vs", vs);
    const playing = sc('state') === 1;
    const snap = () => ({ frame: frames, wave: sc('wave'), en: enemies().map((e) => `${ENAME[e.type]}@L${e.lane & 7}x${e.x}`).join(' '), toys: slots().map((q) => TOYNAME[q.type][0] ?? '-').join(''), splashN: sc('splashN').toString(16), dirty: sc('dirty') });
    if (lg > cyc.logicMax) { cyc.logicMax = lg; cyc.logicAt = snap(); }
    if (lg > 2216) cyc.logicOver += 1;
    if (vb > cyc.vbMax) { cyc.vbMax = vb; cyc.vbAt = { ...snap(), state: sc('state') }; }
    if (playing && vb > cyc.vbPlayMax) cyc.vbPlayMax = vb;
    if (playing) { const b = Math.floor(vb / 100) * 100; cyc.vbHist[b] = (cyc.vbHist[b] ?? 0) + 1; const b2 = Math.floor(lg / 200) * 200; cyc.logicHist[b2] = (cyc.logicHist[b2] ?? 0) + 1; }
  };
  // status line vs the state: frames the shown score / batteries differ from the real ones (longest run)
  const DH = SYM.DigitHi & 0xfff, DL = SYM.DigitLo & 0xfff;
  const disp = { scoreLag: 0, scoreLagMax: 0, battLag: 0, battLagMax: 0, scoreLagAt: null, battLagAt: null };
  stats.display = disp;
  const checkDisplay = () => {
    if (sc('state') !== 1) { disp.scoreLag = disp.battLag = 0; return; }
    const cells = sc.bind(null, 'cells');
    const s = [0, 1, 2].map((i) => sc('score', i));
    const dg = [s[0] & 15, s[1] >> 4, s[1] & 15, s[2] >> 4, s[2] & 15];
    let okS = true;
    for (let c = 0; c < 3 && okS; c += 1) for (let r = 0; r < 5; r += 1) { const v = ROM[DH + dg[2 * c] * 5 + r] | ROM[DL + (c === 2 ? 50 : dg[2 * c + 1] * 5) + r]; if (cells(c * 5 + r) !== v) { okS = false; break; } }
    const bt = sc('batt'); let okB = true;
    for (let r = 0; r < 5; r += 1) if (cells(25 + r) !== (ROM[DH + Math.floor(bt / 10) * 5 + r] | ROM[DL + (bt % 10) * 5 + r])) { okB = false; break; }
    disp.scoreLag = okS ? 0 : disp.scoreLag + 1; disp.battLag = okB ? 0 : disp.battLag + 1;
    if (disp.scoreLag > disp.scoreLagMax) { disp.scoreLagMax = disp.scoreLag; disp.scoreLagAt = { frame: frames, wave: sc('wave') }; }
    if (disp.battLag > disp.battLagMax) { disp.battLagMax = disp.battLag; disp.battLagAt = { frame: frames, wave: sc('wave') }; }
  };

  // ---- hurt colors (3f75347; read only): marks vs health every frame (bit 5: health <= the half kept in
  // bits 0-3; bit 4: <= half >> 1), the half kept at spawn vs MaxHP (capped at 15), and what the scheduler
  // showed: per life, frames drawn plain / in the other page while badly hurt (a flicker that a 2- or
  // 4-enemy turn-taking parity can hide). stats.hurt[kind]: lives, hurt, bad, hurtF/badF (frames),
  // badEp (badly hurt lives drawn 8+ times), badPlainOnly / badOtherOnly (drawn only plain / only the other
  // page), badMixed; halfBad (wrong half at spawn), capped (half 15 from a full health over 31), markBad
  const EN_HP = [0, 6, 5, 3, 1, 6, 2, 3, 20];
  const hurt = {}; stats.hurt = hurt; stats.hurtMarkBad = 0;
  const lives = [null, null, null, null, null];
  const HURTDBG = process.env.HURTDBG ? process.env.HURTDBG.split('-').map(Number) : null; // HURTDBG=a-b: per frame, the enemies and which ones were drawn
  const endLife = (L) => {
    if (!L) return;
    const h = hurt[ENAME[L.type]] ??= { lives: 0, hurt: 0, bad: 0, hurtF: 0, badF: 0, badEp: 0, badPlainOnly: 0, badOtherOnly: 0, badMixed: 0, halfBad: 0, capped: 0, maxFull: 0 };
    h.lives += 1; if (L.hurtF) h.hurt += 1; if (L.badF) h.bad += 1; h.hurtF += L.hurtF; h.badF += L.badF; h.steadyF = (h.steadyF ?? 0) + (L.steadyF ?? 0); h.steadyPlainF = (h.steadyPlainF ?? 0) + (L.steadyPlainF ?? 0);
    if (L.badPlain + L.badOther >= 8) { h.badEp += 1; if (!L.badOther) h.badPlainOnly += 1; else if (!L.badPlain) h.badOtherOnly += 1; else h.badMixed += 1; if (!L.badOther || !L.badPlain) (stats.hurtOneColor ??= []).push({ kind: ENAME[L.type], draws: L.badPlain + L.badOther, plain: !L.badOther, from: L.badFrom, to: frames, wave: sc('wave') }); }
    h.steadyFullF = (h.steadyFullF ?? 0) + (L.steadyFullF ?? 0);
    if (L.halfBad) h.halfBad += 1; if (L.capped) h.capped += 1; h.maxFull = Math.max(h.maxFull, L.full ?? 0);
  };
  const hurtWatch = () => {
    if (sc('state') !== 1) { for (let i = 0; i < 5; i += 1) { endLife(lives[i]); lives[i] = null; } return; }
    const ord = [0, 1, 2, 3, 4].map((k) => m.ram(SYM.eOrder + k)); const drawn = new Set(ord.filter((v) => v & 0x80).map((v) => v & 7));
    const wave = sc('wave'), fastA = (m.ram(SYM.fast) & 0xA0) === 0xA0;
    if (HURTDBG && frames >= HURTDBG[0] && frames <= HURTDBG[1]) console.log('H', frames, 'fr', schedSnap?.fr, 'drawn', [...drawn].join(''), [0, 1, 2, 3, 4].map((k) => `${ENAME[sc('eType', k)]}L${sc('eLane', k) & 7}x${sc('eX', k)}hp${sc('eHP', k)}s${sc('eState', k).toString(16)}`).join(' '));
    for (let i = 0; i < 5; i += 1) {
      const t = sc('eType', i), hp = sc('eHP', i), st = sc('eState', i), x = sc('eX', i);
      let L = lives[i];
      if (!t || t === EJET) { endLife(L); lives[i] = null; continue; }
      if (!L || L.type !== t || hp > L.hp || (L.st & 0x30) && !(st & 0x30) || (x >= 139 && L.x < 120)) {
        endLife(L);
        L = lives[i] = { type: t, hp, st, x, hurtF: 0, badF: 0, badPlain: 0, badOther: 0 };
        if (x >= 149) {
          const full = EN_HP[t] + ((wave >> 2) >> (t === MOUSE || t === BALLOON ? 1 : 0)) + (fastA ? 1 : 0);
          L.full = full; L.capped = (full >> 1) > 15;
          if (hp === full && (st & 15) !== Math.min(15, full >> 1)) { L.halfBad = true; anomaly(`${ENAME[t]} spawned with half ${st & 15}, full ${full}`); }
        }
      }
      L.hp = hp; L.st = st; L.x = x;
      const half = st & 15, wantB5 = hp <= half, wantB4 = hp <= half >> 1;
      if (!!(st & 0x20) !== wantB5 || !!(st & 0x10) !== wantB4) { stats.hurtMarkBad += 1; if (stats.hurtMarkBad < 6) anomaly(`${ENAME[t]} slot ${i} hp ${hp} half ${half} marks ${(st >> 4) & 3}`); }
      if (st & 0x20) L.hurtF += 1; if (st & 0x10) { L.badF += 1; L.badFrom ??= frames; }
      // what the scheduler drew this frame (its state and frame at Schedule)
      if (schedSnap && drawn.has(i) && schedSnap.ty[i] === t && (schedSnap.st[i] & 0x10)) { if (schedSnap.fr & 4) L.badOther += 1; else L.badPlain += 1; }
      // the last 16 frames while badly hurt: drawn 3+ times, all in one color (the flicker not visible)
      if (st & 0x10) { (L.win ??= []).push(schedSnap && drawn.has(i) && schedSnap.ty[i] === t ? (schedSnap.st[i] & 0x10 ? 1 + ((schedSnap.fr >> 2) & 1) : 0) : 0); if (L.win.length > 16) L.win.shift(); const d = L.win.filter(Boolean); if (d.length >= 3 && d.every((v) => v === d[0])) { L.steadyF = (L.steadyF ?? 0) + 1; if (L.win.length === 16) L.steadyFullF = (L.steadyFullF ?? 0) + 1; if (d[0] === 1) L.steadyPlainF = (L.steadyPlainF ?? 0) + 1; } }
    }
  };

  // ---- the hands
  const run = (bits = 0, fire = false, swchb = o.diffA ? 0x4b : 0x0b) => {
    m.bus.swcha = 0xff ^ bits; m.bus.inpt4 = fire ? 0 : 0x80; m.bus.swchb = swchb;
    const pre = sc('state') === 1 ? { batt: sc('batt'), n: enemies().filter((e) => e.type !== EJET).length, lids: sc('lids'), wave: sc('wave') } : null;
    if (PROF_AT.has(frames)) profileFrame(m, frames); else { stepFrame(); hurtWatch(); }
    if (pre && SYM.temp !== undefined && sc('state') === 1 && !(m.ram(SYM.frame) & 1) && m.ram(SYM.temp + 3) && sc('batt') < pre.batt && sc('lids') === pre.lids && enemies().filter((e) => e.type !== EJET).length >= pre.n) {
      // an even frame the spawner sat out only because of a placement (no kill, no lid): the spawn schedule slips 2 frames
      stats.placeHolds = (stats.placeHolds ?? 0) + 1; (stats.placeHoldsW ??= {})[pre.wave] = (stats.placeHoldsW[pre.wave] ?? 0) + 1;
    }
    checkDisplay();
    const { total, vb } = m.layout();
    if (total !== 262 || vb[0][0] !== 40) { mistimed += 1; mistimedAll.push(frames); if (mistimedAt.length < 10) mistimedAt.push({ frame: frames, wave: sc('wave'), total, vb: JSON.stringify(vb), en: enemies().map((e) => `${ENAME[e.type]}@L${e.lane}x${e.x}`).join(' '), toys: slots().map((q) => TOYNAME[q.type][0] ?? '-').join(''), shots: [0, 1, 2].map((L) => sc('shotDmg', L)).join(','), splashN: sc('splashN'), cursor: sc('cursor'), stick: m.bus.swcha.toString(16), fire: m.bus.inpt4 === 0, sound: sc('sndPos') }); }
    if (SYM.temp !== undefined && sc('state') === 1 && !(m.ram(SYM.frame) & 1) && m.ram(SYM.temp + 3)) { stats.killSkips += 1; stats.killSkipsW[sc('wave')] = (stats.killSkipsW[sc('wave')] ?? 0) + 1; } // an even frame with a kill (KILLED = temp+3): the spawner waits it out
    if (SYM.temp !== undefined && sc('state') === 1 && m.ram(SYM.temp + 3)) { // enemies held at the box by the cap this frame (should match boxWaits)
      const fr = m.ram(SYM.frame), fastLap = m.ram(SYM.fast) & 0x80 ? 1 : 0;
      for (const e of enemies()) {
        if (e.type === EJET || (e.i & 1) !== (fr & 1) || (e.st & 0x3f)) continue;
        const kn = e.type === KNIGHT && (e.st & 0x40) ? 2 + fastLap : fastLap;
        if (e.x >= BREACH_X && e.x - EN_STEP[kn][e.type] < BREACH_X && !((fr >> 1) & (kn < 2 ? EN_MASK[kn][e.type] : 0))) { stats.boxHeld = (stats.boxHeld ?? 0) + 1; if (log) console.log(`f${frames} box held: ${ENAME[e.type]} slot ${e.i} L${e.lane} x${e.x}`); }
      }
    }
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
  const wanted = (col) => { let t = 0; const st = o.lap2 && sc('wave') >= o.lap2At && unlock() >= CANNON ? STRATEGIES[o.lap2] : strat; for (const [u, toy] of st.cols[col]) if (u <= unlock()) t = toy; return t; };
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
  const PXF = [[0, 0.5, 1, 1, 2, 0.5, 0.5, 1, 0.25], [0, 1, 2, 2, 3, 1, 0.5, 2, 0.5]]; // (3527460: balloons keep the first-lap pace) // pixels per frame, laps 1/2
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
        const col = o.legacy ? [0, 1, 2].find((c) => !sl[e.lane * 3 + c].type && COLX[c] + ((e.st & 0x80) ? 1 : 3) <= e.x) : ([0, 1, 2].find((c) => !sl[e.lane * 3 + c].type) ?? 0); // (a jet takes off from any slot, full or not)
        if (col !== undefined) add(200 + (lidUsed ? 50 : 0), e.lane * 3 + col, 'place', JET, `jet ${ENAME[e.type]}@${e.x}`);
        else if ((lidUsed || e.type === TREX) && batt + (COST[sl[e.lane * 3].type] >> 1) >= COST[JET]) add(190, e.lane * 3, 'pick', 0, 'clear runway for jet');
        else if (o.balloonRunway && e.type === BALLOON || o.runway && (lidUsed || e.type === TREX || e.type === BALLOON)) {
          // a full shelf and a balloon floating over it (a tank can't hit it): make room for a jet by
          // picking up the cheapest toy no monster stands on (heavy, 28 games: balloon lids 21 -> 11,
          // but the same final waves, so off by default)
          const c2 = [0, 1, 2].filter((c) => sl[e.lane * 3 + c].type !== JET && !standing(en, e.lane * 3 + c, false)).sort((a2, b2) => COST[sl[e.lane * 3 + a2].type] - COST[sl[e.lane * 3 + b2].type])[0];
          if (c2 !== undefined && batt + (COST[sl[e.lane * 3 + c2].type] >> 1) >= COST[JET]) add(190, e.lane * 3 + c2, 'pick', 0, 'clear runway for jet');
        }
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
    // a jack-in-the-box where a bunch (two or more within 10 pixels) or a
    // T-Rex will reach first: the first empty slot ahead of them that they
    // get to before anything else stops them (balloons float over: not counted)
    if (o.jackTrap && u >= JACK && batt >= COST[JACK]) {
      for (let L = 0; L < 3; L += 1) {
        const walkers = en.filter((e) => e.lane === L && e.type !== BALLOON).sort((p, q) => p.x - q.x);
        const lead = walkers[0];
        if (!lead) continue;
        const bunch = walkers.filter((e) => e.x - lead.x <= (o.jackSpan ?? 10)).length >= (o.jackBunch ?? 2) || (o.jackTrex ?? true) && walkers.some((e) => e.type === TREX);
        if (!bunch) continue;
        for (let c = 2; c >= 0; c -= 1) {
          const s = L * 3 + c;
          if (COLX[c] > lead.x) continue; // already behind them
          // the front teddy, while they're still a way off: make room (half its cost back)
          if ((o.jackSwap || o.jackSwapTrex && walkers.some((e) => e.type === TREX && e.x - COLX[c] < 60)) && sl[s].type === TEDDY && lead.x - COLX[c] >= 30 && batt + (COST[TEDDY] >> 1) >= COST[JACK] && !standing(en, s)) { add(150, s, 'pick', 0, 'room for a jack'); break; }
          if (sl[s].type) break; // a toy stops them first
          if (lead.x - COLX[c] >= 14 && !standing(en, s)) { add(155, s, 'place', JACK, `jack for ${walkers.length} on shelf ${L}`); break; }
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
        } else if (o.trexSalvage && sl[s].type !== JET && sl[s].type !== TEDDY && sl[s].type !== JACK && front.some((e) => e.type === TREX && e.x >= COLX[c] && e.x - COLX[c] <= 8)) {
          // a T-Rex crushes it in one bite: take half its cost first
          add(66, s, 'pick', 0, `salvage ${TOYNAME[sl[s].type]} from trex`);
        } else if (o.salvage && sl[s].type !== JET && sl[s].type !== JACK && sl[s].hp <= 1 && standing(en, s, false)) {
          // about to be eaten anyway, and can't be put back: take half its cost
          add(65, s, 'pick', 0, `salvage ${TOYNAME[sl[s].type]}`);
        } else if (o.repairShooters && sl[s].type !== TEDDY && sl[s].type !== JET && sl[s].hp <= o.shooterRepairAt && batt >= COST[sl[s].type] - (COST[sl[s].type] >> 1) + 1
          && front.some((e) => e.x >= COLX[c] && e.x <= COLX[c] + 8 && e.type !== TREX)) {
          add(70 + pressure[L], s, 'pick', 0, `repair ${TOYNAME[sl[s].type]}`);
        } else if (o.upgrade && !bossSoon && sl[s].type !== want && sl[s].type !== JET && sl[s].type !== JACK && (want !== TEDDY || c < 2)) {
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
        const col = o.legacy ? [0, 1, 2].find((c) => !sl[L * 3 + c].type) : ([0, 1, 2].find((c) => !sl[L * 3 + c].type) ?? 0);
        if (col !== undefined) add(185, L * 3 + col, 'place', JET, `jet pack ${hp}`);
        else if (o.runway) {
          // runway: no free slot on the shelf; pick up the cheapest toy nothing stands on
          const c2 = [0, 1, 2].filter((c) => sl[L * 3 + c].type !== JET && !standing(en, L * 3 + c, false)).sort((a2, b2) => COST[sl[L * 3 + a2].type] - COST[sl[L * 3 + b2].type])[0];
          if (c2 !== undefined && batt + (COST[sl[L * 3 + c2].type] >> 1) >= COST[JET]) add(180, L * 3 + c2, 'pick', 0, 'clear runway for jet');
        }
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
        if (!o.legacy || !sl[s0].type) add(80, s0, 'place', JET, 'overflow jet'); // (any slot: a jet takes off from a full one too)
        else if (!sl[s1].type) add(80, s1, 'place', JET, 'overflow jet');
        else if (!o.legacy && !sl[s1 + 1].type) add(80, s1 + 1, 'place', JET, 'overflow jet');
        else if (sl[s1].type !== TEDDY) add(80, s1, 'pick', 0, 'clear runway for jet');
      }
    }
    // probeLand (a rule probe, not play): a T-Rex between the front and middle columns gets a
    // jack in the middle slot and a teddy behind it in the front slot, to see where the throw lands
    if (o.probeLand && u >= JACK) {
      for (const t of en.filter((e) => e.type === TREX && e.x < COLX[2] - 1 && e.x > COLX[1] + 12)) {
        const s1 = t.lane * 3 + 1, s2 = t.lane * 3 + 2;
        if (sl[s1].type !== JACK) add(500, s1, sl[s1].type ? 'pick' : 'place', JACK, 'probe: jack in the middle');
        else if (!sl[s2].type && !standing(en, s2)) add(499, s2, 'place', TEDDY, 'probe: teddy behind the T-Rex');
      }
    }
    cands.sort((a, b) => b.score - a.score);
    // the best one; if it's a placement we can't afford, wait for it (unless
    // something cheaper is also urgent), keeping the jet reserve in mind
    const doomed = (slot) => en.some((e) => e.type === TREX && e.lane === Math.floor(slot / 3) && e.x >= COLX[slot % 3] - 2 && e.x <= COLX[slot % 3] + o.trexGap);
    // boss waves: keep batteries for jets at the T-Rex (bossSave) while one is on the board or still to come
    const trexAhead = en.some((e) => e.type === TREX) || (wi === 5 || wi === 11) && sc('bossLeft') > 0 || wi === 4 || wi === 10;
    const bossKeep = o.bossSave && (sc('wave') >= 13 || o.bossSaveLap1) && u >= JET && trexAhead ? o.bossSave : 0;
    for (const c of cands) {
      if (c.op === 'pick') return c;
      if (c.toy !== JET && c.toy !== JACK && doomed(c.slot)) continue; // (a jack springs on a T-Rex: that's its job)
      const reserve = Math.max((u >= JET && o.jetReserve && c.toy !== JET && c.score < 150 && !(c.toy === TEDDY && c.score >= 40)) ? COST[JET] : 0, c.toy !== JET && c.toy !== TEDDY && c.score < 150 ? bossKeep : 0);
      if (batt >= COST[c.toy] + reserve) return c;
      if (c.score >= 100) continue; // emergencies: try the next affordable one
      if (reserve && batt >= COST[c.toy]) continue;
      return { ...c, wait: true };
    }
    return null;
  };

  let pickedFor = null; // after a repair pick-up, put a teddy straight back
  // probeCut (a rule probe, not play): with every enemy slot taken and a walker about to reach a
  // jack, stand ready on a free slot with the jet chosen and place it right after the spring,
  // to see a jet's full-slots burst land on the jack's sweep
  const probeCut = () => {
    if (unlock() < JET || sc('batt') < COST[JET]) return null;
    const en = enemies(), sl = slots(); const sweep = sc('splashN') >> 4 === 7;
    if (en.length < 5 && !sweep) return null;
    const near = sl.some((q) => q.type === JACK && en.some((e) => e.type !== BALLOON && e.type !== EJET && e.lane === Math.floor(q.s / 3) && e.x >= COLX[q.s % 3] && e.x - COLX[q.s % 3] <= 24));
    if (!near && !sweep) return null;
    const free = sl.find((q) => !q.type);
    return free ? { slot: free.s, fire: sweep && en.length === 5 } : null;
  };
  while (sc('state') === 1 && frames < maxFrames) {
    if (o.probeCut) {
      const p = probeCut();
      if (p) {
        if (sc('cursor') !== p.slot) moveTo(p.slot);
        else if (sc('toy') !== JET) selectToy(JET);
        else if (p.fire) { stats.probeFired = (stats.probeFired ?? 0) + 1; note(`probe: jet placed during a jack sweep (splashN ${sc('splashN').toString(16)})`); run(0, true); run(); }
        else run();
        continue;
      }
    }
    let act = decide();
    if (pickedFor !== null) {
      if (!sc('slotType', pickedFor.slot) && sc('batt') >= COST[pickedFor.toy] && frames - pickedFor.at < 90) act = { slot: pickedFor.slot, op: 'place', toy: pickedFor.toy, why: 'replace' };
      else pickedFor = null;
    }
    if (!act || act.wait) { if (act && act.slot !== sc('cursor')) moveTo(act.slot); else run(); continue; }
    if (sc('cursor') !== act.slot) { moveTo(act.slot); continue; }
    if (act.op === 'place') {
      if (sc('toy') !== act.toy) { selectToy(act.toy); continue; }
      if ((act.toy !== JET && sc('slotType', act.slot)) || sc('batt') < COST[act.toy]) { run(); continue; } // (a jet takes off from a full slot too: 2dfa633's player stalled here on full shelves)
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
      if (sc('batt') < b0) { stats.spent[TOYNAME[act.toy]] = (stats.spent[TOYNAME[act.toy]] ?? 0) + COST[act.toy]; if (act.toy === JACK) jk.placed += 1; }
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
      let pre = act.why.startsWith('repair ') && !act.why.startsWith('salvage') ? t : act.why === 'clear runway for jet' ? JET : 0;
      // (with the jet chosen, fire launches a jet from any slot instead of picking up: choose another toy first)
      if (pre === JET || (!pre && sc('toy') === JET)) pre = t;
      if (pre && sc('toy') !== pre) { selectToy(pre); continue; }
      if (log) console.log(`f${frames} pick ${TOYNAME[t]} at ${act.slot} (${act.why})`);
      const bp = sc('batt'); pickSlot = act.slot; tap(); pickSlot = -1; stats.refund = (stats.refund ?? 0) + Math.max(0, sc('batt') - bp);
      if (act.why.startsWith('repair ')) pickedFor = { slot: act.slot, toy: t, at: frames };
      if (act.why === 'clear runway for jet') pickedFor = { slot: act.slot, toy: JET, at: frames };
    }
  }
  for (let i = 0; i < 5; i += 1) { endLife(lives[i]); lives[i] = null; }
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
