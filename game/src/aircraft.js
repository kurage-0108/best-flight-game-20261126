// The player aircraft: a single-prop trainer built from Three.js primitives in
// cream and coral paint, plus its flight model (thrust, lift and stall, drag and
// turn bleed, wind and gusts, fuel, damage, ground roll, touchdown and crashes).

import * as THREE from 'three';
import { AIRCRAFT as A, LANDING, SIM, WIND } from './config.js';
import { headingOf, headingVector } from './terrain.js';

const DEG = Math.PI / 180;
const G = SIM.gravity;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- the model

function buildModel() {
  const paint = (color, extra = {}) => new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 55, ...extra });
  const cream = paint('#f4ead3');
  const coral = paint('#ec5641');
  const dark = paint('#2a2e35', { shininess: 15 });
  const tip = paint('#f6c445');
  const glass = paint('#2f5f78', { shininess: 140, specular: '#ffffff', transparent: true, opacity: 0.8 });
  const root = new THREE.Group();
  const add = (geo, mat, x, y, z, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 10).rotateX(-Math.PI / 2);

  // fuselage (nose toward -Z), coral cowling, cheat lines
  add(lathe([[0, 3.75], [0.42, 3.7], [0.6, 3.35], [0.68, 2.6], [0.7, 1.2], [0.64, -0.2], [0.46, -1.8], [0.26, -3.2], [0.12, -3.9], [0, -3.95]]), cream, 0, 0, 0);
  add(lathe([[0.44, 3.72], [0.615, 3.35], [0.695, 2.6], [0.71, 2.1]]), coral, 0, 0, 0);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.15, 3.9), coral, s * 0.675, 0.12, -0.2);
  add(new THREE.ConeGeometry(0.27, 0.6, 10).rotateX(-Math.PI / 2), coral, 0, 0, -4.02);

  // propeller: two blades with yellow tips, plus a disc that shows at speed
  const prop = new THREE.Group();
  prop.position.z = -3.9;
  root.add(prop);
  add(new THREE.BoxGeometry(0.17, 1.92, 0.06), dark, 0, 0, 0, prop);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.18, 0.2, 0.07), tip, 0, s * 0.88, 0, prop);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.99, 24),
    new THREE.MeshBasicMaterial({ color: '#d7dade', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  disc.position.z = -3.93;
  root.add(disc);

  // low wing in two halves with dihedral, coral tips and moving ailerons
  const ailerons = [];
  for (const s of [-1, 1]) {
    const half = new THREE.Group();
    half.position.set(0, -0.36, -0.5);
    half.rotation.z = s * 0.06;
    root.add(half);
    add(new THREE.BoxGeometry(4.9, 0.17, 1.55), cream, s * 2.55, 0, 0, half);
    add(new THREE.BoxGeometry(0.55, 0.18, 1.3), coral, s * 5.25, 0, -0.05, half);
    const hinge = new THREE.Group();
    hinge.position.set(s * 3.55, 0, 0.78);
    half.add(hinge);
    add(new THREE.BoxGeometry(1.9, 0.09, 0.36), coral, 0, 0, 0.17, hinge);
    ailerons.push(hinge);
  }

  // tailplane with elevator, fin with rudder
  add(new THREE.BoxGeometry(3.4, 0.09, 0.85), cream, 0, 0.08, 3.3);
  const elevator = new THREE.Group();
  elevator.position.set(0, 0.08, 3.73);
  root.add(elevator);
  add(new THREE.BoxGeometry(3.2, 0.07, 0.4), coral, 0, 0, 0.2, elevator);
  const finShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.25, 0), new THREE.Vector2(1.15, 1.4), new THREE.Vector2(0.62, 1.4)]);
  add(new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false }).rotateY(-Math.PI / 2), coral, 0.04, 0.2, 2.72);
  const rudder = new THREE.Group();
  rudder.position.set(0, 0.2, 3.97);
  root.add(rudder);
  add(new THREE.BoxGeometry(0.07, 1.38, 0.36), cream, 0, 0.69, 0.18, rudder);

  // canopy
  const canopy = add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.42, -0.45);
  canopy.scale.set(0.56, 0.52, 1.3);

  // fixed tricycle gear with spatted main wheels
  for (const s of [-1, 1]) {
    const strut = add(new THREE.CylinderGeometry(0.05, 0.06, 0.95, 6), dark, s * 0.9, -0.85, -0.3);
    strut.rotation.z = s * 0.82;
    add(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 12).rotateZ(Math.PI / 2), dark, s * 1.25, -1.23, -0.3);
    const spat = add(new THREE.SphereGeometry(1, 10, 6), coral, s * 1.25, -1.13, -0.32);
    spat.scale.set(0.17, 0.3, 0.62);
  }
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), dark, 0, -0.88, -2.75);
  add(new THREE.CylinderGeometry(0.27, 0.27, 0.15, 12).rotateZ(Math.PI / 2), dark, 0, -1.28, -2.75);

  return { root, prop, disc, elevator, rudder, ailerons };
}

