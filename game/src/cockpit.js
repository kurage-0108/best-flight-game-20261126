// The cockpit view: a canopy frame, coaming and an instrument panel that ride on
// the camera. The panel is a canvas texture redrawn every frame: six backlit
// gauges (airspeed, attitude, altimeter, fuel, heading, vertical speed), warning
// lamps, an engine readout and the throttle quadrant.

import * as THREE from 'three';
import { CAMERA, UNITS } from './config.js';

const DEG = Math.PI / 180;
const W = 1024;
const H = 400;
const R = 84;
const GAUGE = { asi: [118, 104], att: [310, 104], alt: [502, 104], fuel: [118, 296], hdg: [310, 296], vsi: [502, 296] };
const INK = '#f3ead8';
const GLOW = 'rgba(255,214,150,0.85)';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const polar = (cx, cy, r, deg) => [cx + r * Math.sin(deg * DEG), cy - r * Math.cos(deg * DEG)];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// ---------------------------------------------------------------- drawing helpers

function glow(g, on = true, blur = 6) {
  g.shadowColor = GLOW;
  g.shadowBlur = on ? blur : 0;
}

function tick(g, cx, cy, r0, r1, deg, width = 2, color = INK) {
  const [x0, y0] = polar(cx, cy, r0, deg);
  const [x1, y1] = polar(cx, cy, r1, deg);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function arc(g, cx, cy, r, deg0, deg1, width, color) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.arc(cx, cy, r, (deg0 - 90) * DEG, (deg1 - 90) * DEG);
  g.stroke();
}

