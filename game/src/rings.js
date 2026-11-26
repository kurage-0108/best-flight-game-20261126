// A mission's target rings: glowing tori on marker posts, flown in order. The
// active ring pulses and carries a light pillar; passed rings dim. Detects passes
// (crossing the ring plane inside its radius), clipped rims and post strikes.

import * as THREE from 'three';
import { RINGS } from './config.js';
import { headingVector } from './terrain.js';

const DEG = Math.PI / 180;
const LOOK = {
  active: { color: '#ffc24a', halo: 0.34 },
  next: { color: '#fff4dc', halo: 0.12 },
  waiting: { color: '#f1e6cf', halo: 0 },
  passed: { color: '#6fe0c4', halo: 0 },
};

export function createRingCourse(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const postMat = new THREE.MeshLambertMaterial({ color: '#f2ede2' });
  const bandMat = new THREE.MeshLambertMaterial({ color: '#e4553f' });
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 1, 10, 1, true).translate(0, 0.5, 0),
    new THREE.MeshBasicMaterial({ color: '#ffc24a', transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  scene.add(pillar);
  const course = { rings: [], active: 0, passed: 0, done: false };
  const seg = new THREE.Vector3();
  const hit = new THREE.Vector3();

  function clear() {
    for (const r of course.rings) group.remove(r.root);
    course.rings = [];
    course.active = 0;
    course.passed = 0;
    course.done = false;
  }

  /** Builds the rings for a mission's ring list ({ x, z, alt, heading, radius? }). */
  function load(defs) {
    clear();
    defs.forEach((def, index) => {
      const radius = def.radius ?? RINGS.defaultRadius;
      const dir = headingVector(def.heading);
      const center = new THREE.Vector3(def.x, def.alt, def.z);
      const root = new THREE.Group();
      root.position.copy(center);
      const facing = new THREE.Group();
      facing.rotation.y = -def.heading * DEG; // the torus axis (local Z) lies along the heading
      root.add(facing);
      const mat = new THREE.MeshBasicMaterial({ color: LOOK.waiting.color, transparent: true, opacity: 0.9 });
      const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, RINGS.tube, 8, 44), mat);
      const haloMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const halo = new THREE.Mesh(new THREE.TorusGeometry(radius, RINGS.tube * 3.2, 8, 44), haloMat);
      const veil = new THREE.Mesh(
        new THREE.CircleGeometry(radius - RINGS.tube, 40),
        new THREE.MeshBasicMaterial({ color: '#fff0c8', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      facing.add(torus, halo, veil);

      // marker post from the ground (or sea) up to the rim, striped like a buoy mast
      const base = Math.max(0, world.heightAt(def.x, def.z)) - 1;
      const top = def.alt - radius - RINGS.tube;
      const postLength = Math.max(0, top - base);
      if (postLength > 0.5) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(RINGS.postWidth * 0.5, RINGS.postWidth * 0.7, postLength, 8), postMat);
        post.position.y = (base + top) / 2 - def.alt;
        root.add(post);
        for (let y = base + 6; y < top - 2; y += 12) {
          const band = new THREE.Mesh(new THREE.CylinderGeometry(RINGS.postWidth * 0.62, RINGS.postWidth * 0.62, 4, 8), bandMat);
          band.position.y = y - def.alt;
          root.add(band);
        }
      }
      group.add(root);
      course.rings.push({ index, def, radius, center, normal: new THREE.Vector3(dir.x, 0, dir.z), postTop: top, root, torus, halo, veil, passed: false });
    });
    refreshLooks();
  }

  function refreshLooks() {
    for (const r of course.rings) {
      const look = r.passed ? LOOK.passed : r.index === course.active ? LOOK.active : r.index === course.active + 1 ? LOOK.next : LOOK.waiting;
      r.torus.material.color.set(look.color);
      r.torus.material.opacity = r.passed ? 0.35 : r.index > course.active + 1 ? 0.55 : 0.95;
      r.halo.material.opacity = look.halo;
    }
    const a = activeRing();
    pillar.visible = !!a;
    if (a) {
      const ground = Math.max(0, world.heightAt(a.center.x, a.center.z));
      pillar.position.set(a.center.x, ground, a.center.z);
      pillar.scale.y = a.center.y + a.radius + 30 - ground; // a beacon: surface to just above the rim
    }
  }

  function activeRing() {
    return course.done ? null : course.rings[course.active] ?? null;
  }

  /** Makes ring `index` the active one (earlier rings count as passed); used by screenshot poses. */
  function setActive(index) {
    course.active = Math.min(index, course.rings.length);
    course.passed = course.active;
    course.rings.forEach((r) => (r.passed = r.index < course.active));
    course.done = course.active >= course.rings.length;
    refreshLooks();
  }

  /**
   * Checks the segment from `prev` to `pos` this step. Returns null, or one event:
   * { type: 'ring', index, clipped, centred, last } or { type: 'post', index }.
   */
  function check(prev, pos) {
    for (const r of course.rings) {
      const dx = pos.x - r.center.x;
      const dz = pos.z - r.center.z;
      if (pos.y < r.postTop && dx * dx + dz * dz < (RINGS.postWidth + 2.5) ** 2) return { type: 'post', index: r.index };
    }
    const a = activeRing();
    if (!a) return null;
    const d0 = seg.copy(prev).sub(a.center).dot(a.normal);
    const d1 = seg.copy(pos).sub(a.center).dot(a.normal);
    if (d0 === d1 || d0 * d1 > 0 || Math.abs(d0 - d1) > 60) return null;
    hit.copy(prev).lerp(pos, d0 / (d0 - d1));
    const off = hit.distanceTo(a.center);
    if (off > a.radius + RINGS.tube + 2.5) return null;
    a.passed = true;
    course.passed++;
    course.active++;
    course.done = course.active >= course.rings.length;
    refreshLooks();
    return { type: 'ring', index: a.index, clipped: off > a.radius - 1, centred: off < a.radius * 0.35, last: course.done };
  }

  /** Pulses the active ring and its pillar. */
  function update(time) {
    const a = activeRing();
    if (!a) return;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    a.halo.material.opacity = LOOK.active.halo * (0.6 + 0.8 * pulse);
    a.halo.scale.setScalar(1 + 0.03 * pulse);
    a.veil.material.opacity = 0.05 + 0.05 * pulse;
    pillar.material.opacity = 0.07 + 0.06 * pulse;
    const next = course.rings[course.active + 1];
    if (next) next.veil.material.opacity = 0;
  }

  return {
    course,
    load,
    clear,
    check,
    update,
    setActive,
    activeRing,
    /** Straight-line distance in metres from `pos` to the active ring, or null when done. */
    distanceToActive: (pos) => (activeRing() ? pos.distanceTo(activeRing().center) : null),
    setVisible(v) {
      group.visible = v;
      pillar.visible = v && !!activeRing();
    },
  };
}
