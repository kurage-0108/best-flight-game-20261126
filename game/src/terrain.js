// The seeded heightfield and surface queries: island shapes, hills, runway
// flattening, and helpers for runway-relative coordinates. Pure maths, no
// rendering, so the flight model, missions and world builder all share it.

import { ISLANDS, RUNWAYS, RUNWAY_SITE, WORLD } from './config.js';
import { createRng, createValueNoise2D, deriveSeed, fractalNoise } from './random.js';

const DEG = Math.PI / 180;

/** Smoothstep from edge0 to edge1 (edges may be given in either order). */
export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Unit ground vector for a compass heading in degrees (0 north = -Z, 90 east = +X). */
export function headingVector(deg) {
  return { x: Math.sin(deg * DEG), z: -Math.cos(deg * DEG) };
}

/** Compass heading in degrees [0, 360) of a ground direction. */
export function headingOf(dx, dz) {
  return ((Math.atan2(dx, -dz) / DEG) % 360 + 360) % 360;
}

/** A point in runway coordinates: along (+ toward the heading) and across (+ to the right). */
export function toRunwayFrame(runway, x, z) {
  const f = headingVector(runway.heading);
  const dx = x - runway.x;
  const dz = z - runway.z;
  return { along: dx * f.x + dz * f.z, across: dx * -f.z + dz * f.x };
}

/** The world point at runway coordinates (along, across). */
export function fromRunwayFrame(runway, along, across) {
  const f = headingVector(runway.heading);
  return { x: runway.x + f.x * along - f.z * across, z: runway.z + f.z * along + f.x * across };
}

export function createTerrain(seed) {
  const noise = createValueNoise2D(deriveSeed(seed, 11));
  const coastNoise = createValueNoise2D(deriveSeed(seed, 12));
  const rng = createRng(deriveSeed(seed, 13));
  const seabed = WORLD.seabed;

  const islands = ISLANDS.map((isl) => ({
    ...isl,
    phases: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)],
    amps: [rng.range(0.1, 0.17), rng.range(0.05, 0.1), rng.range(0.03, 0.06)],
    reach: isl.radius * WORLD.terrainMargin,
  }));

  /** One island's height at (x, z): shelf, plateau, hills and noise; seabed when far. */
  function islandHeight(isl, x, z) {
    const dx = x - isl.x;
    const dz = z - isl.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > isl.reach * isl.reach) return seabed;
    const d = Math.sqrt(d2);
    const ang = Math.atan2(dz, dx);
    const wobble = 1 +
      isl.amps[0] * Math.sin(2 * ang + isl.phases[0]) +
      isl.amps[1] * Math.sin(3 * ang + isl.phases[1]) +
      isl.amps[2] * Math.sin(5 * ang + isl.phases[2]) +
      0.08 * coastNoise(x * 0.004, z * 0.004);
    const t = d / (isl.radius * wobble);
    const land = smoothstep(1.0, 0.55, t);
    let h = isl.shelf * (1 - t) + isl.plateau * land;
    h += (seabed - h) * smoothstep(1.12, 1.75, t);
    const onIsland = smoothstep(1.08, 0.8, t);
    let hills = 0;
    for (const p of isl.peaks) {
      const pd = Math.hypot(x - p.x, z - p.z) / p.r;
      if (pd < 1) {
        const s = 1 - pd;
        hills += p.h * s * s * (3 - 2 * s);
      }
    }
    h += hills * onIsland;
    if (t < 1.1) {
      const n = fractalNoise(noise, x * 0.0035, z * 0.0035, 4);
      h += n * (7 + 0.15 * hills) * smoothstep(1.05, 0.6, t);
    }
    return h;
  }

  /** Height before any runway flattening: the highest island wins. */
  function naturalHeight(x, z) {
    let h = seabed;
    for (const isl of islands) {
      const ih = islandHeight(isl, x, z);
      if (ih > h) h = ih;
    }
    return h;
  }

  const runways = RUNWAYS.map((rw) => ({
    ...rw,
    halfLength: rw.length / 2,
    halfWidth: rw.width / 2,
    elevation: Math.max(RUNWAY_SITE.minElevation, naturalHeight(rw.x, rw.z)),
  }));

  /** Ground height in metres above sea level at (x, z), runway sites flattened. */
  function heightAt(x, z) {
    let h = naturalHeight(x, z);
    for (const rw of runways) {
      const p = toRunwayFrame(rw, x, z);
      const da = Math.max(0, Math.abs(p.along) - rw.halfLength - RUNWAY_SITE.flattenAlong);
      const dc = Math.max(0, Math.abs(p.across) - rw.halfWidth - RUNWAY_SITE.flattenAcross);
      const dist = Math.hypot(da, dc);
      if (dist < RUNWAY_SITE.blendDistance) {
        const w = 1 - smoothstep(0, RUNWAY_SITE.blendDistance, dist);
        h += (rw.elevation - h) * w;
      }
    }
    return h;
  }

  /** The runway whose paved surface contains (x, z), or null. */
  function runwayAt(x, z) {
    for (const rw of runways) {
      const p = toRunwayFrame(rw, x, z);
      if (Math.abs(p.along) <= rw.halfLength && Math.abs(p.across) <= rw.halfWidth) return rw;
    }
    return null;
  }

  /** What lies at (x, z): its height and kind ('runway', 'ground' or 'water'). */
  function surfaceAt(x, z) {
    const height = heightAt(x, z);
    const runway = runwayAt(x, z);
    if (runway) return { height: runway.elevation, kind: 'runway', runway };
    if (height <= 0) return { height: 0, kind: 'water', runway: null };
    return { height, kind: 'ground', runway: null };
  }

  /** Ground slope at (x, z) as rise over run, sampled `step` metres apart. */
  function slopeAt(x, z, step = 4) {
    const gx = heightAt(x + step, z) - heightAt(x - step, z);
    const gz = heightAt(x, z + step) - heightAt(x, z - step);
    return Math.hypot(gx, gz) / (2 * step);
  }

  /** The grid extent covering every island and its shelf. */
  function bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const isl of islands) {
      minX = Math.min(minX, isl.x - isl.reach);
      maxX = Math.max(maxX, isl.x + isl.reach);
      minZ = Math.min(minZ, isl.z - isl.reach);
      maxZ = Math.max(maxZ, isl.z + isl.reach);
    }
    return { minX, maxX, minZ, maxZ };
  }

  return {
    seed,
    islands,
    runways,
    runwayById: (id) => runways.find((r) => r.id === id),
    islandByName: (name) => islands.find((i) => i.name === name),
    heightAt,
    runwayAt,
    surfaceAt,
    slopeAt,
    bounds,
  };
}