function text(g, s, x, y, size = 17, color = INK, weight = 'bold') {
  g.fillStyle = color;
  g.font = `${weight} ${size}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

function bezel(g, cx, cy) {
  const ring = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  ring.addColorStop(0, '#6b717a');
  ring.addColorStop(0.5, '#2c3036');
  ring.addColorStop(1, '#4b5058');
  g.fillStyle = ring;
  g.beginPath();
  g.arc(cx, cy, R + 7, 0, Math.PI * 2);
  g.fill();
  const face = g.createRadialGradient(cx, cy - 20, 10, cx, cy, R);
  face.addColorStop(0, '#20252b');
  face.addColorStop(1, '#07090b');
  g.fillStyle = face;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#16181c';
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.beginPath();
    g.arc(cx + dx * (R + 3), cy + dy * (R + 3), 4, 0, Math.PI * 2);
    g.fill();
  }
}

function needle(g, cx, cy, len, deg, color = '#fbf6ea', width = 6) {
  g.save();
  g.translate(cx, cy);
  g.rotate(deg * DEG);
  glow(g, true, 5);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-width / 2, 14);
  g.lineTo(-1.2, -len);
  g.lineTo(1.2, -len);
  g.lineTo(width / 2, 14);
  g.closePath();
  g.fill();
  glow(g, false);
  g.fillStyle = '#30343a';
  g.beginPath();
  g.arc(0, 0, 7, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------- dial scales

const asiAngle = (kt) => -150 + (clamp(kt, 0, 160) / 160) * 300;
const vsiAngle = (fpm) => -90 + (clamp(fpm, -2000, 2000) / 2000) * 170;
const fuelAngle = (pct) => -120 + (clamp(pct, 0, 100) / 100) * 240;

function drawStaticPanel(g) {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#3a3f47');
  bg.addColorStop(1, '#22262c');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 2;
  g.strokeRect(6, 6, W - 12, H - 12);
  g.strokeRect(596, 18, 290, H - 36);
  for (const [cx, cy] of Object.values(GAUGE)) bezel(g, cx, cy);
  glow(g);

  // airspeed: white flap arc, green normal, yellow caution, red never-exceed
  let [cx, cy] = GAUGE.asi;
  arc(g, cx, cy, R - 13, asiAngle(42), asiAngle(85), 5, '#f2f2f2');
  arc(g, cx, cy, R - 7, asiAngle(50), asiAngle(115), 6, '#3fd16b');
  arc(g, cx, cy, R - 7, asiAngle(115), asiAngle(140), 6, '#ffc93c');
  tick(g, cx, cy, R - 14, R - 2, asiAngle(145), 4, '#ff4a3a');
  for (let kt = 0; kt <= 160; kt += 10) tick(g, cx, cy, R - (kt % 20 ? 10 : 17), R - 2, asiAngle(kt), kt % 20 ? 1.5 : 2.5);
  for (let kt = 20; kt <= 160; kt += 20) text(g, String(kt), ...polar(cx, cy, R - 32, asiAngle(kt)), 15);
  text(g, 'AIRSPEED', cx, cy - 26, 11);
  text(g, 'KNOTS', cx, cy + 30, 11);

  // altimeter: 1000 ft per turn of the long hand
  [cx, cy] = GAUGE.alt;
  for (let i = 0; i < 50; i++) tick(g, cx, cy, R - (i % 5 ? 8 : 16), R - 2, i * 7.2, i % 5 ? 1.5 : 2.5);
  for (let n = 0; n < 10; n++) text(g, String(n), ...polar(cx, cy, R - 30, n * 36), 19);
  text(g, 'ALT', cx, cy - 26, 11);
  text(g, 'FEET', cx, cy + 32, 11);

  // vertical speed: zero at nine o'clock, hundreds of feet per minute
  [cx, cy] = GAUGE.vsi;
  for (let v = -2000; v <= 2000; v += 100) tick(g, cx, cy, R - (v % 500 ? 9 : 17), R - 2, vsiAngle(v), v % 500 ? 1.5 : 2.5);
  for (const v of [0, 5, 10, 15, 20]) {
    text(g, String(v), ...polar(cx, cy, R - 31, vsiAngle(v * 100)), 15);
    if (v) text(g, String(v), ...polar(cx, cy, R - 31, vsiAngle(-v * 100)), 15);
  }
  text(g, 'UP', cx - 22, cy - 30, 11);
  text(g, 'DN', cx - 22, cy + 30, 11);
  text(g, 'VERT SPEED', cx + 14, cy - 12, 10);
  text(g, '100 FT/MIN', cx + 14, cy + 12, 10);

  // fuel
  [cx, cy] = GAUGE.fuel;
  arc(g, cx, cy, R - 8, fuelAngle(0), fuelAngle(15), 7, '#ff4a3a');
  for (let p = 0; p <= 100; p += 12.5) tick(g, cx, cy, R - (p % 25 ? 10 : 18), R - 2, fuelAngle(p), p % 25 ? 1.5 : 3);
  text(g, 'E', ...polar(cx, cy, R - 34, fuelAngle(0)), 20);
  text(g, '½', ...polar(cx, cy, R - 34, fuelAngle(50)), 20);
  text(g, 'F', ...polar(cx, cy, R - 34, fuelAngle(100)), 20);
  text(g, 'FUEL', cx, cy + 34, 12);

  // throttle quadrant slot
  g.fillStyle = '#121418';
  g.fillRect(926, 52, 20, 300);
  text(g, 'THR', 936, 32, 14);
  text(g, 'IDLE', 936, 372, 11, '#9aa0a8');
  glow(g, false);
  text(g, 'SUNWARD COURIER  SC-2', 740, 382, 11, '#8d939b', 'normal');
}

function drawCompassCard() {
  const [c, g] = makeCanvas(2 * R, 2 * R);
  glow(g);
  for (let d = 0; d < 360; d += 5) tick(g, R, R, R - (d % 10 ? 8 : 15), R - 2, d, d % 10 ? 1.5 : 2.5);
  const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = 0; d < 360; d += 30) {
    g.save();
    g.translate(R, R);
    g.rotate(d * DEG);
    text(g, names[d] ?? String(d / 10), 0, -(R - 30), names[d] ? 21 : 16, names[d] ? '#ffcf73' : INK);
    g.restore();
  }
  return c;
}

// ---------------------------------------------------------------- live instruments

function drawAttitude(g, pitch, bank) {
  const [cx, cy] = GAUGE.att;
  const k = 2.4; // pixels per degree of pitch
  g.save();
  g.beginPath();
  g.arc(cx, cy, R - 3, 0, Math.PI * 2);
  g.clip();
  g.translate(cx, cy);
  g.rotate(-bank * DEG);
  const off = clamp(pitch, -40, 40) * k;
  g.fillStyle = '#2e89cf';
  g.fillRect(-2 * R, off - 3 * R, 4 * R, 3 * R);
  g.fillStyle = '#80522c';
  g.fillRect(-2 * R, off, 4 * R, 3 * R);
  glow(g, true, 4);
  g.fillStyle = INK;
  g.fillRect(-2 * R, off - 1.5, 4 * R, 3);
  for (let p = -30; p <= 30; p += 5) {
    if (!p) continue;
    const y = off - p * k;
    const half = p % 10 ? 10 : 24;
    g.fillRect(-half, y - 1, half * 2, 2);
    if (!(p % 10)) {
      text(g, String(Math.abs(p)), -half - 12, y, 11);
      text(g, String(Math.abs(p)), half + 12, y, 11);
    }
  }
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(0, -(R - 20));
  g.lineTo(-7, -(R - 8));
  g.lineTo(7, -(R - 8));
  g.closePath();
  g.fill();
  g.restore();
  glow(g, true, 4);
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) tick(g, cx, cy, R - 8, R - (d % 30 ? 2 : -2), d, d ? 2 : 3.5);
  g.strokeStyle = '#ff9f3a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(cx - 46, cy);
  g.lineTo(cx - 16, cy);
  g.lineTo(cx - 8, cy + 9);
  g.moveTo(cx + 46, cy);
  g.lineTo(cx + 16, cy);
  g.lineTo(cx + 8, cy + 9);
  g.stroke();
  g.fillStyle = '#ff9f3a';
  g.beginPath();
  g.arc(cx, cy, 4, 0, Math.PI * 2);
  g.fill();
  glow(g, false);
}

function drawHeading(g, card, heading) {
  const [cx, cy] = GAUGE.hdg;
  g.save();
  g.translate(cx, cy);
  g.rotate(-heading * DEG);
  g.drawImage(card, -R, -R);
  g.restore();
  glow(g, true, 5);
  g.fillStyle = '#ff9f3a';
  g.beginPath();
  g.moveTo(cx, cy - R + 16);
  g.lineTo(cx - 7, cy - R + 2);
  g.lineTo(cx + 7, cy - R + 2);
  g.closePath();
  g.fill();
  // little aircraft in the middle
  g.fillRect(cx - 2, cy - 18, 4, 34);
  g.fillRect(cx - 18, cy - 4, 36, 5);
  g.fillRect(cx - 8, cy + 12, 16, 4);
  glow(g, false);
  text(g, String(Math.round(heading) % 360).padStart(3, '0'), cx, cy + 34, 13, '#ffcf73');
}

function lamp(g, x, y, label, on, color) {
  g.fillStyle = on ? color : '#1a1c20';
  g.shadowColor = color;
  g.shadowBlur = on ? 16 : 0;
  g.fillRect(x, y, 132, 44);
  g.shadowBlur = 0;
  g.strokeStyle = '#0c0d10';
  g.lineWidth = 3;
  g.strokeRect(x, y, 132, 44);
  text(g, label, x + 66, y + 23, 16, on ? '#1b0f08' : '#4c5057');
}

/** Builds the cockpit and parents it to `camera`; call update(state, time) every frame. */
export function createCockpit(camera) {
  const group = new THREE.Group();
  group.visible = false;
  camera.add(group);

  const [staticCanvas, sg] = makeCanvas(W, H);
  drawStaticPanel(sg);
  const card = drawCompassCard();
  const [canvas, g] = makeCanvas(W, H);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  // sized so the whole panel fits the bottom third of the view at the cockpit FOV
  const panelWidth = 0.86;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelWidth, (panelWidth * H) / W), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  panel.position.set(0, -0.338, -0.78);
  panel.rotation.x = -0.06;
  const trim = new THREE.MeshLambertMaterial({ color: '#2b2f36' });
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.62, 0.3), trim);
  coaming.position.set(0, -0.47, -0.95);
  const glareshield = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.26), new THREE.MeshLambertMaterial({ color: '#1d2025' }));
  glareshield.position.set(0, -0.14, -0.75);
  const frameMat = new THREE.MeshLambertMaterial({ color: '#d9d0bd' });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.03, 6, 40, Math.PI), frameMat);
  bow.position.set(0, -0.5, -0.9);
  const rails = [-1, 1].map((s) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.6), frameMat);
    rail.position.set(s * 1.1, -0.48, -0.2);
    return rail;
  });
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.99, 28),
    new THREE.MeshBasicMaterial({ color: '#d5d9dc', transparent: true, opacity: 0, depthWrite: false }),
  );
  disc.position.set(0, -0.2, -3.4);
  group.add(coaming, panel, glareshield, bow, ...rails, disc);

  /** Redraws the panel from the aircraft state. */
  function update(state, time) {
    g.drawImage(staticCanvas, 0, 0);
    const kt = state.airspeed * UNITS.MS_TO_KT;
    const ft = state.altitude * UNITS.M_TO_FT;
    const fpm = state.verticalSpeed * UNITS.MS_TO_FPM;
    needle(g, ...GAUGE.asi, R - 12, asiAngle(kt));
    drawAttitude(g, state.pitch, state.bank);
    const [ax, ay] = GAUGE.alt;
    needle(g, ax, ay, R - 42, ((ft % 10000) / 10000) * 360, '#d9d2c2', 9);
    needle(g, ax, ay, R - 12, ((ft % 1000) / 1000) * 360);
    needle(g, ...GAUGE.fuel, R - 16, fuelAngle(state.fuel), '#ffcf73');
    drawHeading(g, card, state.heading);
    needle(g, ...GAUGE.vsi, R - 12, vsiAngle(fpm));

    const blink = Math.sin(time * 18) > 0;
    lamp(g, 612, 34, 'STALL', state.stallWarning && (blink || !state.stalled), '#ff4a3a');
    lamp(g, 748, 34, 'LOW FUEL', state.fuel < 15 && (state.fuel > 5 || blink), '#ffb43a');
    lamp(g, 612, 92, 'ENGINE', !state.engineOn, '#ff4a3a');
    lamp(g, 748, 92, 'BRAKE', state.brake, '#ffb43a');
    lamp(g, 612, 150, 'DAMAGE', state.damage >= 30, '#ffb43a');
    lamp(g, 748, 150, 'GROUND', state.onGround, '#5fe08a');

    g.fillStyle = '#0b0d10';
    g.fillRect(612, 214, 268, 140);
    glow(g, true, 6);
    const amber = '#ffb84a';
    g.textAlign = 'left';
    g.font = 'bold 26px monospace';
    g.fillStyle = amber;
    g.fillText(`RPM  ${String(Math.round(state.rpm * 2700)).padStart(4, ' ')}`, 628, 244);
    g.fillText(`FUEL ${state.fuel.toFixed(1).padStart(5, ' ')}%`, 628, 284);
    g.fillText(`G    ${state.gLoad.toFixed(1).padStart(4, ' ')}`, 628, 324);
    const knobY = 352 - state.throttle * 300;
    g.fillStyle = '#ec5641';
    g.fillRect(912, knobY - 12, 48, 24);
    glow(g, false);
    text(g, `${Math.round(state.throttle * 100)}%`, 990, knobY, 14);
    texture.needsUpdate = true;

    disc.material.opacity = state.crashed ? 0 : clamp((state.rpm - 0.2) * 0.15, 0, 0.1);
  }

  return {
    group,
    eye: new THREE.Vector3(...CAMERA.cockpitEye),
    update,
    setVisible(v) {
      group.visible = v;
    },
  };
}
