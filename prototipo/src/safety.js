// Segurança da saída, calculada sobre o relevo real: tempo de volta a pé, cobertura de
// rádio em linha de visada, abrigo mais próximo e a avaliação de um plano inteiro.
// Puro: roda no Node e no navegador.
//
// O que é real: o relevo (DEM USGS). O que é HIPÓTESE da equipe, e aparece assim na
// interface: as alturas de antena, as taxas de consumo de oxigênio e a reserva mínima.

import { STOPS, STOP_HOURS } from '../data/travessia.js';
import { toLocal, clamp, lerp, MARS_RADIUS_M } from './geo.js';
import { heightAt } from './heightfield.js';
import { TRAVEL } from './pathfind.js';
import { SIM } from './simulation.js';
import { RAD } from '../data/medicoes.js';

export const ASSUMPTIONS = Object.freeze({
  habitatMastM: 10,
  suitAntennaM: 2,
  o2ReservePct: 10,
});

const WALK_BACK_STEP = 2;
const COARSE_STEP = 4;
const PATH_SAMPLE_M = 16;
const SKY = Object.freeze({ directions: 16, stepsOut: 15, eyeM: 1.5 });
const SHELTER = Object.freeze({ topFraction: 0.03, maxSlopeDeg: 20, searchRadiusM: 1500 });

function habitatPosition() {
  const habitat = STOPS.find((stop) => stop.id === 'H');
  if (!habitat) throw new Error('Parada do habitat (H) ausente nos dados.');
  return toLocal(habitat.lat, habitat.lon);
}

/**
 * @param {object} field Campo de altitude de heightfield.js.
 * @param {ReturnType<import('./pathfind.js').createRouter>} router
 */
