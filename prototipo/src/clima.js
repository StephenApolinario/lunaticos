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
let ranges = Object.freeze({ air: REMS.air, ground: REMS.ground, pressurePa: REMS.fallbackPressurePa });

/** Troca os extremos pelos medidos na estação atual. */
export function useMeasuredRanges({ air, ground, pressurePa }) {
  ranges = Object.freeze({ air, ground, pressurePa: pressurePa ?? REMS.fallbackPressurePa });
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

// Constante do gás para o CO2 (J/kg/K) e densidade do ar ao nível do mar na Terra (kg/m³).
const CO2_GAS_CONSTANT = 188.92;
const EARTH_AIR_DENSITY = 1.225;
const KELVIN = 273.15;

/** Densidade do ar em Gale (kg/m³), pela lei dos gases, com a pressão e a temperatura medidas pelo REMS. */
export function airDensity() {
  const meanAirK = (ranges.air.minC + ranges.air.maxC) / 2 + KELVIN;
  return ranges.pressurePa / (CO2_GAS_CONSTANT * meanAirK);
}

/**
 * Vento na Terra que empurraria com a mesma força: a força vai com a densidade do ar vezes a
 * velocidade ao quadrado, e o ar de Marte é cerca de cem vezes mais rarefeito.
 */
export const earthEquivalentWindKmh = (windMps) => windMps * Math.sqrt(airDensity() / EARTH_AIR_DENSITY) * 3.6;

// Passo (em horas) ao procurar quando o ar cruza um limite: 5 minutos.
const SCAN_STEP_H = 1 / 12;

/**
 * Parte de uma saída em que o ar estimado fica abaixo de `limitC`. Horas solares locais; `endH`
 * pode passar de 24 quando a saída vira o sol.
 * @returns {{ firstH: number, lastH: number, coldestC: number } | null} null se nunca fica abaixo.
 */
export function coldSpan(startH, endH, limitC) {
  let firstH = null;
  let lastH = null;
  let coldestC = Infinity;
  for (let hourH = startH; hourH <= endH + 1e-9; hourH += SCAN_STEP_H) {
    const airC = estimatedAirTempC(hourH);
    coldestC = Math.min(coldestC, airC);
    if (airC >= limitC) continue;
    firstH ??= hourH;
    lastH = hourH;
  }
  return firstH === null ? null : { firstH, lastH, coldestC };
}

/**
 * Primeira hora, de `fromH` em diante (até um sol depois), em que o ar estimado volta a ficar em
 * `limitC` ou acima. É a hora a partir da qual dá para sair sem frio.
 * @returns {number | null} null se o ar não chega ao limite em nenhuma hora do sol.
 */
export function warmAfter(fromH, limitC) {
  for (let hourH = fromH; hourH <= fromH + HOURS_PER_SOL; hourH += SCAN_STEP_H) {
    if (estimatedAirTempC(hourH) >= limitC) return hourH;
  }
  return null;
}
