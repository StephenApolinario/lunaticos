// Posição do Sol em Marte pela hora solar local e pela estação do ano.
//
// Algoritmo Mars24 de Allison & McEwen (2000), publicado pelo NASA GISS:
// https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
// É cálculo astronômico, não medição: a interface marca como "calculado". Não entram a refração,
// a poeira nem o horizonte do relevo (as sombras do relevo são feitas na cena, a partir do DEM).
//
// Puro: roda no Node e no navegador.

import { t } from './i18n.js';

const DEG = Math.PI / 180;
const J2000_JD = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;
const SECONDS_PER_DAY = 86400;
// Tempo terrestre menos UTC: 32,184 s mais 37 segundos intercalares (em vigor desde 2017).
const TT_MINUS_UTC_S = 69.184;
const HOURS_PER_SOL = 24;
const DEG_PER_HOUR = 360 / HOURS_PER_SOL;
// Um sol dura 88.775,244 s: a hora solar de Marte vale 1,0275 hora da Terra.
export const EARTH_HOURS_PER_MARS_HOUR = 88775.244 / SECONDS_PER_DAY;

const wrap360 = (deg) => ((deg % 360) + 360) % 360;

/** Data juliana em tempo terrestre de um instante (Date). */
export const julianDateTT = (date) => UNIX_EPOCH_JD + date.getTime() / (SECONDS_PER_DAY * 1000) + TT_MINUS_UTC_S / SECONDS_PER_DAY;

/**
 * Longitude solar de Marte (Ls, em graus): 0° é o equinócio de outono do hemisfério sul,
 * 90° o solstício de inverno do sul, 270° o de verão do sul.
 * Sem os termos de perturbação dos outros planetas, que somam menos de 0,01°.
 */
export function solarLongitudeDeg(jdTT) {
  const days = jdTT - J2000_JD;
  const meanAnomaly = (19.3871 + 0.52402073 * days) * DEG;
  const fictitiousMeanSun = 270.3871 + 0.524038496 * days;
  const equationOfCentre = (10.691 + 3.0e-7 * days) * Math.sin(meanAnomaly)
    + 0.623 * Math.sin(2 * meanAnomaly) + 0.05 * Math.sin(3 * meanAnomaly)
    + 0.005 * Math.sin(4 * meanAnomaly) + 0.0005 * Math.sin(5 * meanAnomaly);
  return wrap360(fictitiousMeanSun + equationOfCentre);
}

const declinationRad = (lsDeg) => Math.asin(0.42565 * Math.sin(lsDeg * DEG)) + 0.25 * DEG * Math.sin(lsDeg * DEG);

/**
 * Onde o Sol está no céu de um lugar.
 * @param {number} latDeg Latitude do lugar.
 * @param {number} lsDeg Longitude solar (estação).
 * @param {number} hourH Hora solar local verdadeira, de 0 a 24 (12 = Sol no ponto mais alto).
 * @returns {{ elevationDeg: number, azimuthDeg: number, direction: [number, number, number] }}
 *   Azimute a partir do norte, no sentido horário; `direction` é o vetor (leste, cima, sul) até o Sol.
 */
export function sunAt(latDeg, lsDeg, hourH) {
  const lat = latDeg * DEG;
  const declination = declinationRad(lsDeg);
  const hourAngle = (hourH - 12) * DEG_PER_HOUR * DEG;
  const up = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const east = -Math.cos(declination) * Math.sin(hourAngle);
  const north = Math.sin(declination) * Math.cos(lat) - Math.cos(declination) * Math.sin(lat) * Math.cos(hourAngle);
  return Object.freeze({
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, up))) / DEG,
    azimuthDeg: wrap360(Math.atan2(east, north) / DEG),
    direction: Object.freeze([east, up, -north]),
  });
}

/** Hora solar local do nascer e do pôr do Sol (horizonte plano). */
export function daylightHours(latDeg, lsDeg) {
  const cosHalfDay = -Math.tan(latDeg * DEG) * Math.tan(declinationRad(lsDeg));
  const halfDayH = Math.acos(Math.max(-1, Math.min(1, cosHalfDay))) / DEG / DEG_PER_HOUR;
  return Object.freeze({ sunriseH: 12 - halfDayH, sunsetH: 12 + halfDayH });
}

/** Hora solar local depois de `elapsedEarthH` horas da Terra contadas a partir de `startH`. */
export const localSolarHour = (startH, elapsedEarthH) => startH + elapsedEarthH / EARTH_HOURS_PER_MARS_HOUR;

const COMPASS = Object.freeze([t('norte'), t('nordeste'), t('leste'), t('sudeste'), t('sul'), t('sudoeste'), t('oeste'), t('noroeste')]);
/** Nome do rumo (norte, nordeste…) de um azimute em graus. */
export const compassName = (azimuthDeg) => COMPASS[Math.round(wrap360(azimuthDeg) / 45) % COMPASS.length];