// ---------------------------------------------------------------- wind

/** A wind field from a mission's { from, speed, gust }: steady wind, slow gusts, turbulence. */
export function createWind(def = { from: 0, speed: 0, gust: 0 }) {
  const dir = headingVector(def.from + 180); // air moves toward here
  const [p1, p2] = WIND.gustPeriod;
  const out = new THREE.Vector3();
  const gustAt = (t) => def.gust * Math.max(0, 0.6 * Math.sin((t * 2 * Math.PI) / p1) + 0.4 * Math.sin((t * 2 * Math.PI) / p2 + 1.3));
  return {
    def,
    gustAt,
    /** Air velocity (m/s, world axes) at time t near pos, turbulence fading close to the ground. */
    at(t, pos, agl = 100) {
      const s = def.speed + gustAt(t);
      const tb = def.gust * WIND.turbulenceScale * 6 * clamp(agl / 40, 0, 1);
      out.set(
        dir.x * s + tb * 0.5 * Math.sin(t * 1.9 + pos.z * 0.01),
        tb * 0.5 * (Math.sin(t * 2.3 + pos.x * 0.012) + 0.6 * Math.sin(t * 3.7)),
        dir.z * s + tb * 0.5 * Math.sin(t * 1.6 + pos.x * 0.008),
      );
      out.roll = tb * 0.09 * (Math.sin(t * 2.7 + pos.z * 0.005) + 0.5 * Math.sin(t * 4.3)); // rad/s of upset
      return out;
    },
  };
}

// ---------------------------------------------------------------- the flight model

