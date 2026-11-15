// Leitura do terreno: inclinação sob os pés, declive à frente, zona de risco e projeção na rota.
// Funções puras sobre `heightAt(x, z)`, que no protótipo lê o relevo real (grade de 8 m, USGS).

import { HAZARD } from '../../data/travessia.js';
import { toLocal, headingDeg, angleDeltaDeg, clamp } from '../../src/geo.js';
import { t } from '../../src/i18n.js';

const DEG = Math.PI / 180;
const AHEAD_CONE_DEG = 30;
const BEHIND_CONE_DEG = 150;

// Limites de declive do planejamento do protótipo (parâmetro da equipe, não é dado da NASA).
export const SLOPE_LIMIT_DEG = Object.freeze({ foot: 20, cabin: 15 });
const LEVEL_FRACTION = Object.freeze({ attention: 0.5, near: 0.75 });
export const HAZARD_WARN_M = 200;

const HAZARD_LOCAL = Object.freeze({ ...toLocal(HAZARD.lat, HAZARD.lon), radiusM: HAZARD.radiusKm * 1000 });

export const limitFor = (onFoot) => (onFoot ? SLOPE_LIMIT_DEG.foot : SLOPE_LIMIT_DEG.cabin);

/**
 * Classe do declive em relação ao limite: abaixo de 50%, de 50% a 75%, de 75% ao limite, acima.
 * @returns {'ok'|'attention'|'near'|'over'}
 */
export function slopeLevel(absDeg, limitDeg) {
  if (absDeg >= limitDeg) return 'over';
  if (absDeg >= limitDeg * LEVEL_FRACTION.near) return 'near';
  if (absDeg >= limitDeg * LEVEL_FRACTION.attention) return 'attention';
  return 'ok';
}

// Ritmo SIMULADO: quanto da velocidade do plano se mantém em cada declive. Regra simples,
// sem base em medição de traje em Marte: subida freia, descida leve ajuda, descida forte freia.
const PACE = Object.freeze({
  foot: { flatDeg: 3, upPerDeg: 0.035, easyDownDeg: 8, downBonus: 0.06, downPerDeg: 0.02, min: 0.4 },
  cabin: { flatDeg: 4, perDeg: 0.03, min: 0.5 },
});

export function paceFactor(slopeDeg, onFoot) {
  if (!onFoot) {
    const { flatDeg, perDeg, min } = PACE.cabin;
    return Math.max(min, 1 - perDeg * Math.max(0, Math.abs(slopeDeg) - flatDeg));
  }
  const rule = PACE.foot;
  if (slopeDeg >= 0) return Math.max(rule.min, 1 - rule.upPerDeg * Math.max(0, slopeDeg - rule.flatDeg));
  const downDeg = -slopeDeg;
  if (downDeg <= rule.easyDownDeg) return 1 + rule.downBonus * (downDeg / rule.easyDownDeg);
  return Math.max(rule.min, 1 + rule.downBonus - rule.downPerDeg * (downDeg - rule.easyDownDeg));
}

/**
 * Inclinação do chão em dois eixos, por diferença de altura à frente/atrás e à esquerda/direita.
 * `pitchDeg` positivo = subida no sentido do rumo. `rollDeg` positivo = o chão cai para a direita.
 */
export function groundAttitude(heightAt, x, z, heading, baseM) {
  const sin = Math.sin(heading * DEG);
  const cos = Math.cos(heading * DEG);
  // Frente = (sin, -cos); direita = (cos, sin). Norte é -z.
  const alongM = heightAt(x + sin * baseM, z - cos * baseM) - heightAt(x - sin * baseM, z + cos * baseM);
  const acrossM = heightAt(x - cos * baseM, z - sin * baseM) - heightAt(x + cos * baseM, z + sin * baseM);
  const runM = 2 * baseM;
  return {
    pitchDeg: Math.atan(alongM / runM) / DEG,
    rollDeg: Math.atan(acrossM / runM) / DEG,
    slopeDeg: Math.atan(Math.hypot(alongM, acrossM) / runM) / DEG,
  };
}

