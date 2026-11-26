// Seeded randomness: a mulberry32 generator, convenience helpers on top of it,
// and a smooth 2D value noise for terrain. Same seed, same world.

/** mulberry32: a tiny, fast 32-bit generator returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes a seed with extra integers so sub-systems get independent streams. */
export function deriveSeed(seed, ...salts) {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (const s of salts) {
    h = Math.imul(h ^ (s >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** A generator with helpers: range, int, pick, chance, signed. */
export function createRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    signed: () => next() * 2 - 1,
  };
}

/** Hash of a lattice point to [0, 1). */
function latticeValue(seed, ix, iy) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [-1, 1], continuous everywhere, seeded. */
export function createValueNoise2D(seed) {
  const s = seed | 0;
  return function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = latticeValue(s, ix, iy);
    const b = latticeValue(s, ix + 1, iy);
    const c = latticeValue(s, ix, iy + 1);
    const d = latticeValue(s, ix + 1, iy + 1);
    const top = a + (b - a) * ux;
    const bottom = c + (d - c) * ux;
    return (top + (bottom - top) * uy) * 2 - 1;
  };
}

/** Fractal sum of a noise function: `octaves` layers, each finer and fainter. */
export function fractalNoise(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