const f = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const airV = new THREE.Vector3();
const vh = new THREE.Vector3();
const acc = new THREE.Vector3();
const liftDir = new THREE.Vector3();
const omega = new THREE.Vector3();
const dq = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export function createAircraft(world) {
  const model = buildModel();
  const state = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false },
    events: [],
  };

  /** Places the aircraft: { x, z, heading, y?, speed?, throttle?, fuel?, pitch?, bank? }; no y = on the ground. */
  function reset(pose) {
    const onGround = pose.y === undefined;
    const ground = world.surfaceAt(pose.x, pose.z).height;
    Object.assign(state, {
      time: 0, throttle: pose.throttle ?? 0, fuel: pose.fuel ?? 100, damage: 0, rpm: 0.25,
      engineOn: true, onGround, stalled: false, stallWarning: false, crashed: false, crashReason: '',
      brake: false, aoa: 0, groundPitch: 0, surface: 'runway', runway: null, buffet: 0, gLoad: 1,
    });
    state.position.set(pose.x, onGround ? ground + A.gearHeight : pose.y, pose.z);
    euler.set((pose.pitch ?? 0) * DEG, -pose.heading * DEG, -(pose.bank ?? 0) * DEG);
    state.quaternion.setFromEuler(euler);
    f.set(0, 0, -1).applyQuaternion(state.quaternion);
    state.velocity.copy(f).multiplyScalar(pose.speed ?? 0);
    state.events.length = 0;
    updateReadouts(world.surfaceAt(pose.x, pose.z));
  }

  function emit(type, data = {}) {
    state.events.push({ type, ...data });
  }

  function crash(reason, extra = {}) {
    if (state.crashed) return;
    state.crashed = true;
    state.crashReason = reason;
    state.damage = 100;
    state.velocity.set(0, 0, 0);
    state.throttle = 0;
    emit('crash', { reason, ...extra });
  }

  /** Derived readouts: heading, pitch, bank, altitude, speeds, surface. */
  function updateReadouts(surface, wind) {
    f.set(0, 0, -1).applyQuaternion(state.quaternion);
    up.set(0, 1, 0).applyQuaternion(state.quaternion);
    right.set(1, 0, 0).applyQuaternion(state.quaternion);
    airV.copy(state.velocity);
    if (wind) airV.sub(wind);
    state.heading = headingOf(f.x, f.z);
    state.pitch = Math.asin(clamp(f.y, -1, 1)) / DEG;
    state.bank = Math.atan2(-right.y, up.y) / DEG;
    state.altitude = state.position.y;
    state.agl = state.position.y - A.gearHeight - surface.height;
    state.airspeed = airV.length();
    state.groundSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    state.verticalSpeed = state.velocity.y;
    state.surface = surface.kind;
    state.runway = surface.runway;
  }

  /** First contact with the ground: a landing, a hard landing or a crash. */
  function touchdown(surface) {
    const sink = -state.velocity.y;
    const info = {
      sink, airspeed: state.airspeed, groundSpeed: state.groundSpeed, bank: state.bank, pitch: state.pitch,
      heading: state.heading, kind: surface.kind, runway: surface.runway, deadStick: !state.engineOn,
    };
    let reason = '';
    if (surface.kind === 'water') reason = 'water';
    else if (state.pitch < -10 || sink > LANDING.crashSink) reason = 'impact';
    else if (Math.abs(state.bank) > LANDING.maxBankDeg * 1.8) reason = 'wingtip';
    else if (state.airspeed > A.crashSpeed) reason = 'too-fast';
    else if (surface.kind === 'ground' && world.terrain.slopeAt(state.position.x, state.position.z) > 0.3) reason = 'terrain';
    info.hard = !reason && sink > LANDING.goodSink;
    emit('touchdown', info);
    if (reason) return crash(reason, info);
    if (sink > LANDING.hardSink) {
      state.damage = Math.min(100, state.damage + LANDING.hardDamage);
      if (state.damage >= 100) return crash('gear', info);
    }
    state.onGround = true;
    state.groundPitch = clamp(state.pitch * DEG, 0, A.groundPitchMax);
    state.velocity.y = 0;
    state.position.y = surface.height + A.gearHeight;
  }

  function stepGround(dt, c, wind, surface) {
    const heading = Math.atan2(f.x, -f.z);
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    let s = state.velocity.x * fx + state.velocity.z * fz;
    const air = s - (wind.x * fx + wind.z * fz);
    const steer = (c.yaw + 0.5 * c.roll) * A.groundSteerRate * clamp(Math.abs(s) / 5, 0.15, 1) / (1 + Math.abs(s) / 25);
    const newHeading = heading + steer * dt * Math.sign(s || 1);

    const thrust = state.engineOn ? A.maxThrust * state.throttle * Math.max(0.2, 1 - A.thrustFade * Math.abs(air)) : 0;
    const resist = (surface.kind === 'runway' ? A.groundFriction : A.grassFriction) + (c.brake ? A.brakeDecel : 0);
    const drive = thrust - A.dragCoef * air * Math.abs(air);
    if (Math.abs(s) < 0.05 && Math.abs(drive) <= resist) s = 0;
    else {
      const next = s + (drive - resist * Math.sign(s || drive)) * dt;
      s = Math.sign(next) !== Math.sign(s) && s !== 0 && Math.abs(drive) <= resist ? 0 : next;
    }

    // rotation: the nose lifts only once there is flying speed
    if (air > A.rotateSpeed * 0.85 && c.pitch > 0) state.groundPitch += A.pitchRate * 0.5 * c.pitch * dt;
    else state.groundPitch -= (c.pitch < 0 ? 0.6 : 0.25) * dt;
    state.groundPitch = clamp(state.groundPitch, 0, A.groundPitchMax);
    const aoa = state.groundPitch + A.wingIncidence;
    const lift = G * (air / A.stallSpeed) ** 2 * Math.min(aoa / A.stallAoa, 1) * (1 + A.groundEffectLift);

    euler.set(state.groundPitch, -newHeading, 0);
    state.quaternion.setFromEuler(euler);
    state.velocity.set(Math.sin(newHeading) * s, 0, -Math.cos(newHeading) * s);
    state.aoa = aoa;
    state.stalled = false;
    state.stallWarning = false;

    if (lift > G && air > A.rotateSpeed * 0.97) {
      state.onGround = false;
      state.velocity.y = 0.6;
      state.position.y += 0.05;
      emit('liftoff', { speed: air });
      return;
    }
    state.position.x += state.velocity.x * dt;
    state.position.z += state.velocity.z * dt;
    const below = world.surfaceAt(state.position.x, state.position.z);
    state.position.y = below.height + A.gearHeight;
    if (below.kind === 'water') return crash('ditched');
    if (below.kind === 'ground' && Math.abs(s) > 6) {
      state.damage = Math.min(100, state.damage + LANDING.terrainDamagePerSecond * dt * Math.min(1, Math.abs(s) / 25));
      if (world.terrain.slopeAt(state.position.x, state.position.z) > 0.3) return crash('terrain');
      if (state.damage >= 100) return crash('rough');
    }
  }

  function stepAir(dt, c, wind) {
    const speed = airV.length();
    if (speed > 1) vh.copy(airV).divideScalar(speed);
    else vh.copy(f);
    const aoa = Math.atan2(-vh.dot(up), vh.dot(f)) + A.wingIncidence;
    const beta = Math.atan2(vh.dot(right), vh.dot(f));
    const bank = Math.atan2(-right.y, up.y);
    const pitch = Math.asin(clamp(f.y, -1, 1));
    const ratio = speed / A.stallSpeed;
    const qRatio = ratio * ratio;

    // lift: linear up to the stall angle, then it collapses
    let cl = clamp(aoa / A.stallAoa, -1, 1);
    if (aoa > A.stallAoa) cl = Math.max(0.5, 1 - (aoa - A.stallAoa) * 4);
    const agl = Math.max(0, state.position.y - A.gearHeight - world.heightAt(state.position.x, state.position.z));
    const groundEffect = agl < A.groundEffectHeight ? 1 + A.groundEffectLift * (1 - agl / A.groundEffectHeight) : 1;
    const lift = G * qRatio * cl * groundEffect;
    liftDir.copy(up).addScaledVector(vh, -up.dot(vh)).normalize();

    // stall with hysteresis: recovering needs a clearly lower angle and some speed back
    if (state.stalled) state.stalled = aoa > A.stallAoa * 0.8 || speed < A.stallSpeed * 0.97;
    else state.stalled = aoa > A.stallAoa || speed < A.stallSpeed * 0.92;
    state.stallWarning = state.stalled || aoa > A.stallAoa * 0.85 || speed < A.stallSpeed * 1.08;
    state.buffet = state.stallWarning ? clamp((A.stallSpeed * 1.08 - speed) / 6, 0.25, 1) : 0;
    state.aoa = aoa;
    state.gLoad = (lift + 1e-6) / G;

    const thrust = state.engineOn ? A.maxThrust * state.throttle * Math.max(0.2, 1 - A.thrustFade * speed) : 0;
    const drag = A.dragCoef * speed * speed + A.inducedDrag * cl * cl * qRatio * G +
      A.turnBleed * Math.max(0, state.gLoad - 1) * G + (c.brake ? A.airBrakeDrag * speed * speed : 0);
    acc.copy(f).multiplyScalar(thrust)
      .addScaledVector(liftDir, lift)
      .addScaledVector(vh, -drag)
      .addScaledVector(right, -airV.dot(right) * A.sideForce);
    acc.y -= G;
    state.velocity.addScaledVector(acc, dt);
    state.position.addScaledVector(state.velocity, dt);

    // attitude: pilot rates plus stability that keeps the nose on a trimmed path
    const authority = A.minAuthority + (1 - A.minAuthority) * clamp(speed / A.fullAuthoritySpeed, 0, 1);
    const stability = clamp(ratio, 0, 2);
    const turnLoad = 1 / Math.max(Math.cos(bank), 0.4) - 1;
    const trimAoa = clamp(A.stallAoa * (1 + A.turnAssist * turnLoad) / Math.max(qRatio, 0.01), 0, A.stallAoa * 0.8);
    let pitchCmd = c.pitch * A.pitchRate * authority;
    if ((pitch > A.maxClimbPitch && pitchCmd > 0) || (pitch < -A.maxClimbPitch && pitchCmd < 0)) pitchCmd = 0;
    let pitchRate = pitchCmd - (aoa - trimAoa) * A.pitchStability * stability;
    if (state.stalled) pitchRate -= A.stallNoseDrop;
    const rollRate = clamp((c.roll * A.maxBank - bank) * A.bankFollow, -A.rollRate, A.rollRate) * authority + (wind.roll || 0);
    const yawRate = c.yaw * A.yawRate * authority + beta * A.weathervane * clamp(ratio, 0, 1.5);
    omega.set(pitchRate, -yawRate, -rollRate);
    const angle = omega.length() * dt;
    if (angle > 1e-9) {
      dq.setFromAxisAngle(omega.normalize(), angle);
      state.quaternion.multiply(dq).normalize();
    }
  }

  /** Advances the aircraft by dt seconds. controls: { pitch, roll, yaw, throttle (rate -1..1), brake }. */
  function step(dt, controls, wind) {
    state.controls = controls;
    if (state.crashed) return;
    state.time += dt;
    state.brake = controls.brake;
    state.throttle = clamp(state.throttle + controls.throttle * A.throttleRate * dt, 0, 1);
    if (state.engineOn) {
      state.fuel -= (A.fuelBurnIdle + (A.fuelBurnFull - A.fuelBurnIdle) * state.throttle) * dt;
      if (state.fuel <= 0) {
        state.fuel = 0;
        state.engineOn = false;
        emit('fuel-out');
      }
    }
    const rpmTarget = state.engineOn ? 0.25 + 0.75 * state.throttle : Math.min(0.2, state.airspeed / 150 || 0);
    state.rpm += (rpmTarget - state.rpm) * Math.min(1, dt * 2.5);

    f.set(0, 0, -1).applyQuaternion(state.quaternion);
    up.set(0, 1, 0).applyQuaternion(state.quaternion);
    right.set(1, 0, 0).applyQuaternion(state.quaternion);
    airV.copy(state.velocity).sub(wind);

    if (state.onGround) {
      stepGround(dt, controls, wind, world.surfaceAt(state.position.x, state.position.z));
    } else {
      const wasStalled = state.stalled;
      stepAir(dt, controls, wind);
      if (state.stalled && !wasStalled && state.time - (state.lastStallEvent ?? -9) > 3) {
        state.lastStallEvent = state.time;
        emit('stall');
      }
      const surface = world.surfaceAt(state.position.x, state.position.z);
      if (state.position.y - A.gearHeight <= surface.height) {
        updateReadouts(surface, wind);
        touchdown(surface);
      }
    }
    if (!state.crashed) {
      const hit = world.obstacleHit(state.position.x, state.position.y, state.position.z, 3.5);
      if (hit) crash('obstacle', { obstacle: hit.kind });
    }
    updateReadouts(world.surfaceAt(state.position.x, state.position.z), wind);
  }

  /** Moves the 3D model to the state and animates propeller and control surfaces. */
  function syncModel(dt) {
    model.root.position.copy(state.position);
    model.root.quaternion.copy(state.quaternion);
    if (state.crashed) model.root.rotateZ(0.45).rotateX(-0.2); // a wreck sits slumped on one wing
    const c = state.controls;
    model.prop.rotation.z -= dt * (state.crashed ? 0 : 6 + state.rpm * 46);
    model.disc.material.opacity = state.crashed ? 0 : clamp((state.rpm - 0.2) * 0.45, 0, 0.3);
    model.elevator.rotation.x = -c.pitch * 0.35;
    model.rudder.rotation.y = c.yaw * 0.4;
    model.ailerons[0].rotation.x = c.roll * 0.3;
    model.ailerons[1].rotation.x = -c.roll * 0.3;
  }

  return { model: model.root, state, reset, step, syncModel, crash };
}
