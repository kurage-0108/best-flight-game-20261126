// Mission flow and scoring: start pose, live objectives and hints, ring and
// crash handling, landing judgement (sink, speed, alignment, bank, on-strip),
// and the results breakdown with a rank. Pure game logic over config data.

import { AIRCRAFT, LANDING, MISSIONS, SCORING, UNITS } from './config.js';
import { fromRunwayFrame } from './terrain.js';

const STORE_KEY = 'sunward-isles-best';
const GRADES = [
  { name: 'HARD', points: SCORING.landingHard },
  { name: 'FIRM', points: SCORING.landingFirm },
  { name: 'SMOOTH', points: SCORING.landingSmooth },
];
const CRASH_TEXT = {
  water: 'You flew into the sea. The isles will need a boat for this one.',
  ditched: 'You rolled off the end of the strip and into the sea.',
  impact: 'You hit the ground nose-first or sinking far too fast.',
  terrain: 'You flew into rising ground. Keep the hills below you.',
  wingtip: 'A wingtip dug in: too much bank at touchdown.',
  'too-fast': 'You touched down far too fast and the gear gave way. Slow below 85 kt first.',
  gear: 'A hard landing on a damaged airframe folded the gear.',
  rough: 'The airframe broke up rolling fast over rough ground.',
  post: 'You struck a ring marker post. Fly through the ring, not under it.',
  obstacle: 'You hit something on the ground.',
};

const angleGap = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** "230° 14 KT G25" style wind description for briefings and the HUD. */
export function windText(w) {
  if (!w || w.speed < 0.5) return 'CALM';
  const kt = (v) => Math.round(v * UNITS.MS_TO_KT);
  return `${String(w.from).padStart(3, '0')}° ${kt(w.speed)} KT${w.gust >= 2 ? ` G${kt(w.speed + w.gust)}` : ''}`;
}

export function loadBestScores() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveBestScore(id, total, rank) {
  const best = loadBestScores();
  if (best[id] && best[id].total >= total) return;
  best[id] = { total, rank };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(best));
  } catch {
    // storage unavailable (private mode): best scores simply are not kept
  }
}

/** Where a mission begins: lined up at the start end of its runway, engine idling. */
export function missionStartPose(mission, world) {
  const rw = world.runwayById(mission.startRunway);
  const p = fromRunwayFrame(rw, -rw.halfLength + 45, 0);
  return { x: p.x, z: p.z, heading: rw.heading, fuel: mission.fuel, throttle: 0 };
}

/** The briefing screen's data for mission `index`. */
export function briefingFor(index, world) {
  const m = MISSIONS[index];
  const land = world.runwayById(m.landRunway);
  return {
    kicker: m.kicker,
    title: m.name,
    text: m.briefing,
    goals: [...m.goals, `Wind ${windText(m.wind)} · fuel ${m.fuel}% · par ${fmtTime(m.parTime)}`, `Land at ${land.name} (${land.length} m)`],
  };
}

