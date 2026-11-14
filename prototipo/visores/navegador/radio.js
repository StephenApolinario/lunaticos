// Linha de visada de rádio sobre o relevo. É geometria pura: uma reta de antena a antena,
// comparada com a altura do terreno no caminho. Não modela difração, reflexão nem relé orbital.

import { MARS_RADIUS_M } from '../../src/geo.js';

// Alturas de antena PRESUMIDAS para o protótipo (não são especificação de missão).
// São as mesmas hipóteses de src/safety.js, para o visor e o mapa do tablet contarem a mesma história.
export const ANTENNA_M = Object.freeze({ suit: 2, habitat: 10 });

/** Alturas de antena a partir de `context.safety.assumptions`, quando o contexto traz. */
export function antennaFrom(assumptions) {
  return Object.freeze({
    suit: assumptions?.suitAntennaM ?? ANTENNA_M.suit,
    habitat: assumptions?.habitatMastM ?? ANTENNA_M.habitat,
  });
}
const DEFAULT_STEP_M = 8;

/**
 * Menor folga entre a reta antena-antena e o terreno. Folga positiva = visada livre.
 * A curvatura de Marte entra como um abaulamento do terreno no meio do caminho.
 * @param {(x: number, z: number) => number} heightAt
 * @param {{ x: number, z: number, antennaM: number }} from
 * @param {{ x: number, z: number, antennaM: number }} to
 * @param {{ stepM?: number, stopAtBlock?: boolean }} [options] `stopAtBlock` para no primeiro bloqueio.
 * @returns {{ visible: boolean, clearanceM: number, blockAtM: number, distM: number }}
 */
export function lineOfSight(heightAt, from, to, options = {}) {
  const { stepM = DEFAULT_STEP_M, stopAtBlock = false } = options;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distM = Math.hypot(dx, dz);
  const y0 = heightAt(from.x, from.z) + from.antennaM;
  const y1 = heightAt(to.x, to.z) + to.antennaM;
  const steps = Math.max(1, Math.ceil(distM / stepM));
  let clearanceM = Infinity;
  let blockAtM = 0;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const bulgeM = (t * distM * (1 - t) * distM) / (2 * MARS_RADIUS_M);
    const gapM = y0 + (y1 - y0) * t - heightAt(from.x + dx * t, from.z + dz * t) - bulgeM;
    if (gapM < clearanceM) {
      clearanceM = gapM;
      blockAtM = t * distM;
      if (stopAtBlock && gapM <= 0) break;
    }
  }
  return { visible: clearanceM > 0, clearanceM, blockAtM, distM };
}
