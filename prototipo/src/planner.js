// Destino livre: o astronauta escolhe um ponto no mapa e o plano (ida e volta ao habitat)
// é calculado na hora sobre o relevo real. Puro: roda no Node e no navegador.

import { toGeo, yToElev } from './geo.js';
import { heightAt } from './heightfield.js';
import { TRAVEL } from './pathfind.js';
import { buildPlanFromLegs, legFromPoints, registerStop } from './route.js';

export const DESTINATION_ID = 'D';
export const ROUTE_OPTIONS = Object.freeze([
  { id: 'fast', label: 'Mais rápida' },
  { id: 'safe', label: 'Mais segura' },
]);

// "Mais segura": foge mais das encostas (sem mudar o limite do modo, para não perder destinos
// alcançáveis) e evita onde não há rádio direto com o habitat.
const SAFE = Object.freeze({ slopeWeight: 10, noCommsPenalty: 1.6 });

const MIN_ROUTE_M = 30;
const TOO_CLOSE = 'Escolha um ponto mais longe do habitat.';

const UNREACHABLE = Object.freeze({
  walk: 'Não há caminho a pé até este ponto dentro do limite de declive.',
  car: 'O veículo não alcança este ponto dentro do limite de declive. Tente a pé ou escolha outro destino.',
});

/**
 * @param {object} field Campo de altitude.
 * @param {ReturnType<import('./pathfind.js').createRouter>} router
 * @param {ReturnType<import('./safety.js').createSafety>} safety
 */
export function createPlanner(field, router, safety) {
  let commsPenalty = null;

  // Multiplicador por nó para a opção segura (calculado uma vez, na primeira vez que for pedido).
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

  function profileFor(mode, option) {
    const base = TRAVEL[mode];
    if (!base) throw new Error(`Modo de deslocamento desconhecido: ${mode}`);
    if (option !== 'safe') return base;
    return { ...base, slopeWeight: SAFE.slopeWeight, extraCost: safeExtraCost() };
  }

  /**
   * @param {{ x: number, z: number }} destination
   * @param {'walk'|'car'} mode
   * @param {'fast'|'safe'} option
   * @returns {{ plan: object, stop: object } | { plan: null, reason: string }}
   */
  function planTo(destination, mode, option) {
    const profile = profileFor(mode, option);
    const out = router.findPath(safety.habitat, destination, profile);
    const back = out.reachable ? router.findPath(destination, safety.habitat, profile) : out;
    if (!out.reachable || !back.reachable) return { plan: null, reason: UNREACHABLE[mode] };
    if (out.points.length < 2 || out.lengthM < MIN_ROUTE_M) return { plan: null, reason: TOO_CLOSE };

    const end = out.points[out.points.length - 1];
    const { lat, lon } = toGeo(end.x, end.z);
    const stop = Object.freeze({
      id: DESTINATION_ID,
      name: 'Destino livre',
      lat,
      lon,
      el: Math.round(yToElev(heightAt(field, end.x, end.z))),
      ch: 'Destino escolhido no mapa',
      sci: 'Ponto escolhido pela tripulação. A rota foi calculada na hora sobre o relevo real.',
      q: 'O que chamou a atenção aqui e que o rover não registrou?',
      task: 'Descrever o local, fotografar e decidir se vale uma coleta.',
      risk: null,
      custom: true,
    });
    registerStop(stop);
    const plan = buildPlanFromLegs(
      mode,
      [legFromPoints('H', DESTINATION_ID, out.points, out.maxSlopeDeg, out.hours)],
      legFromPoints(DESTINATION_ID, 'H', back.points, back.maxSlopeDeg, back.hours),
    );
    return { plan, stop };
  }

  return Object.freeze({ planTo });
}
