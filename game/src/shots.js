// Deterministic screenshot poses chosen by ?shot=title|chase|cockpit|landing (&seed=N).
// Each pose places the aircraft, rings, HUD and camera from world data (so any seed
// works), then keeps the scene alive (propeller, water, clouds, gauges) but frozen.
// Also provides the scenic orbit the title screen flies around the main island.

import * as THREE from 'three';
import { CAMERA, MISSIONS } from './config.js';
import { createMissionRun, windText } from './missions.js';
import { fromRunwayFrame, headingVector } from './terrain.js';

const POSES = ['title', 'chase', 'cockpit', 'landing'];
const DEG = Math.PI / 180;
const f = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const look = new THREE.Vector3();

/** The requested pose and seed from the page's query, or null for normal play. */
export function readShotRequest(params) {
  const pose = params.get('shot');
  if (!POSES.includes(pose)) return null;
  return { pose, seed: Math.max(1, Math.floor(Number(params.get('seed')) || 1)) };
}

/** A slow scenic orbit over Solenne Field that keeps the runway and hills in view. */
export function orbitCamera(camera, world, t) {
  const rw = world.runwayById('main');
  const a = 2.35 + t * 0.012;
  const centre = fromRunwayFrame(rw, 120, 380);
  camera.position.set(centre.x + Math.cos(a) * 1250, rw.elevation + 300, centre.z + Math.sin(a) * 1250);
  look.set(centre.x, rw.elevation + 30, centre.z);
  camera.up.copy(up);
  camera.lookAt(look);
}

/** Places a chase camera relative to the aircraft: back, side (+ right) and up metres; aim ahead and aside. */
function poseChaseCamera(camera, s, world, back, side, height, ahead, aimSide, aimDrop) {
  f.set(0, 0, -1).applyQuaternion(s.quaternion);
  f.y = 0;
  f.normalize();
  right.set(-f.z, 0, f.x);
  camera.position.copy(s.position).addScaledVector(f, -back).addScaledVector(right, side);
  camera.position.y += height;
  camera.position.y = Math.max(camera.position.y, Math.max(0, world.heightAt(camera.position.x, camera.position.z)) + 1.1);
  look.copy(s.position).addScaledVector(f, ahead).addScaledVector(right, aimSide);
  look.y -= aimDrop;
  camera.up.copy(up);
  camera.lookAt(look);
}

/**
 * Builds a pose. ctx: { world, aircraft, rings, cockpit, hud, camera, screens }.
 * Returns { view, showHud, frame(t), hudInfo() }.
 */
export function createShot(pose, ctx) {
  const { world, aircraft, rings, cockpit, hud, camera, screens } = ctx;
  const s = aircraft.state;
  const rw = world.runwayById('main');
  const mission = createMissionRun(0, world, aircraft, rings);
  mission.start();
  hud.setMission(MISSIONS[0].name, windText(MISSIONS[0].wind));
  const shot = { view: 'chase', showHud: true, hint: '', hintTone: '' };
  screens.show(pose === 'title' ? 'title' : null); // the page opens on the title card; flight poses clear it

  if (pose === 'title') {
    shot.view = 'orbit';
    shot.showHud = false;
    rings.setVisible(false);
    screens.renderTitle(0);
  } else if (pose === 'chase') {
    // heading for the base-leg gate ring, Solenne Field's runway beyond it at an angle
    const r = MISSIONS[0].rings[5];
    const d = headingVector(r.heading);
    rings.setActive(5);
    Object.assign(mission.run, { phase: 'rings', passed: 5, time: 196 });
    aircraft.reset({ x: r.x - d.x * 180, z: r.z - d.z * 180, y: r.alt + 3, heading: r.heading, speed: 49, throttle: 0.64, fuel: 58, bank: 4, pitch: 0.5 });
  } else {
    // final approach to runway 07: 3 degree glide (cockpit) or crossing the threshold (landing)
    rings.setActive(MISSIONS[0].rings.length);
    Object.assign(mission.run, { phase: 'landing', passed: 6, time: 238 });
    const out = 250; // cockpit pose: metres before the threshold (about 0.8 km to the field centre)
    const along = pose === 'cockpit' ? -rw.halfLength - out : -rw.halfLength + 3;
    const height = pose === 'cockpit' ? out * Math.tan(3 * DEG) : 2.4;
    const p = fromRunwayFrame(rw, along, 0);
    aircraft.reset({
      x: p.x, z: p.z, y: rw.elevation + 1.55 + height, heading: rw.heading,
      speed: pose === 'cockpit' ? 34 : 30.5, throttle: pose === 'cockpit' ? 0.32 : 0.12, fuel: 44,
      pitch: pose === 'cockpit' ? -2.6 : 3.5,
    });
    s.velocity.y = pose === 'cockpit' ? -1.75 : -0.9;
    s.verticalSpeed = s.velocity.y;
    shot.hint = pose === 'cockpit' ? 'Line up and settle gently' : 'FLARE: ease back on ↑';
    if (pose === 'cockpit') {
      shot.view = 'cockpit';
      aircraft.model.visible = false;
      cockpit.setVisible(true);
      camera.fov = CAMERA.cockpitFov;
    }
  }
  s.rpm = 0.25 + 0.75 * s.throttle;
  camera.updateProjectionMatrix();
  const base = { airspeed: s.airspeed, vs: s.verticalSpeed, pitch: s.pitch, bank: s.bank };
  const eye = new THREE.Vector3();

  return {
    view: shot.view,
    showHud: shot.showHud,
    /** Holds the pose and its camera; only tiny needle motion so the gauges look alive. */
    frame(t) {
      s.airspeed = base.airspeed + 0.15 * Math.sin(t * 1.3);
      s.verticalSpeed = base.vs + 0.08 * Math.sin(t * 0.9);
      s.pitch = base.pitch + 0.1 * Math.sin(t * 0.7);
      s.bank = base.bank + 0.2 * Math.sin(t * 0.5);
      if (shot.view === 'orbit') orbitCamera(camera, world, t);
      else if (shot.view === 'cockpit') {
        camera.position.copy(s.position).add(eye.copy(cockpit.eye).applyQuaternion(s.quaternion));
        camera.quaternion.copy(s.quaternion);
      } else if (pose === 'chase') poseChaseCamera(camera, s, world, 20, 3, 5.5, 80, 6, 9);
      else poseChaseCamera(camera, s, world, 15, -3.5, 0.2, 45, -1, 3.2);
    },
    hudInfo: () => ({ ...mission.objective(), time: mission.timeText(), hint: shot.hint, hintTone: shot.hintTone }),
  };
}
