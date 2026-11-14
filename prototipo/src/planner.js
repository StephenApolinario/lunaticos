// Rota livre: o astronauta escolhe um ou mais pontos no mapa (A, B, C…) e o plano — habitat,
// cada ponto na ordem e a volta ao habitat — é calculado na hora sobre o relevo real.
// Puro: roda no Node e no navegador.

import { toGeo, yToElev } from './geo.js';
import { heightAt } from './heightfield.js';
import { TRAVEL } from './pathfind.js';
import { buildPlanFromLegs, legFromPoints, registerStop } from './route.js';

// Letras dos pontos livres, na ordem em que são visitados. Sem o H, que é o habitat.
export const WAYPOINT_IDS = Object.freeze('ABCDEFGIJKLMN'.split(''));
export const MAX_WAYPOINTS = WAYPOINT_IDS.length;
// A rota livre é sempre a mais segura: foge mais das encostas (sem mudar o limite do modo, para
// não perder pontos alcançáveis) e evita onde não há rádio direto com o habitat.
const SAFE = Object.freeze({ slopeWeight: 10, noCommsPenalty: 1.6 });

const MIN_ROUTE_M = 30;
const TOO_CLOSE = `Escolha um ponto a mais de ${MIN_ROUTE_M} m do anterior e do habitat.`;
const TOO_MANY = `A rota livre aceita até ${MAX_WAYPOINTS} pontos.`;

const UNREACHABLE = Object.freeze({
  walk: (place) => `Não há caminho a pé até ${place} dentro do limite de declive.`,
  car: (place) => `O veículo não alcança ${place} dentro do limite de declive. Tente a pé ou escolha outro ponto.`,
});

/**
 * @param {object} field Campo de altitude.
 * @param {ReturnType<import('./pathfind.js').createRouter>} router
 * @param {ReturnType<import('./safety.js').createSafety>} safety
 */
export function createPlanner(field, router, safety) {
  let commsPenalty = null;

  // Multiplicador por nó para evitar onde não há rádio (calculado uma vez, na primeira vez que for pedido).
  function safeExtraCost() {
    if (!commsPenalty) {
      commsPenalty = new Float32Array(router.count);
      for (let i = 0; i < router.count; i++) {
        const { x, z } = router.xzOf(i);
        commsPenalty[i] = safety.commsCoverageAt(x, z) ? 1 : SAFE.noCommsPenalty;
      }
    }
    return commsPenalty;
  }

  function profileFor(mode) {
    const base = TRAVEL[mode];
    if (!base) throw new Error(`Modo de deslocamento desconhecido: ${mode}`);
    return { ...base, slopeWeight: SAFE.slopeWeight, extraCost: safeExtraCost() };
  }

  function stopAt(id, point) {
    const { lat, lon } = toGeo(point.x, point.z);
    return Object.freeze({
      id,
      name: `Ponto ${id}`,
      lat,
      lon,
      el: Math.round(yToElev(heightAt(field, point.x, point.z))),
      ch: 'Ponto escolhido no mapa',
      sci: 'Ponto escolhido pela tripulação. A rota foi calculada na hora sobre o relevo real.',
      q: 'O que chamou a atenção aqui e que o rover não registrou?',
      task: 'Descrever o local, fotografar e decidir se vale uma coleta.',
      risk: null,
      custom: true,
    });
  }

  /**
   * Plano que sai do habitat, passa pelos pontos na ordem dada e volta ao habitat.
   * @param {Array<{ x: number, z: number }>} waypoints De 1 a MAX_WAYPOINTS pontos.
   * @param {'walk'|'car'} mode
   * @returns {{ plan: object, stops: object[] } | { plan: null, reason: string }}
   */
  function planThrough(waypoints, mode) {
    if (waypoints.length === 0) throw new Error('A rota livre precisa de pelo menos um ponto.');
    if (waypoints.length > MAX_WAYPOINTS) return { plan: null, reason: TOO_MANY };
    const profile = profileFor(mode);
    const ids = ['H', ...waypoints.map((_, index) => WAYPOINT_IDS[index]), 'H'];
    const targets = [...waypoints, safety.habitat];

    // Cada trecho começa onde o anterior terminou na grade, para o caminho não ter saltos.
    const segments = [];
    let from = safety.habitat;
    for (const [index, target] of targets.entries()) {
      const isReturn = index === targets.length - 1;
      const found = router.findPath(from, target, profile);
      if (!found.reachable) {
        const place = isReturn ? `o habitat, na volta do ponto ${ids[index]}` : `o ponto ${ids[index + 1]}`;
        return { plan: null, reason: UNREACHABLE[mode](place) };
      }
      if (found.points.length < 2 || found.lengthM < MIN_ROUTE_M) return { plan: null, reason: TOO_CLOSE };
      segments.push(found);
      from = found.points[found.points.length - 1];
    }

    const stops = segments.slice(0, -1).map((segment, index) => stopAt(ids[index + 1], segment.points[segment.points.length - 1]));
    stops.forEach(registerStop);
    const legs = segments.map((segment, index) => legFromPoints(ids[index], ids[index + 1], segment.points, segment.maxSlopeDeg, segment.hours));
    return { plan: buildPlanFromLegs(mode, legs.slice(0, -1), legs[legs.length - 1]), stops };
  }

  return Object.freeze({ planThrough, profileFor });
}
