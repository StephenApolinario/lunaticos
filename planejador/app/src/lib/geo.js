export const RM = 3389.5 // raio médio de Marte, km
// L.Circle e outras rotinas do Leaflet usam o raio da Terra internamente
export const EARTH_K = 6371008.8 / (RM * 1000)

const rad = (d) => (d * Math.PI) / 180

/** Distância em km sobre a superfície de Marte. */
export function hv(a, b) {
  const dl = rad(b.lat - a.lat)
  const dn = rad(b.lon - a.lon)
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dn / 2) ** 2
  return 2 * RM * Math.asin(Math.sqrt(h))
}

export const fmtKm = (v) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km'

export const fmtH = (h) => {
  const m = Math.round(h * 60)
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0')
}

export const fmtDeg = (v) => (v == null ? '–' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '°')
export const fmtNum = (v) => String(v).replace('.', ',')