/** One attempt at a mission: call start(), then step(dt, aircraftEvents) every physics step. */
export function createMissionRun(index, world, aircraft, rings) {
  const mission = MISSIONS[index];
  const target = world.runwayById(mission.landRunway);
  const s = aircraft.state;
  const lastPos = { x: 0, y: 0, z: 0 };
  const run = {
    index, mission, target, phase: 'takeoff', time: 0, passed: 0, clipped: 0, centred: 0,
    landing: null, result: null, hint: '', hintTone: '',
  };

  function start() {
    aircraft.reset(missionStartPose(mission, world));
    rings.load(mission.rings);
    Object.assign(run, { phase: 'takeoff', time: 0, passed: 0, clipped: 0, centred: 0, landing: null, result: null });
    copyPos();
  }

  function copyPos() {
    lastPos.x = s.position.x;
    lastPos.y = s.position.y;
    lastPos.z = s.position.z;
  }

  /** Grades a touchdown on the way to the target strip. */
  function judge(e) {
    const align = e.runway ? Math.min(angleGap(e.heading, e.runway.heading), angleGap(e.heading, e.runway.heading + 180)) : 90;
    let grade = e.sink <= LANDING.goodSink ? 2 : e.sink <= LANDING.hardSink ? 1 : 0;
    const faults = [];
    if (e.airspeed > LANDING.maxSpeed) faults.push('too fast');
    if (align > LANDING.maxAlignDeg) faults.push('crabbed');
    if (Math.abs(e.bank) > LANDING.maxBankDeg) faults.push('wing low');
    grade = Math.max(0, grade - faults.length);
    return {
      grade, faults, align, sinkFpm: e.sink * UNITS.MS_TO_FPM, speedKt: e.airspeed * UNITS.MS_TO_KT,
      deadStick: e.deadStick, offStrip: e.kind !== 'runway', wrongStrip: !!e.runway && e.runway.id !== target.id, excursion: false,
    };
  }

  function scoreRows() {
    const ringPts = run.passed * SCORING.ringPoints;
    const cleanPts = (run.passed - run.clipped) * SCORING.ringOrderBonus;
    return [
      { label: 'Rings', detail: `${run.passed} × ${SCORING.ringPoints}`, points: ringPts },
      { label: 'Clean passes', detail: `${run.passed - run.clipped} of ${run.passed}`, points: cleanPts },
    ];
  }

  function finish(success, reason) {
    const rows = scoreRows();
    let title = 'Sortie failed';
    let rank = '—';
    if (success) {
      const L = run.landing;
      const landPts = Math.round(GRADES[L.grade].points * (L.deadStick ? SCORING.deadStickFactor : 1));
      const timeBonus = Math.round(Math.min(SCORING.maxTimeBonus, Math.max(0, (mission.parTime - run.time) * SCORING.timeBonusPerSecond)));
      rows.push(
        { label: 'Time', detail: `${fmtTime(run.time)} (par ${fmtTime(mission.parTime)})`, points: timeBonus },
        { label: `Landing: ${GRADES[L.grade].name}`, detail: `${Math.round(L.sinkFpm)} fpm · ${Math.round(L.speedKt)} kt${L.faults.length ? ' · ' + L.faults.join(', ') : ''}${L.deadStick ? ' · dead stick' : ''}`, points: landPts },
        { label: 'Fuel left', detail: `${s.fuel.toFixed(0)}%`, points: Math.round(s.fuel * SCORING.fuelBonusPerPercent) },
      );
      title = L.deadStick ? 'Delivered — dead stick!' : 'Delivered';
      reason = `${GRADES[L.grade].name.toLowerCase()} landing at ${target.name}.`.replace(/^./, (c) => c.toUpperCase());
    }
    rows.push({ label: 'Damage', detail: `${s.damage.toFixed(0)}%`, points: -Math.round(s.damage * SCORING.damagePenaltyPerPercent) });
    const total = Math.max(0, rows.reduce((n, r) => n + r.points, 0));
    if (success) {
      const max = mission.rings.length * (SCORING.ringPoints + SCORING.ringOrderBonus) + SCORING.maxTimeBonus + SCORING.landingSmooth + mission.fuel * 0.5 * SCORING.fuelBonusPerPercent;
      rank = SCORING.ranks.find((r) => total >= r.fraction * max).rank;
      saveBestScore(mission.id, total, rank);
    }
    run.phase = 'done';
    run.result = { success, title, reason, rows, total, rank, index, hasNext: index + 1 < MISSIONS.length, kicker: mission.kicker };
  }

  function failLanding(L) {
    if (L.wrongStrip) return `Wrong strip: this post was for ${target.name}.`;
    if (L.offStrip) return `You put down off the runway. The parcel survived; the paperwork will not.`;
    if (L.excursion) return 'Runway excursion: you ran off the paved strip during the rollout. Touch down slower and brake.';
    return '';
  }

  function computeHint() {
    if (s.crashed) return ['', ''];
    const dist = Math.hypot(s.position.x - target.x, s.position.z - target.z);
    if (run.phase === 'takeoff' && s.onGround) {
      if (s.throttle < 0.95) return ['Hold W for full throttle', ''];
      return s.airspeed > AIRCRAFT.rotateSpeed * 0.85 ? ['Rotate: press ↑ to climb away', 'good'] : ['Building speed…', ''];
    }
    if (!s.engineOn && !s.onGround) return ['Engine out: glide to a strip', 'bad'];
    if (!s.onGround && s.agl < 60 && s.verticalSpeed < -7) return ['PULL UP', 'bad'];
    if (run.phase === 'landing' && !s.onGround && dist < 2600) {
      if (s.airspeed > LANDING.maxSpeed) return ['Too fast: throttle back below 85 kt', 'bad'];
      if (s.agl < 10 && -s.verticalSpeed > LANDING.goodSink) return ['FLARE: ease back on ↑', ''];
      if (s.agl < 60) return ['Line up and settle gently', ''];
    }
    if (run.phase === 'rollout') return ['Hold B to brake to a stop', ''];
    return ['', ''];
  }

  /** Advances the mission one physics step; returns notices { text, tone, seconds, sound } for HUD and audio. */
  function step(dt, events) {
    const notes = [];
    if (run.result) return notes;
    if (run.phase === 'takeoff' && !s.onGround) run.phase = 'rings'; // placed airborne (poses) counts as away
    if (run.phase !== 'takeoff' || s.groundSpeed > 0.5) run.time += dt;

    if (!s.crashed) {
      const r = rings.check(lastPos, s.position);
      if (r?.type === 'post') aircraft.crash('post');
      else if (r) {
        run.passed++;
        if (r.clipped) {
          run.clipped++;
          s.damage = Math.min(100, s.damage + 8);
        }
        if (r.centred) run.centred++;
        const label = r.last ? `ALL RINGS! LAND AT ${target.name.toUpperCase()}` : `RING ${run.passed}/${mission.rings.length}`;
        notes.push({ text: label + (r.clipped ? ' · CLIPPED' : r.centred ? ' · BULLSEYE' : ''), tone: r.clipped ? '' : 'good', seconds: r.last ? 3.5 : 2, sound: r.last ? 'fanfare' : 'chime' });
        if (r.last) run.phase = 'landing';
      }
    }
    copyPos();

    for (const e of events) {
      if (e.type === 'crash') {
        notes.push({ text: 'CRASHED', tone: 'bad', seconds: 3 });
        finish(false, CRASH_TEXT[e.reason] + (e.obstacle ? ` (a ${e.obstacle})` : ''));
        return notes;
      }
      if (e.type === 'liftoff') {
        if (run.phase === 'takeoff') run.phase = 'rings';
        if (run.phase === 'rollout') {
          run.phase = 'landing';
          notes.push({ text: 'TOUCH AND GO', tone: '', seconds: 1.5 });
        }
      } else if (e.type === 'stall') notes.push({ text: 'STALL! LOWER THE NOSE', tone: 'bad', seconds: 1.6 });
      else if (e.type === 'fuel-out') notes.push({ text: 'FUEL EXHAUSTED', tone: 'bad', seconds: 3, sound: 'warn' });
      else if (e.type === 'touchdown' && !s.crashed) {
        if (run.phase === 'landing' || run.phase === 'rollout') {
          run.landing = judge(e);
          run.phase = 'rollout';
          const g = GRADES[run.landing.grade].name;
          notes.push({ text: run.landing.offStrip ? 'OFF THE RUNWAY' : `${g} LANDING`, tone: run.landing.offStrip || run.landing.grade === 0 ? 'bad' : 'good', seconds: 2.2 });
        } else if (run.phase === 'rings') notes.push({ text: 'Rings remain: take off again', tone: '', seconds: 2 });
      }
    }

    if (run.phase === 'rollout' && s.onGround) {
      if (s.surface !== 'runway' && s.groundSpeed > 6) run.landing.excursion = true;
      if (s.groundSpeed < LANDING.stoppedSpeed) {
        const why = failLanding(run.landing);
        notes.push({ text: why ? 'LANDED' : 'DELIVERED!', tone: why ? '' : 'good', seconds: 3, sound: why ? '' : 'fanfare' });
        finish(!why, why);
      }
    } else if (s.onGround && !s.engineOn && s.groundSpeed < LANDING.stoppedSpeed && run.phase !== 'takeoff') {
      finish(false, 'Out of fuel and down short of the destination. Throttle discipline saves fuel.');
    }
    [run.hint, run.hintTone] = computeHint();
    return notes;
  }

  /** HUD objective: ring counter or landing target, distance text and the point to steer for. */
  function objective() {
    const ring = rings.activeRing();
    if (ring && run.phase !== 'landing' && run.phase !== 'rollout') {
      const d = s.position.distanceTo(ring.center);
      return { counter: `RING ${run.passed + 1}/${mission.rings.length}`, next: `NEXT ${(d / 1000).toFixed(d < 10000 ? 2 : 1)} km`, target: ring.center };
    }
    const d = Math.hypot(s.position.x - target.x, s.position.z - target.z);
    return { counter: 'LAND', next: `${target.name.toUpperCase()} ${(d / 1000).toFixed(1)} km`, target: { x: target.x, y: target.elevation, z: target.z } };
  }

  return { run, start, step, objective, timeText: () => fmtTime(run.time) };
}
