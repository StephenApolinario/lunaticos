// Projeção local: plano tangente em torno do centro da área de estudo.
// x aponta para leste, z para sul (norte é -z), y para cima. Tudo em metros.

export const MARS_RADIUS_M = 3_389_500;
const DEG = Math.PI / 180;

export const ORIGIN = Object.freeze({ lat: -4.77, lon: 137.394 });
const M_PER_DEG_LAT = MARS_RADIUS_M * DEG;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(ORIGIN.lat * DEG);

// Área coberta pelos dados reais (grade das rotas do artifact original).
export const DATA_BOUNDS = Object.freeze({ south: -4.82, north: -4.72, west: 137.37, east: 137.418 });

// A altitude de Marte aqui é negativa (cerca de -4144 m no habitat).
// O deslocamento só deixa a cena perto da origem em y.
const ELEVATION_OFFSET_M = 4200;
export const elevToY = (elevM) => elevM + ELEVATION_OFFSET_M;
export const yToElev = (y) => y - ELEVATION_OFFSET_M;

export function toLocal(lat, lon) {
  return {
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

export function toGeo(x, z) {
  return {
    lat: ORIGIN.lat - z / M_PER_DEG_LAT,
    lon: ORIGIN.lon + x / M_PER_DEG_LON,
  };
}

// Rumo em graus a partir do norte, no sentido horário (90 = leste).
export function headingDeg(dx, dz) {
  const deg = Math.atan2(dx, -dz) / DEG;
  return (deg + 360) % 360;
}

// Menor diferença angular de `from` até `to`, entre -180 e 180.
export function angleDeltaDeg(from, to) {
  return ((to - from + 540) % 360) - 180;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;
