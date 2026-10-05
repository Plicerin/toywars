// A playtesting bot for Toy Wars that plays with the joystick, fire button
// and console switches only. It reads RAM to see the board (as a human reads
// the screen) but never writes it.
//  - keeps a per-shelf layout (front teddy, shooters behind, heavier toys as
//    they unlock), rebuilds what gets chewed, repairs worn teddies
//  - reacts to the shelf under pressure, spends jets on monsters that got
//    past every toy, blocks with a teddy dropped in front of a runaway
//  - checks a few rules while it watches (logged as "anomalies")
// usage: node tools/player.mjs [games] [strategy: cannon (best), tank, heavy, cannon0, army] [seedBase] [maxFrames]
//   env: OPTS='{"repairShooters":false}' (strategy knobs), LOG=1 (actions), TRACE=a-b (board per frame), PROF_AT=f,f (logic cycle profile)
import { readFileSync } from 'node:fs';
import { Machine } from './atari/machine.mjs';

const SYM = Object.fromEntries(readFileSync('tools/build/toywars.sym', 'latin1').split(/\r?\n/).map((l) => /^(\S+)\s+([0-9a-f]{4})/i.exec(l)).filter(Boolean).map((x) => [x[1], parseInt(x[2], 16)]));
const ROM = readFileSync('toywars.bin');

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
  const o = { jetReserve: true, repairAt: 12, upgrade: true, jetX: 90, trexJetX: 110, cowboyTrex: true, bossPrep: true, trexGap: 40, overflow: 90, overflowHp: 12, repairShooters: true, shooterRepairAt: 2, ...opts };
  const strat = STRATEGIES[strategy];
  const m = new Machine(ROM);
  const sc = (n, i = 0) => m.ram(SYM[`W_${n}`] + i);
  let mistimed = 0, frames = 0;
  const mistimedAt = [];
  const anomalies = [];
  const events = [];
  const jetFrames = [];
  const mistimedAll = [];
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
      if (cur.lids !== prev.lids && cur.state === 1) {
        const lane = [0, 1, 2].find((L) => (cur.lids ^ prev.lids) & (1 << L));
        note(`LID slammed on shelf ${lane}; enemies there before: ${prev.en.filter((e) => e.lane === lane).map((e) => `${ENAME[e.type]}@${e.x}hp${e.hp}`).join(' ')}; toys ${[0, 1, 2].map((c) => TOYNAME[prev.sl[lane * 3 + c].type]).join('/')}`);
      }
      if (cur.state === 2 && prev.state === 1) {
        note(`GAME OVER; enemies: ${prev.en.map((e) => `${ENAME[e.type]}@L${e.lane}x${e.x}hp${e.hp}`).join(' ')}; toys ${prev.sl.map((s) => TOYNAME[s.type][0] ?? '-').join('')} batt ${prev.batt}`);
      }
      if (cur.wave !== prev.wave) note(`wave ${cur.wave} starts; batt ${cur.batt}; toys ${cur.sl.map((s) => TOYNAME[s.type]).join(',')}`);
    }
    if (process.env.TRACE && frames >= +process.env.TRACE.split('-')[0] && frames <= +process.env.TRACE.split('-')[1]) console.log('T', frames, sc('batt'), cur.sl.map((q) => q.type + ':' + q.hp).join(' '), '|', cur.en.map((e) => `${ENAME[e.type]}L${e.lane}x${e.x}hp${e.hp}s${e.st.toString(16)}`).join(' '));
    prev = cur;
  };

  // ---- the hands
  const run = (bits = 0, fire = false, swchb = 0x0b) => {
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
  run(0, false, 0x0a); run();
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
  const wanted = (col) => { let t = 0; for (const [u, toy] of strat.cols[col]) if (u <= unlock()) t = toy; return t; };
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

  let lastLog = 0;
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
      const jetFlying = enemies().some((q) => q.type === EJET && (q.lane & 3) === e.lane);
      if (u >= JET && !jetFlying && (e.x <= o.jetX || trexRun) && e.x >= 49 && (lidUsed || e.type === TREX || (o.jetBalloon && e.type === BALLOON) || en.filter((q) => q.lane === e.lane).length < 3)) {
        const col = [0, 1, 2].find((c) => !sl[e.lane * 3 + c].type && COLX[c] + ((e.st & 0x80) ? 1 : 3) <= e.x);
        if (col !== undefined) add(200 + (lidUsed ? 50 : 0), e.lane * 3 + col, 'place', JET, `jet ${ENAME[e.type]}@${e.x}`);
        else if ((lidUsed || e.type === TREX) && batt + (COST[sl[e.lane * 3].type] >> 1) >= COST[JET]) add(190, e.lane * 3, 'pick', 0, 'clear runway for jet');
      }
      // block: a teddy where it will arrive (not for balloons or a T-Rex)
      if (u >= TEDDY && e.type !== BALLOON && e.type !== TREX) {
        for (let c = 2; c >= 0; c -= 1) {
          if (!sl[e.lane * 3 + c].type && COLX[c] <= e.x && (c > 0 || e.x >= 52 || lidUsed)) { add(150 + (lidUsed ? 50 : 0) - (e.x - COLX[c]) / 10, e.lane * 3 + c, 'place', TEDDY, `block ${ENAME[e.type]}@${e.x}`); break; }
        }
      }
      // no teddies yet: an army man in its path still delays it
      if (u < TEDDY) {
        for (let c = 2; c >= 0; c -= 1) {
          if (!sl[e.lane * 3 + c].type && COLX[c] <= e.x) { add(140, e.lane * 3 + c, 'place', ARMY, `block ${ENAME[e.type]}@${e.x}`); break; }
        }
      }
    }
    // a T-Rex: cowboy within lasso reach behind it
    if (o.cowboyTrex && u >= COWBOY) {
      for (const e of en.filter((q) => q.type === TREX)) {
        for (let c = 2; c >= 0; c -= 1) {
          const s = e.lane * 3 + c;
          if (e.x - COLX[c] > 24 && e.x - COLX[c] < 40 && !sl[s].type) { add(120, s, 'place', COWBOY, 'lasso trex'); break; }
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
          // a T-Rex crushes whatever is put in front of it
          if (front.some((e) => e.type === TREX && e.x >= COLX[c] - 2 && e.x <= COLX[c] + o.trexGap)) continue;
          const colW = c === 2 ? 30 : c === 1 ? 26 : 22;
          add(colW + pressure[L] * 2 + (want === TEDDY ? 10 : 0), s, 'place', want, `layout ${TOYNAME[want]}`);
        } else if (sl[s].type === TEDDY && want === TEDDY && sl[s].hp < o.repairAt && batt >= 6) {
          add(60 + pressure[L], s, 'pick', 0, 'repair teddy');
        } else if (o.repairShooters && sl[s].type !== TEDDY && sl[s].type !== JET && sl[s].hp <= o.shooterRepairAt && batt >= COST[sl[s].type] - (COST[sl[s].type] >> 1) + 1
          && front.some((e) => e.x >= COLX[c] && e.x <= COLX[c] + 8 && e.type !== TREX)) {
          add(70 + pressure[L], s, 'pick', 0, `repair ${TOYNAME[sl[s].type]}`);
        } else if (o.upgrade && !bossSoon && sl[s].type !== want && want !== TEDDY) {
          const quiet = !front.some((e) => e.x < 140);
          if (quiet && batt + (COST[sl[s].type] >> 1) >= COST[want] + (u >= JET && o.jetReserve ? COST[JET] : 0)) add(10, s, 'pick', 0, `upgrade to ${TOYNAME[want]}`);
        }
      }
    }
    // batteries near the cap: spend a jet on the most crowded shelf
    if (u >= JET && o.overflow && batt >= o.overflow) {
      let best = -1, bestHp = 0;
      for (let L = 0; L < 3; L += 1) {
        if (enemies().some((q) => q.type === EJET && (q.lane & 3) === L)) continue;
        const hp = en.filter((e) => e.lane === L && e.x >= 84).reduce((a, e) => a + Math.min(10, e.hp), 0);
        if (hp > bestHp) { bestHp = hp; best = L; }
      }
      if (best >= 0 && bestHp >= o.overflowHp) {
        const s1 = best * 3 + 1, s0 = best * 3;
        if (!sl[s0].type) add(80, s0, 'place', JET, 'overflow jet');
        else if (!sl[s1].type) add(80, s1, 'place', JET, 'overflow jet');
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
      if (log) console.log(`f${frames} place ${TOYNAME[act.toy]} at ${act.slot} (${act.why})`);
      tap();
      if (act.toy === JET) jetFrames.push(frames);
      pickedFor = null;
    } else {
      const t = sc('slotType', act.slot);
      if (!t) { run(); continue; }
      const pre = act.why.startsWith('repair ') ? t : act.why === 'clear runway for jet' ? JET : 0;
      if (pre && sc('toy') !== pre) { selectToy(pre); continue; }
      if (log) console.log(`f${frames} pick ${TOYNAME[t]} at ${act.slot} (${act.why})`);
      tap();
      if (act.why.startsWith('repair ')) pickedFor = { slot: act.slot, toy: t, at: frames };
      if (act.why === 'clear runway for jet') pickedFor = { slot: act.slot, toy: JET, at: frames };
    }
  }
  const score = Number([0, 1, 2].map((i) => sc('score', i).toString(16).padStart(2, '0')).join(''));
  const final = { enemies: enemies().map((e) => `${ENAME[e.type]}@L${e.lane}x${e.x}hp${e.hp}st${e.st.toString(16)}`), slots: slots().map((q) => `${TOYNAME[q.type]}${q.type ? q.hp : ''}`), spawnLeft: sc('spawnLeft'), spawnTimer: sc('spawnTimer'), packLeft: sc('packLeft'), bossLeft: sc('bossLeft'), batt: sc('batt') };
  return { strategy, seedFrames, final, wave: sc('wave'), seconds: Math.round(frames / 60), frames, score, over: sc('state') === 2, lids: sc('lids'), mistimed, mistimedAt, mistimedAll: mistimedAll.slice(0, 200), jetFrames, scViolations: m.bus.scViolations, anomalies, events: events.filter((e) => /LID|GAME OVER/.test(e)) };
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
