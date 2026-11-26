// Builds the world with Three.js: sky, sun, lights, ocean, the seeded island
// terrain, both runway strips with markings and lights, an airfield hangar,
// villages, trees, a lighthouse and drifting clouds. Returns what the rest of
// the game needs: terrain queries, runways, islands, obstacle checks, update().

import * as THREE from 'three';
import { HANGAR, LIGHTHOUSE, RUNWAY_SITE, VILLAGES, WORLD } from './config.js';
import { createRng, createValueNoise2D, deriveSeed } from './random.js';
import { createTerrain, fromRunwayFrame, headingVector, toRunwayFrame } from './terrain.js';

const C = WORLD.colors;
const DEG = Math.PI / 180;
const color = (hex) => new THREE.Color(hex);

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

// ---------------------------------------------------------------- obstacles

/** A spatial hash of upright obstacles (cylinders: x, z, radius, top height). */
function createObstacleGrid(cellSize = 80) {
  const cells = new Map();
  const key = (ix, iz) => ix * 100003 + iz;
  return {
    add(x, z, radius, top, kind) {
      const k = key(Math.floor(x / cellSize), Math.floor(z / cellSize));
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push({ x, z, radius, top, kind });
    },
    /** The obstacle a sphere of radius `pad` at (x, y, z) touches, or null. */
    hit(x, y, z, pad = 0) {
      const ix = Math.floor(x / cellSize);
      const iz = Math.floor(z / cellSize);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const list = cells.get(key(ix + a, iz + b));
          if (!list) continue;
          for (const o of list) {
            if (y - pad < o.top && Math.hypot(x - o.x, z - o.z) < o.radius + pad) return o;
          }
        }
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------- sky

function buildSky(scene) {
  const geo = new THREE.SphereGeometry(WORLD.skyRadius, 32, 18);
  const zenith = color(C.zenith);
  const horizon = color(C.horizon);
  const below = color(C.fog);
  const pos = geo.attributes.position;
  const cols = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / WORLD.skyRadius;
    if (y < 0) c.copy(horizon).lerp(below, Math.min(1, -y * 4));
    else c.copy(horizon).lerp(zenith, Math.pow(y, 0.5));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -2;
  scene.add(sky);

  const sunTex = canvasTexture(128, 128, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,245,1)');
    grad.addColorStop(0.12, 'rgba(255,250,225,1)');
    grad.addColorStop(0.3, 'rgba(255,236,180,0.35)');
    grad.addColorStop(1, 'rgba(255,230,170,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  sun.scale.setScalar(2600);
  sun.renderOrder = -1;
  scene.add(sun);
  return { sky, sun };
}

function buildLights(scene, sunDir) {
  const hemi = new THREE.HemisphereLight('#cfeaff', '#6f8f5a', 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(C.sun, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = s.bottom = -70;
  s.right = s.top = 70;
  s.near = 10;
  s.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  sun.position.copy(sunDir).multiplyScalar(400);
  scene.add(sun, sun.target);
  return sun;
}

// ---------------------------------------------------------------- sea

function buildOcean(scene) {
  const ripples = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    const rng = createRng(77);
    for (let i = 0; i < 260; i++) {
      const x = rng.range(0, w);
      const y = rng.range(0, h);
      const rx = rng.range(6, 26);
      const shade = rng.chance(0.5) ? `rgba(200,225,235,${rng.range(0.25, 0.55)})` : `rgba(255,255,255,${rng.range(0.3, 0.6)})`;
      g.fillStyle = shade;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        g.beginPath();
        g.ellipse(x + ox, y + oy, rx, rx * 0.28, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
  ripples.wrapS = ripples.wrapT = THREE.RepeatWrapping;
  ripples.repeat.set(WORLD.oceanSize / 90, WORLD.oceanSize / 90);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.oceanSize, WORLD.oceanSize),
    new THREE.MeshPhongMaterial({ color: C.ocean, map: ripples, transparent: true, opacity: 0.8, shininess: 90, specular: '#d9f6ff' }),
  );
  water.rotation.x = -Math.PI / 2;
  water.receiveShadow = true;
  scene.add(water);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.oceanSize, WORLD.oceanSize), new THREE.MeshLambertMaterial({ color: C.deepFloor }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = WORLD.seabed - 1;
  scene.add(floor);
  return { water, ripples };
}

// ---------------------------------------------------------------- terrain

/** A face's colour from its height, its normal's up component and a grove-variation value. */
function terrainColor(P, h, ny, variation, out) {
  if (h < -0.3) return out.copy(P.shallowSand).lerp(P.deepFloor, Math.min(1, -h / 16));
  if (h < 2.6 && ny > 0.86) return out.copy(P.beach);
  if (ny < 0.74) return out.copy(P.rock).lerp(P.rockDark, Math.min(1, (0.74 - ny) * 3 + h / 400));
  if (h < 75) return out.copy(P.grassLight).lerp(P.grassDark, 0.5 + variation * 0.5);
  if (h < 165) return out.copy(P.grassDark).lerp(P.forest, 0.4 + variation * 0.4);
  return out.copy(P.rock).lerp(P.grassDark, Math.max(0, 0.3 - (h - 165) / 200));
}

function buildTerrainMesh(terrain, seed) {
  const b = terrain.bounds();
  const nx = Math.min(WORLD.terrainMaxCells, Math.ceil((b.maxX - b.minX) / WORLD.terrainCell));
  const nz = Math.min(WORLD.terrainMaxCells, Math.ceil((b.maxZ - b.minZ) / WORLD.terrainCell));
  const dx = (b.maxX - b.minX) / nx;
  const dz = (b.maxZ - b.minZ) / nz;
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) heights[j * (nx + 1) + i] = terrain.heightAt(b.minX + i * dx, b.minZ + j * dz);

  const variationNoise = createValueNoise2D(deriveSeed(seed, 21));
  const rng = createRng(deriveSeed(seed, 22));
  const palette = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, color(v)]));
  const pos = [];
  const nor = [];
  const col = [];
  const deep = WORLD.seabed + 0.6;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  const c = new THREE.Color();
  const corner = (i, j, v) => v.set(b.minX + i * dx, heights[j * (nx + 1) + i], b.minZ + j * dz);
  const tri = (p, q, r) => {
    e1.subVectors(q, p);
    e2.subVectors(r, p);
    n.crossVectors(e1, e2).normalize();
    const h = (p.y + q.y + r.y) / 3;
    const cx = (p.x + q.x + r.x) / 3;
    const cz = (p.z + q.z + r.z) / 3;
    terrainColor(palette, h, n.y, variationNoise(cx * 0.006, cz * 0.006), c);
    c.multiplyScalar(0.95 + rng.next() * 0.1);
    for (const v of [p, q, r]) {
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
    }
  };
  const vd = new THREE.Vector3();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const h00 = heights[j * (nx + 1) + i];
      const h10 = heights[j * (nx + 1) + i + 1];
      const h01 = heights[(j + 1) * (nx + 1) + i];
      const h11 = heights[(j + 1) * (nx + 1) + i + 1];
      if (h00 < deep && h10 < deep && h01 < deep && h11 < deep) continue; // the seabed plane covers it
      corner(i, j, va);
      corner(i + 1, j, vb);
      corner(i, j + 1, vc);
      corner(i + 1, j + 1, vd);
      if ((i + j) % 2 === 0) {
        tri(va, vc, vb);
        tri(vb, vc, vd);
      } else {
        tri(va, vc, vd);
        tri(va, vd, vb);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- runways

function runwayNumber(heading) {
  const n = Math.round(heading / 10) % 36 || 36;
  return String(n).padStart(2, '0');
}

function drawRunwayTexture(rw, seed) {
  const W = 256;
  const H = rw.length > 800 ? 2048 : 1024;
  return canvasTexture(W, H, (g) => {
    const mx = W / rw.width; // pixels per metre across
    const my = H / rw.length; // pixels per metre along
    const rng = createRng(deriveSeed(seed, 31, rw.length));
    g.fillStyle = C.asphalt;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      g.fillRect(rng.range(0, W), rng.range(0, H), rng.range(2, 9), rng.range(2, 9));
    }
    // tyre marks in each touchdown zone
    g.fillStyle = 'rgba(15,15,15,0.28)';
    for (const end of [0, 1]) for (let k = 0; k < 14; k++) {
      const along = rng.range(rw.length * 0.12, rw.length * 0.3);
      const y = end ? along * my : H - along * my;
      g.fillRect(W / 2 + rng.range(-5, 5) * mx - 6, y, 4, rng.range(15, 50) * my);
    }
    g.fillStyle = '#f4f4ee';
    const rect = (across, along, w, l) => g.fillRect(W / 2 + (across - w / 2) * mx, H - (along + l) * my, w * mx, l * my);
    const both = (across, along, w, l) => {
      rect(across, along, w, l);
      rect(across, rw.length - along - l, w, l);
    };
    // edge lines
    rect(-rw.width / 2 + 1, 0, 0.9, rw.length);
    rect(rw.width / 2 - 1, 0, 0.9, rw.length);
    // threshold piano keys
    const keys = rw.width > 28 ? 8 : 6;
    const keyW = 1.8;
    const span = rw.width - 6;
    for (let k = 0; k < keys; k++) {
      const across = -span / 2 + (k + 0.5) * (span / keys);
      both(across, 6, keyW, 30);
    }
    // designators: the number you read on approach to each end
    const drawNumber = (text, along, flip) => {
      g.save();
      g.translate(W / 2, H - along * my);
      if (flip) g.rotate(Math.PI);
      g.scale(1, (my / mx) * 2.0);
      g.font = `bold ${Math.floor(rw.width * 0.42 * mx)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillText(text, 0, 0);
      g.restore();
    };
    drawNumber(runwayNumber(rw.heading), 42, false);
    drawNumber(runwayNumber(rw.heading + 180), rw.length - 42, true);
    // centreline
    const startC = 72;
    for (let a = startC; a < rw.length - startC - 30; a += 50) rect(0, a, 0.9, 30);
    // touchdown zone and aiming point
    const aim = Math.min(300, rw.length * 0.25);
    both(-rw.width * 0.27, aim, rw.width * 0.14, Math.min(45, rw.length * 0.07));
    both(rw.width * 0.27, aim, rw.width * 0.14, Math.min(45, rw.length * 0.07));
    for (const a of [aim * 0.5, aim * 1.5]) {
      both(-rw.width * 0.27, a, rw.width * 0.1, 22);
      both(rw.width * 0.27, a, rw.width * 0.1, 22);
    }
  });
}

function buildRunway(group, rw, seed) {
  const tex = drawRunwayTexture(rw, seed);
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(rw.width, rw.length),
    new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  strip.rotation.order = 'YXZ';
  strip.rotation.set(-Math.PI / 2, -rw.heading * DEG, 0);
  strip.position.set(rw.x, rw.elevation + 0.08, rw.z);
  strip.receiveShadow = true;
  group.add(strip);

  // small, low, warm-white edge lights along both sides of the paved strip
  const spots = [];
  for (let a = -rw.halfLength; a <= rw.halfLength + 0.1; a += RUNWAY_SITE.edgeLightSpacing) {
    for (const side of [-1, 1]) spots.push(fromRunwayFrame(rw, a, side * (rw.halfWidth + 1.2)));
  }
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.28, 0.22), new THREE.MeshBasicMaterial({ color: '#ffe3a6' }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => lights.setMatrixAt(i, m.makeTranslation(p.x, rw.elevation + 0.14, p.z)));
  group.add(lights);

  // windsock beside the start end
  const sockSpot = fromRunwayFrame(rw, -rw.halfLength + 140, -(rw.halfWidth + 34));
  const sock = new THREE.Group();
  sock.position.set(sockSpot.x, rw.elevation, sockSpot.z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 7, 6), new THREE.MeshLambertMaterial({ color: '#d9d9d9' }));
  pole.position.y = 3.5;
  const swivel = new THREE.Group();
  swivel.position.y = 6.8;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.75, 4, 8, 1, true), new THREE.MeshLambertMaterial({ color: '#ff7a3d', side: THREE.DoubleSide }));
  cone.rotation.x = -Math.PI / 2; // tip points along -Z (downwind once the swivel turns)
  cone.position.z = -2;
  const droop = new THREE.Group();
  droop.add(cone);
  swivel.add(droop);
  sock.add(pole, swivel);
  group.add(sock);
  return { swivel, droop };
}

function buildHangar(group, rw, obstacles) {
  const spot = fromRunwayFrame(rw, HANGAR.along, HANGAR.across);
  const yaw = -rw.heading * DEG + Math.PI / 2; // door (local -Z) faces the runway
  const hangar = new THREE.Group();
  hangar.position.set(spot.x, rw.elevation, spot.z);
  hangar.rotation.y = yaw;
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(70, 60), new THREE.MeshLambertMaterial({ color: '#9b9a94', polygonOffset: true, polygonOffsetFactor: -1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, 0.06, -18);
  apron.receiveShadow = true;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(34, 8, 26), new THREE.MeshLambertMaterial({ color: '#e9e4d8' }));
  walls.position.y = 4;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 34, 12, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: '#c8603a', flatShading: true }));
  roof.rotation.z = Math.PI / 2; // barrel runs along the 34 m side
  roof.scale.set(0.45, 1, 1); // squash the dome's height
  roof.position.y = 8;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(22, 7), new THREE.MeshLambertMaterial({ color: '#3a4652' }));
  door.position.set(0, 3.6, -13.05);
  door.rotation.y = Math.PI;
  for (const part of [walls, roof]) part.castShadow = part.receiveShadow = true;
  hangar.add(apron, walls, roof, door);
  group.add(hangar);
  obstacles.add(spot.x, spot.z, 20, rw.elevation + 14, 'hangar');
}

/** True when (x, z) is in the obstacle-free zone around any runway. */
function inRunwayClearZone(terrain, x, z) {
  for (const rw of terrain.runways) {
    const p = toRunwayFrame(rw, x, z);
    if (Math.abs(p.along) < rw.halfLength + RUNWAY_SITE.clearAlong && Math.abs(p.across) < rw.halfWidth + RUNWAY_SITE.clearAcross) return true;
    if (rw.id === HANGAR.runway && Math.abs(p.along - HANGAR.along) < 60 && Math.abs(p.across - HANGAR.across) < 50) return true;
  }
  return false;
}

// ---------------------------------------------------------------- villages and trees

function buildVillages(group, terrain, seed, obstacles, taken) {
  const rng = createRng(deriveSeed(seed, 41));
  const houses = [];
  for (const v of VILLAGES) {
    let placed = 0;
    for (let tries = 0; tries < v.houses * 30 && placed < v.houses; tries++) {
      const r = v.radius * Math.sqrt(rng.next());
      const a = rng.range(0, Math.PI * 2);
      const x = v.x + Math.cos(a) * r;
      const z = v.z + Math.sin(a) * r;
      const h = terrain.heightAt(x, z);
      if (h < 2.5 || h > 70 || terrain.slopeAt(x, z, 6) > 0.32 || inRunwayClearZone(terrain, x, z)) continue;
      if (houses.some((o) => Math.hypot(o.x - x, o.z - z) < 17)) continue;
      const w = rng.range(7, 12);
      const d = rng.range(6, 10);
      const wallH = rng.range(4, 6.5);
      houses.push({ x, z, y: h - 0.8, w, d, wallH, roofH: rng.range(2.4, 3.6), yaw: rng.range(0, Math.PI) });
      placed++;
    }
  }
  const wallGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const roofGeo = new THREE.ConeGeometry(0.78, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial(), houses.length);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ flatShading: true }), houses.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const wallTints = ['#f6f1e7', '#fbf7ee', '#f3ead8', '#eef3f2'];
  const roofTints = ['#c8603a', '#b9532f', '#d2704a', '#c25a3c'];
  houses.forEach((hs, i) => {
    q.setFromAxisAngle(up, hs.yaw);
    m.compose(p.set(hs.x, hs.y, hs.z), q, s.set(hs.w, hs.wallH + 0.8, hs.d));
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, color(rng.pick(wallTints)));
    m.compose(p.set(hs.x, hs.y + hs.wallH + 0.8, hs.z), q, s.set(hs.w, hs.roofH, hs.d));
    roofs.setMatrixAt(i, m);
    roofs.setColorAt(i, color(rng.pick(roofTints)));
    obstacles.add(hs.x, hs.z, Math.max(hs.w, hs.d) * 0.6, hs.y + hs.wallH + hs.roofH + 0.8, 'house');
    taken.push({ x: hs.x, z: hs.z, r: 12 });
  });
  for (const part of [walls, roofs]) part.castShadow = part.receiveShadow = true;
  group.add(walls, roofs);
}

function buildTrees(group, terrain, seed, obstacles, taken) {
  const rng = createRng(deriveSeed(seed, 51));
  const grove = createValueNoise2D(deriveSeed(seed, 52));
  const palms = [];
  const leafy = [];
  for (const isl of terrain.islands) {
    const area = Math.PI * (isl.radius / 1000) ** 2;
    const attempts = Math.ceil(area * WORLD.treeCountPerKm2 * 2.2);
    for (let k = 0; k < attempts; k++) {
      const r = isl.radius * 1.25 * Math.sqrt(rng.next());
      const a = rng.range(0, Math.PI * 2);
      const x = isl.x + Math.cos(a) * r;
      const z = isl.z + Math.sin(a) * r;
      const h = terrain.heightAt(x, z);
      if (h < 0.9 || h > 210 || grove(x * 0.004, z * 0.004) < -0.25) continue;
      if (terrain.slopeAt(x, z) > 0.65 || inRunwayClearZone(terrain, x, z)) continue;
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r)) continue;
      const tree = { x, z, y: h, scale: rng.range(0.75, 1.3), yaw: rng.range(0, Math.PI * 2), lean: rng.range(-0.12, 0.12) };
      if (h < 5 || (h < 50 && rng.chance(0.35))) palms.push(tree);
      else leafy.push(tree);
    }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const trunkMat = new THREE.MeshLambertMaterial({ color: C.trunk, flatShading: true });
  const addSet = (list, trunkGeo, crownGeo, crownColor, crownY, trunkH) => {
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: crownColor, flatShading: true }), list.length);
    const tint = new THREE.Color();
    list.forEach((t, i) => {
      e.set(t.lean, t.yaw, t.lean * 0.5);
      q.setFromEuler(e);
      m.compose(p.set(t.x, t.y - 0.3, t.z), q, s.setScalar(t.scale));
      trunks.setMatrixAt(i, m);
      const top = new THREE.Vector3(0, crownY, 0).applyQuaternion(q).multiplyScalar(t.scale);
      m.compose(p.set(t.x + top.x, t.y - 0.3 + top.y, t.z + top.z), q, s.setScalar(t.scale));
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, tint.set(crownColor).multiplyScalar(0.85 + rng.next() * 0.3));
      obstacles.add(t.x, t.z, 2.5 * t.scale, t.y + trunkH * t.scale + 2, 'tree');
    });
    for (const part of [trunks, crowns]) part.castShadow = true;
    group.add(trunks, crowns);
  };
  const palmTrunk = new THREE.CylinderGeometry(0.22, 0.34, 9, 5).translate(0, 4.5, 0);
  const palmCrown = new THREE.ConeGeometry(3.6, 1.6, 7).translate(0, -0.3, 0);
  addSet(palms, palmTrunk, palmCrown, C.palm, 9, 9);
  const leafyTrunk = new THREE.CylinderGeometry(0.3, 0.45, 3.2, 5).translate(0, 1.6, 0);
  const leafyCrown = new THREE.IcosahedronGeometry(3.2, 0).scale(1, 1.15, 1);
  addSet(leafy, leafyTrunk, leafyCrown, C.leafy, 5.4, 7);
  return palms.length + leafy.length;
}

// ---------------------------------------------------------------- lighthouse

function buildLighthouse(group, terrain, obstacles, taken) {
  const isl = terrain.islandByName(LIGHTHOUSE.island);
  const dir = headingVector(LIGHTHOUSE.bearing);
  let best = isl.radius * 0.5;
  for (let d = isl.radius * 0.5; d < isl.radius * 1.6; d += 10) {
    if (terrain.heightAt(isl.x + dir.x * d, isl.z + dir.z * d) > 3) best = d;
  }
  const x = isl.x + dir.x * (best - 30);
  const z = isl.z + dir.z * (best - 30);
  const y = terrain.heightAt(x, z) - 0.5;
  const tower = new THREE.Group();
  tower.position.set(x, y, z);
  const bands = 6;
  const bandH = LIGHTHOUSE.height / bands;
  for (let k = 0; k < bands; k++) {
    const r0 = 3.4 - (k / bands) * 1.2;
    const r1 = 3.4 - ((k + 1) / bands) * 1.2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, bandH, 12), new THREE.MeshLambertMaterial({ color: k % 2 ? '#f7f3ea' : '#d8352b' }));
    band.position.y = bandH * (k + 0.5);
    band.castShadow = true;
    tower.add(band);
  }
  const top = LIGHTHOUSE.height;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.5, 12), new THREE.MeshLambertMaterial({ color: '#2d3438' }));
  gallery.position.y = top + 0.25;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 10), new THREE.MeshBasicMaterial({ color: '#fff3b0' }));
  lamp.position.y = top + 1.7;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.2, 10), new THREE.MeshLambertMaterial({ color: '#d8352b' }));
  cap.position.y = top + 4;
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(5, 70, 12, 1, true).translate(0, -35, 0).rotateZ(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = top + 1.7;
  const cottage = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), new THREE.MeshLambertMaterial({ color: C.houseWall }));
  cottage.position.set(8, 2, 3);
  const cottageRoof = new THREE.Mesh(new THREE.ConeGeometry(6, 2.5, 4).rotateY(Math.PI / 4), new THREE.MeshLambertMaterial({ color: C.roof, flatShading: true }));
  cottageRoof.scale.set(1, 1, 0.75);
  cottageRoof.position.set(8, 5.2, 3);
  cottage.castShadow = cottageRoof.castShadow = true;
  tower.add(gallery, lamp, cap, beam, cottage, cottageRoof);
  group.add(tower);
  obstacles.add(x, z, 6, y + top + 5, 'lighthouse');
  taken.push({ x, z, r: 25 });
  return { beam, position: new THREE.Vector3(x, y + top, z) };
}

// ---------------------------------------------------------------- clouds

function buildClouds(scene, seed) {
  const rng = createRng(deriveSeed(seed, 61));
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#b7c6d6', emissiveIntensity: 0.45, flatShading: true });
  const clouds = [];
  for (let k = 0; k < WORLD.cloudCount; k++) {
    const cloud = new THREE.Group();
    const puffs = rng.int(4, 8);
    const size = rng.range(45, 95);
    for (let i = 0; i < puffs; i++) {
      const puff = new THREE.Mesh(geo, mat);
      const s = size * rng.range(0.55, 1);
      puff.scale.set(s * rng.range(1, 1.5), s * rng.range(0.45, 0.7), s * rng.range(0.9, 1.3));
      puff.position.set(rng.signed() * size * 1.4, rng.range(0, size * 0.35), rng.signed() * size * 0.8);
      cloud.add(puff);
    }
    cloud.position.set(rng.signed() * WORLD.cloudArea, rng.range(...WORLD.cloudAltitude), rng.signed() * WORLD.cloudArea);
    cloud.rotation.y = rng.range(0, Math.PI);
    scene.add(cloud);
    clouds.push(cloud);
  }
  return clouds;
}

// ---------------------------------------------------------------- the world

/** Builds everything into `scene` from `seed` and returns the world's queries and update(). */
export function buildWorld(scene, seed = 1) {
  const terrain = createTerrain(seed);
  const sunDir = new THREE.Vector3(...WORLD.sunDirection).normalize();
  scene.background = color(C.fog);
  scene.fog = new THREE.Fog(C.fog, WORLD.fogNear, WORLD.fogFar);

  const { sky, sun: sunSprite } = buildSky(scene);
  const sunLight = buildLights(scene, sunDir);
  const ocean = buildOcean(scene);
  scene.add(buildTerrainMesh(terrain, seed));

  const props = new THREE.Group();
  scene.add(props);
  const obstacles = createObstacleGrid();
  const taken = [];
  const socks = terrain.runways.map((rw) => buildRunway(props, rw, seed));
  buildHangar(props, terrain.runwayById(HANGAR.runway), obstacles);
  const lighthouse = buildLighthouse(props, terrain, obstacles, taken);
  buildVillages(props, terrain, seed, obstacles, taken);
  const treeCount = buildTrees(props, terrain, seed, obstacles, taken);
  const clouds = buildClouds(scene, seed);

  const focus = new THREE.Vector3();
  /**
   * Animates the living parts: water ripples, drifting clouds, windsocks, the lighthouse
   * beam; keeps the sky on the camera and the sun's shadow box on `focusPoint`.
   * wind: { x, z } in m/s (the direction the air moves).
   */
  function update(dt, time, camera, focusPoint, wind = { x: 0, z: 0 }) {
    sky.position.copy(camera.position);
    sunSprite.position.copy(camera.position).addScaledVector(sunDir, WORLD.skyRadius * 0.85);
    focus.copy(focusPoint);
    sunLight.target.position.copy(focus);
    sunLight.position.copy(focus).addScaledVector(sunDir, 400);

    ocean.ripples.offset.set((time * 0.006) % 1, (time * 0.004) % 1);
    ocean.water.material.opacity = 0.8 + Math.sin(time * 0.4) * 0.015;

    const area = WORLD.cloudArea;
    for (const cloud of clouds) {
      cloud.position.x += (wind.x * 0.6 + 1.2) * dt;
      cloud.position.z += (wind.z * 0.6 + 0.4) * dt;
      if (cloud.position.x > area) cloud.position.x -= 2 * area;
      if (cloud.position.x < -area) cloud.position.x += 2 * area;
      if (cloud.position.z > area) cloud.position.z -= 2 * area;
      if (cloud.position.z < -area) cloud.position.z += 2 * area;
    }

    const windSpeed = Math.hypot(wind.x, wind.z);
    for (const s of socks) {
      if (windSpeed > 0.2) s.swivel.rotation.y = Math.atan2(-wind.x, -wind.z);
      const lift = Math.min(1, windSpeed / 8);
      s.droop.rotation.x = -(1 - lift) * 1.1 + Math.sin(time * 3.1) * 0.05 * lift;
    }
    lighthouse.beam.rotation.y = time * 0.9;
  }

  return {
    terrain,
    heightAt: terrain.heightAt,
    surfaceAt: terrain.surfaceAt,
    runways: terrain.runways,
    runwayById: terrain.runwayById,
    islands: terrain.islands,
    sunDirection: sunDir,
    sunLight,
    lighthouse: lighthouse.position,
    treeCount,
    /** The obstacle (house, tree, hangar, lighthouse) a sphere at (x, y, z) touches, or null. */
    obstacleHit: (x, y, z, pad) => obstacles.hit(x, y, z, pad),
    update,
  };
}
