// Temperatura estimada pela hora do dia, a partir dos extremos medidos pelo REMS do Curiosity.
//
// É interpolação, não medição: o mínimo fica no nascer do Sol e o máximo no começo da tarde
// (solo antes do ar), como nas séries do REMS, e a curva entre os dois é um meio cosseno.
// A interface marca como "estimado". Puro: roda no Node e no navegador.

import { REMS } from '../data/medicoes.js';

const HOURS_PER_SOL = 24;
const COLDEST_H = 6;
const WARMEST_H = Object.freeze({ ground: 13, air: 15 });

// Extremos em uso. Começam nos de reserva (sol típico de 2012) e passam para as médias da estação
// quando o feed do REMS carrega (ver nasa.js). É o único estado deste módulo.
let ranges = Object.freeze({ air: REMS.air, ground: REMS.ground });

/** Troca os extremos pelos medidos na estação atual. */
export function useMeasuredRanges({ air, ground }) {
  ranges = Object.freeze({ air, ground });
}

function diurnal({ minC, maxC }, warmestH, hourH) {
  const sinceColdest = (((hourH - COLDEST_H) % HOURS_PER_SOL) + HOURS_PER_SOL) % HOURS_PER_SOL;
  const warmingH = warmestH - COLDEST_H;
  const phase = sinceColdest <= warmingH ? sinceColdest / warmingH : 1 - (sinceColdest - warmingH) / (HOURS_PER_SOL - warmingH);
  return minC + ((maxC - minC) * (1 - Math.cos(Math.PI * phase))) / 2;
}

/** Temperatura do ar (°C) estimada para uma hora solar local. */
export const estimatedAirTempC = (hourH) => diurnal(ranges.air, WARMEST_H.air, hourH);
/** Temperatura do solo (°C) estimada para uma hora solar local. */
export const estimatedGroundTempC = (hourH) => diurnal(ranges.ground, WARMEST_H.ground, hourH);