/** Maior declive (com sinal) em linha reta no rumo dado, e a que distância ele começa. */
export function slopeAlongHeading(heightAt, x, z, heading, rangeM, stepM) {
  const sin = Math.sin(heading * DEG);
  const cos = Math.cos(heading * DEG);
  let peakDeg = 0;
  let inM = 0;
  let previous = heightAt(x, z);
  for (let d = stepM; d <= rangeM; d += stepM) {
    const y = heightAt(x + sin * d, z - cos * d);
    const deg = Math.atan((y - previous) / stepM) / DEG;
    if (Math.abs(deg) > Math.abs(peakDeg)) {
      peakDeg = deg;
      inM = d - stepM;
    }
    previous = y;
  }
  return { deg: peakDeg, inM };
}

/** Distância até a borda da zona de rochas cortantes e de que lado ela fica. */
export function hazardStatus(x, z, heading) {
  const dx = HAZARD_LOCAL.x - x;
  const dz = HAZARD_LOCAL.z - z;
  const edgeM = Math.hypot(dx, dz) - HAZARD_LOCAL.radiusM;
  const toCenter = headingDeg(dx, dz);
  const relative = angleDeltaDeg(heading, toCenter);
  // `side` é texto para a tela, já no idioma da interface.
  let side = relative > 0 ? t('à direita') : t('à esquerda');
  if (Math.abs(relative) < AHEAD_CONE_DEG) side = t('à frente');
  if (Math.abs(relative) > BEHIND_CONE_DEG) side = t('atrás');
  return { edgeM, side, inside: edgeM < 0, near: edgeM < HAZARD_WARN_M, exitBearingDeg: (toCenter + 180) % 360 };
}

/** Distância (com sinal) de um ponto até a borda da zona de risco. Negativa = dentro. */
export const hazardEdgeM = (x, z) => Math.hypot(HAZARD_LOCAL.x - x, HAZARD_LOCAL.z - z) - HAZARD_LOCAL.radiusM;

/** Lado do centro da zona de risco em relação a um trecho que vai de (ax, az) para (bx, bz). */
export const hazardSideOf = (ax, az, bx, bz) =>
  ((bx - ax) * (HAZARD_LOCAL.z - az) - (bz - az) * (HAZARD_LOCAL.x - ax) >= 0 ? 'direita' : 'esquerda');

/**
 * Ponto mais próximo da rota dentro da janela [loM, hiM] de distância percorrida.
 * @param {{ xs: Float32Array, zs: Float32Array, count: number, totalM: number, stepM: number }} route
 * @returns {{ distM: number, offM: number, side: 'direita'|'esquerda' }} `side` = lado da rota em que o ponto está.
 */
export function projectOnRoute(route, x, z, loM, hiM) {
  const { xs, zs, stepM } = route;
  const first = clamp(Math.floor(loM / stepM), 0, route.count - 2);
  const last = clamp(Math.ceil(hiM / stepM), first + 1, route.count - 1);
  let best = { distM: first * stepM, offM: Infinity, side: 'direita' };
  for (let i = first; i < last; i++) {
    const ax = xs[i];
    const az = zs[i];
    const bx = xs[i + 1] - ax;
    const bz = zs[i + 1] - az;
    const lengthSq = bx * bx + bz * bz;
    const t = lengthSq > 0 ? clamp(((x - ax) * bx + (z - az) * bz) / lengthSq, 0, 1) : 0;
    const offM = Math.hypot(x - (ax + bx * t), z - (az + bz * t));
    if (offM >= best.offM) continue;
    const fromM = i * stepM;
    const toM = Math.min((i + 1) * stepM, route.totalM);
    best = { distM: fromM + (toM - fromM) * t, offM, side: bx * (z - az) - bz * (x - ax) >= 0 ? 'direita' : 'esquerda' };
  }
  return { ...best, distM: clamp(best.distM, loM, hiM) };
}