export function createSafety(field, router) {
  const { cols, rows, stride, cellM, heights, halfWidth, halfDepth } = field;
  const habitat = habitatPosition();
  const habitatMastY = heightAt(field, habitat.x, habitat.z) + ASSUMPTIONS.habitatMastM;
  const coarseM = cellM * COARSE_STEP;
  const coarseCols = Math.floor(cols / COARSE_STEP) + 1;
  const coarseRows = Math.floor(rows / COARSE_STEP) + 1;

  let walkBackField = null;
  let commsGrid = null;
  let shelterSites = null;

  // Tempo, em horas, para voltar a pé de um ponto até o habitat. Infinity = sem caminho a pé.
  function walkBackAt(x, z) {
    walkBackField ??= router.costField({ origin: habitat, profile: TRAVEL.walk, step: WALK_BACK_STEP, reverse: true });
    return walkBackField.at(x, z);
  }

  // Linha de visada entre o mastro do habitat e a antena do traje, com a curvatura de Marte.
  function hasLineOfSight(x, z) {
    const targetY = heightAt(field, x, z) + ASSUMPTIONS.suitAntennaM;
    const distM = Math.hypot(x - habitat.x, z - habitat.z);
    const steps = Math.ceil(distM / cellM);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const bulgeM = (t * (1 - t) * distM * distM) / (2 * MARS_RADIUS_M);
      const lineY = lerp(habitatMastY, targetY, t) - bulgeM;
      if (heightAt(field, lerp(habitat.x, x, t), lerp(habitat.z, z, t)) > lineY) return false;
    }
    return true;
  }

  const commsAt = (x, z) => ({ visible: hasLineOfSight(x, z), distM: Math.hypot(x - habitat.x, z - habitat.z) });

  const coarseXZ = (index) => {
    const row = (index / coarseCols) | 0;
    return { x: -halfWidth + (index - row * coarseCols) * coarseM, z: -halfDepth + row * coarseM };
  };
  const coarseIndexAt = (x, z) => {
    const col = clamp(Math.round((x + halfWidth) / coarseM), 0, coarseCols - 1);
    const row = clamp(Math.round((z + halfDepth) / coarseM), 0, coarseRows - 1);
    return row * coarseCols + col;
  };

  // Cobertura de rádio em grade de 32 m, para a camada do mapa (1 = com visada, 0 = sem).
  function commsCoverageAt(x, z) {
    if (!commsGrid) {
      commsGrid = new Uint8Array(coarseCols * coarseRows);
      for (let i = 0; i < commsGrid.length; i++) {
        const point = coarseXZ(i);
        commsGrid[i] = hasLineOfSight(point.x, point.z) ? 1 : 0;
      }
    }
    return commsGrid[coarseIndexAt(x, z)];
  }

  // Fração do céu tapada pelo relevo em volta de um ponto (0 = céu aberto, 1 = todo tapado).
  function skyBlockedAt(x, z) {
    const eyeY = heightAt(field, x, z) + SKY.eyeM;
    let blocked = 0;
    for (let d = 0; d < SKY.directions; d++) {
      const angle = (d / SKY.directions) * Math.PI * 2;
      let horizon = 0;
      for (let step = 1; step <= SKY.stepsOut; step++) {
        const distM = step * coarseM;
        const rise = heightAt(field, x + Math.cos(angle) * distM, z + Math.sin(angle) * distM) - eyeY;
        horizon = Math.max(horizon, Math.atan2(rise, distM));
      }
      // Parte do hemisfério tapada nessa direção: seno do ângulo do horizonte.
      blocked += Math.sin(horizon);
    }
    return blocked / SKY.directions;
  }

  // Céu tapado em grade de 32 m, para a camada de radiação.
  let skyGrid = null;
  function skyGridOf() {
    if (!skyGrid) {
      skyGrid = new Float32Array(coarseCols * coarseRows);
      for (let i = 0; i < skyGrid.length; i++) {
        const point = coarseXZ(i);
        skyGrid[i] = skyBlockedAt(point.x, point.z);
      }
    }
    return skyGrid;
  }

  /**
   * Taxa de dose estimada em um ponto (µSv/h): a média medida pelo RAD em Gale, reduzida na
   * proporção do céu que o relevo tapa. A proporção vem da medição do RAD em Murray Buttes
   * (4% a menos com 19% do céu tapado); acima de 19% é extrapolação em linha reta.
   */
  function radiationAt(x, z) {
    const values = skyGridOf();
    const fx = clamp((x + halfWidth) / coarseM, 0, coarseCols - 1);
    const fz = clamp((z + halfDepth) / coarseM, 0, coarseRows - 1);
    const col = Math.min(Math.floor(fx), coarseCols - 2);
    const row = Math.min(Math.floor(fz), coarseRows - 2);
    const i = row * coarseCols + col;
    const blocked = lerp(lerp(values[i], values[i + 1], fx - col), lerp(values[i + coarseCols], values[i + coarseCols + 1], fx - col), fz - row);
    return RAD.surfaceUsvPerHour * (1 - RAD.butteShieldingFraction * (blocked / RAD.butteSkyBlocked));
  }

  // Pontos do relevo mais encaixados (os 3% com mais céu tapado) e onde dá para ficar em pé.
  function findShelterSites() {
    const candidates = [];
    for (let i = 0; i < coarseCols * coarseRows; i++) {
      const point = coarseXZ(i);
      if (router.slopeDeg[router.nodeAt(point.x, point.z)] > SHELTER.maxSlopeDeg) continue;
      candidates.push({ ...point, skyBlocked: skyBlockedAt(point.x, point.z) });
    }
    candidates.sort((a, b) => b.skyBlocked - a.skyBlocked);
    return candidates.slice(0, Math.ceil(candidates.length * SHELTER.topFraction));
  }

  /**
   * Abrigos para um ponto: o habitat (sempre) e a melhor proteção de relevo por perto, se houver.
   * A proteção de relevo é uma ESTIMATIVA geométrica: quanto do céu a encosta tapa.
   */
  function nearestShelter(x, z) {
    shelterSites ??= findShelterSites();
    let terrain = null;
    for (const site of shelterSites) {
      const distM = Math.hypot(site.x - x, site.z - z);
      if (distM <= SHELTER.searchRadiusM && (!terrain || distM < terrain.distM)) terrain = { ...site, distM };
    }
    return {
      habitat: { ...habitat, distM: Math.hypot(habitat.x - x, habitat.z - z), walkH: walkBackAt(x, z) },
      terrain: terrain && { ...terrain, walkH: terrain.distM / 1000 / TRAVEL.walk.speedKmh },
    };
  }

  // Oxigênio restante ao chegar em um ponto do caminho, pelas taxas simuladas de SIM.
  function oxygenPctAt(plan, point) {
    const stopsPassed = plan.stops.filter((entry) => entry.distM < point.distM).length;
    const footH = point.footH + stopsPassed * STOP_HOURS;
    const cabinH = point.travelH - point.footH;
    return 100 - SIM.o2PctPerHour.foot * footH - SIM.o2PctPerHour.cabin * cabinH;
  }

  // Trechos do caminho sem linha de visada com o habitat.
  function findCommsGaps(path) {
    const gaps = [];
    let openFrom = null;
    let lastM = 0;
    for (const point of path.points) {
      if (point.distM - lastM < PATH_SAMPLE_M && point.distM > 0) continue;
      lastM = point.distM;
      const visible = hasLineOfSight(point.x, point.z);
      if (!visible && openFrom === null) openFrom = point.distM;
      if (visible && openFrom !== null) { gaps.push({ fromM: openFrom, toM: point.distM }); openFrom = null; }
    }
    if (openFrom !== null) gaps.push({ fromM: openFrom, toM: path.totalM });
    return gaps;
  }

  /**
   * Avalia um plano inteiro.
   * - `noReturn`: primeiro ponto em que o oxigênio restante não cobre a caminhada de volta com a reserva.
   * - `commsGaps`: trechos sem rádio direto com o habitat.
   * - `farthest`: o ponto do caminho com a volta a pé mais longa, e os abrigos a partir dele.
   */
  function assessPlan(plan) {
    let noReturn = null;
    let minMarginPct = Infinity;
    let farthest = null;
    for (const point of plan.path.points) {
      const walkH = walkBackAt(point.x, point.z);
      // Sem caminho a pé conhecido até o habitat: dali não se volta sozinho, então conta como ponto sem volta.
      if (!Number.isFinite(walkH)) {
        noReturn ??= { distM: point.distM, x: point.x, z: point.z, walkH, elapsedH: point.travelH, noWalkRoute: true };
        continue;
      }
      const marginPct = oxygenPctAt(plan, point) - SIM.o2PctPerHour.foot * walkH - ASSUMPTIONS.o2ReservePct;
      minMarginPct = Math.min(minMarginPct, marginPct);
      if (marginPct < 0 && !noReturn) noReturn = { distM: point.distM, x: point.x, z: point.z, walkH, elapsedH: point.travelH };
      if (!farthest || walkH > farthest.walkH) farthest = { distM: point.distM, x: point.x, z: point.z, walkH };
    }
    const commsGaps = findCommsGaps(plan.path);
    return Object.freeze({
      noReturn,
      // Nenhum ponto com volta a pé conhecida: não há folga para informar.
      minMarginH: Number.isFinite(minMarginPct) ? minMarginPct / SIM.o2PctPerHour.foot : null,
      commsGaps,
      commsLostM: commsGaps.reduce((sum, gap) => sum + gap.toM - gap.fromM, 0),
      farthest,
      shelter: farthest ? nearestShelter(farthest.x, farthest.z) : null,
    });
  }

  return Object.freeze({ walkBackAt, commsAt, commsCoverageAt, radiationAt, nearestShelter, assessPlan, habitat });
}
