// Boot and orchestration: renderer, scene and camera; the state machine
// (title → briefing → flying ⇄ paused → results); the fixed-step loop; chase and
// cockpit cameras; resize; and the wiring between the game's modules.

import * as THREE from 'three';
import { CAMERA, MISSIONS, SIM } from './config.js';
import { createInput } from './input.js';
import { buildWorld } from './world.js';
import { createAircraft, createWind } from './aircraft.js';
import { createRingCourse } from './rings.js';
import { createCockpit } from './cockpit.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createMissionRun, missionStartPose, windText } from './missions.js';
import { createScreens } from './screens.js';
import { createShot, orbitCamera, readShotRequest } from './shots.js';

const params = new URLSearchParams(location.search);
const shot = readShotRequest(params);
const seed = shot ? shot.seed : Math.max(1, Math.floor(Number(params.get('seed')) || 1));
if (shot) document.body.classList.add('shot-mode');

// ---------------------------------------------------------------- setup

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!shot });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('view').append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, CAMERA.near, CAMERA.far);
scene.add(camera); // the cockpit rides on the camera

const world = buildWorld(scene, seed);
const aircraft = createAircraft(world);
scene.add(aircraft.model);
const s = aircraft.state;
const rings = createRingCourse(scene, world);
const cockpit = createCockpit(camera);
const hud = createHud();
const audio = createAudio({ enabled: !shot });
const input = shot ? null : createInput(window);

const game = { mode: 'title', selected: 0, view: 'chase', mission: null, wind: createWind(), windNow: { x: 0, y: 0, z: 0 }, clock: 0, flightTime: 0, resultsAt: 0 };

const screens = createScreens({
  select: (i) => {
    game.selected = i;
    screens.renderTitle(i);
  },
  brief: () => enterBriefing(),
  start: () => startMission(game.selected),
  title: () => enterTitle(),
  retry: () => startMission(game.mission ? game.mission.run.index : game.selected),
  next: () => startMission(Math.min(MISSIONS.length - 1, (game.mission?.run.index ?? -1) + 1)),
  resume: () => setPaused(false),
});

// ---------------------------------------------------------------- state machine

function showScreen(name) {
  screens.show(name);
  document.activeElement?.blur?.(); // so Enter is never also a click on a focused button
}

function setView(view) {
  game.view = view;
  const inside = view === 'cockpit';
  aircraft.model.visible = !inside;
  cockpit.setVisible(inside);
  camera.fov = inside ? CAMERA.cockpitFov : CAMERA.fov;
  camera.updateProjectionMatrix();
}

function enterTitle() {
  game.mode = 'title';
  game.mission = null;
  aircraft.reset(missionStartPose(MISSIONS[game.selected], world));
  rings.clear();
  rings.setVisible(false);
  setView('chase');
  hud.setVisible(false);
  audio.setFlying(false);
  audio.setPaused(false);
  screens.renderTitle(game.selected);
  showScreen('title');
}

function enterBriefing() {
  game.mode = 'briefing';
  screens.renderBriefing(game.selected, world);
  showScreen('briefing');
}

function startMission(index) {
  game.selected = index;
  game.mission = createMissionRun(index, world, aircraft, rings);
  game.mission.start();
  game.wind = createWind(MISSIONS[index].wind);
  game.flightTime = 0;
  game.resultsAt = 0;
  game.mode = 'flying';
  rings.setVisible(true);
  hud.setMission(MISSIONS[index].name, windText(MISSIONS[index].wind));
  hud.setVisible(true);
  setView(game.view);
  snapChase = true;
  audio.setFlying(true);
  audio.setPaused(false);
  input.reset();
  showScreen(null);
}

function setPaused(paused) {
  if (paused && game.mode === 'flying') {
    game.mode = 'paused';
    showScreen('pause');
  } else if (!paused && game.mode === 'paused') {
    game.mode = 'flying';
    showScreen(null);
  } else return;
  audio.setPaused(paused);
}

function showResults() {
  game.mode = 'results';
  hud.setVisible(false);
  audio.setFlying(false);
  screens.renderResults(game.mission.run.result);
  showScreen('results');
}

function handleKeys() {
  const k = (...codes) => codes.some((c) => input.wasPressed(c));
  if (game.mode === 'title') {
    const n = MISSIONS.length;
    if (k('ArrowDown', 'ArrowRight')) screens.renderTitle((game.selected = (game.selected + 1) % n));
    if (k('ArrowUp', 'ArrowLeft')) screens.renderTitle((game.selected = (game.selected + n - 1) % n));
    MISSIONS.forEach((_, i) => k(`Digit${i + 1}`) && screens.renderTitle((game.selected = i)));
    if (k('Enter', 'Space')) enterBriefing();
    if (game.mode === 'title' && (k('ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight') || MISSIONS.some((_, i) => k(`Digit${i + 1}`)))) {
      aircraft.reset(missionStartPose(MISSIONS[game.selected], world));
    }
  } else if (game.mode === 'briefing') {
    if (k('Enter', 'Space')) startMission(game.selected);
    else if (k('Escape')) enterTitle();
  } else if (game.mode === 'flying') {
    if (k('KeyC')) setView(game.view === 'chase' ? 'cockpit' : 'chase');
    if (k('KeyP', 'Escape')) setPaused(true);
    else if (k('KeyR')) startMission(game.mission.run.index);
  } else if (game.mode === 'paused') {
    if (k('KeyP', 'Escape')) setPaused(false);
    else if (k('KeyR')) startMission(game.mission.run.index);
  } else if (game.mode === 'results') {
    const r = game.mission.run.result;
    if (k('Enter', 'Space')) startMission(r.success && r.hasNext ? r.index + 1 : r.index);
    else if (k('KeyR')) startMission(r.index);
    else if (k('Escape')) enterTitle();
  }
}

