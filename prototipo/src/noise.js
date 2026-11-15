// Ruído determinístico para o relevo ilustrativo e as texturas. Sem dependências.

const UINT32_MAX = 4294967295;
const LACUNARITY = 2.03;
const GAIN = 0.5;
const OCTAVE_SEED_STEP = 17;

function hash(ix, iz, seed) {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / UINT32_MAX;
}

const smooth = (t) => t * t * (3 - 2 * t);
const wrap = (value, period) => (period > 0 ? ((value % period) + period) % period : value);

// Ruído de valor em [0, 1]. Com `period` > 0 o padrão se repete (textura ladrilhável).
export function valueNoise(x, z, seed = 0, period = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const x0 = wrap(ix, period);
  const x1 = wrap(ix + 1, period);
  const z0 = wrap(iz, period);
  const z1 = wrap(iz + 1, period);
  const a = hash(x0, z0, seed);
  const b = hash(x1, z0, seed);
  const c = hash(x0, z1, seed);
  const d = hash(x1, z1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// Soma de oitavas, normalizada para [0, 1].
export function fbm(x, z, octaves, seed = 0) {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * valueNoise(x * frequency, z * frequency, seed + octave * OCTAVE_SEED_STEP);
    norm += amplitude;
    amplitude *= GAIN;
    frequency *= LACUNARITY;
  }
  return sum / norm;
}

// Variante com cristas (bom para morros e escarpas), em [0, 1].
export function ridged(x, z, octaves, seed = 0) {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    const n = valueNoise(x * frequency, z * frequency, seed + octave * OCTAVE_SEED_STEP);
    const ridge = 1 - Math.abs(2 * n - 1);
    sum += amplitude * ridge * ridge;
    norm += amplitude;
    amplitude *= GAIN;
    frequency *= LACUNARITY;
  }
  return sum / norm;
}

// Gerador pseudoaleatório com semente, para espalhar rochas sempre do mesmo jeito.
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / (UINT32_MAX + 1);
  };
}
