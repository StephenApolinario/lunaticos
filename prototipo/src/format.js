// Formatação de números para a interface, em pt-BR.

const LOCALE = 'pt-BR';
const M_PER_KM = 1000;

export const fmtNumber = (value, digits = 0) =>
  value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtKm = (km) => `${fmtNumber(km, 1)} km`;

// Abaixo de 1 km mostra metros arredondados de 10 em 10.
export function fmtDistance(meters) {
  if (meters >= M_PER_KM) return `${fmtNumber(meters / M_PER_KM, 2)} km`;
  return `${fmtNumber(Math.round(meters / 10) * 10)} m`;
}

// Horas decimais como "1h05". Aceita valor negativo.
export function fmtDuration(hours) {
  const totalMin = Math.round(Math.abs(hours) * 60);
  const text = `${Math.floor(totalMin / 60)}h${String(totalMin % 60).padStart(2, '0')}`;
  return hours < 0 ? `-${text}` : text;
}

export const fmtSigned = (value, digits = 0) => `${value >= 0 ? '+' : '-'}${fmtNumber(Math.abs(value), digits)}`;

// Hora do relógio "HH:MM" a partir de horas decimais.
export function fmtClock(hours) {
  const totalMin = Math.floor((((hours % 24) + 24) % 24) * 60);
  return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
}