// ---------------------------------------------------------------- simulation

function readControls() {
  const stick = input.mouseStick();
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return {
    pitch: clamp(input.axis(['ArrowDown'], ['ArrowUp']) - stick.y * 0.8),
    roll: clamp(input.axis(['ArrowLeft'], ['ArrowRight']) + stick.x * 0.8),
    yaw: input.axis(['KeyA'], ['KeyD']),
    throttle: input.axis(['KeyS'], ['KeyW']),
    brake: input.isDown('KeyB'),
  };
}

function physicsStep(dt) {
  game.windNow = game.wind.at(game.flightTime, s.position, s.agl);
  game.flightTime += dt;
  aircraft.step(dt, readControls(), game.windNow);
  const events = s.events.splice(0);
  audio.handleEvents(events);
  for (const n of game.mission.step(dt, events)) {
    hud.flash(n.text, n.tone, n.seconds);
    if (n.sound) audio.play(n.sound);
  }
  const result = game.mission.run.result;
  if (result && !game.resultsAt) {
    game.resultsAt = game.clock + (result.success ? 2.4 : 3);
    if (s.crashed && game.view === 'cockpit') setView('chase'); // show what happened
  }
}

// ---------------------------------------------------------------- cameras

const chaseOffset = new THREE.Vector3();
const desired = new THREE.Vector3();
const fwd = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const eye = new THREE.Vector3();
let snapChase = true;

/** Chase view: the offset swings smoothly behind the nose (yaw and gentle pitch, never roll), so it never lags at speed. */
function updateChaseCamera(dt) {
  fwd.set(0, 0, -1).applyQuaternion(s.quaternion);
  const flat = Math.hypot(fwd.x, fwd.z) || 1;
  desired.set((-fwd.x / flat) * CAMERA.chaseDistance, CAMERA.chaseHeight - fwd.y * CAMERA.chaseDistance * 0.5, (-fwd.z / flat) * CAMERA.chaseDistance);
  if (snapChase) chaseOffset.copy(desired);
  else chaseOffset.lerp(desired, 1 - Math.exp(-CAMERA.chaseLag * dt));
  snapChase = false;
  camera.position.copy(s.position).add(chaseOffset);
  const floor = Math.max(0, world.heightAt(camera.position.x, camera.position.z)) + 1.5;
  if (camera.position.y < floor) camera.position.y = floor;
  lookAt.copy(s.position).addScaledVector(fwd, CAMERA.chaseLookAhead * 0.35);
  lookAt.y += 1.2;
  if (s.buffet && !s.crashed) camera.position.addScaledVector(fwd.set(Math.random() - 0.5, Math.random() - 0.5, 0), s.buffet * 0.12);
  camera.up.set(0, 1, 0);
  camera.lookAt(lookAt);
}

function updateCockpitCamera() {
  camera.position.copy(s.position).add(eye.copy(cockpit.eye).applyQuaternion(s.quaternion));
  camera.quaternion.copy(s.quaternion);
  if (s.buffet && !s.crashed) camera.rotateX((Math.random() - 0.5) * s.buffet * 0.006);
}

// ---------------------------------------------------------------- the loop

const shotPose = shot ? createShot(shot.pose, { world, aircraft, rings, cockpit, hud, camera, screens }) : null;
if (shot) {
  hud.setVisible(shotPose.showHud);
} else {
  enterTitle();
  const wake = () => audio.start();
  window.addEventListener('keydown', wake);
  window.addEventListener('pointerdown', wake);
}

let last = performance.now();
let accumulator = 0;
let frames = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, SIM.maxFrameTime);
  last = now;
  game.clock += dt;

  if (shotPose) {
    shotPose.frame(game.clock);
  } else {
    handleKeys();
    if (game.mode === 'flying') {
      accumulator += dt;
      while (accumulator >= SIM.fixedStep) {
        physicsStep(SIM.fixedStep);
        accumulator -= SIM.fixedStep;
      }
      if (game.resultsAt && game.clock >= game.resultsAt) showResults();
    } else accumulator = 0;
  }

  aircraft.syncModel(game.mode === 'paused' ? 0 : dt);
  const flying = game.mode === 'flying' || game.mode === 'paused' || game.mode === 'results';
  if (shotPose) {
    // the pose placed the camera
  } else if (!flying) orbitCamera(camera, world, game.clock);
  else if (game.view === 'cockpit') updateCockpitCamera();
  else updateChaseCamera(dt);

  world.update(dt, game.clock, camera, s.position, game.windNow);
  rings.update(game.clock);
  if (cockpit.group.visible) cockpit.update(s, game.clock);
  if (shotPose?.showHud) hud.update(dt, s, shotPose.hudInfo());
  else if (game.mode === 'flying' && game.mission) {
    const run = game.mission.run;
    hud.update(dt, s, { ...game.mission.objective(), time: game.mission.timeText(), hint: run.hint, hintTone: run.hintTone });
  }
  audio.update(s);

  renderer.render(scene, camera);
  input?.endFrame();
  if (shot && ++frames === 3) document.body.dataset.shotReady = 'true';
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

requestAnimationFrame(frame);
