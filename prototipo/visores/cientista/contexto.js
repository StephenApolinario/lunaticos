// Contexto da saída: junta a leitura da simulação compartilhada com o que é próprio desta
// variante (emergências simuladas, perigos relatados, diário) em um objeto simples, só de
// dados. O mesmo objeto alimenta o HUD, os alertas e o assistente, e pode ser serializado
// para um servidor quando houver um modelo de linguagem real (ver NOTAS.md).
//
// Lógica pura: roda no Node. O formato do objeto está descrito em assistente.js
// (`AssistantContext`). Quem tiver outra simulação monta o mesmo objeto com as peças
// exportadas aqui (`describeStops`, `habitatReturn`, `commsStatus`, `buildAlerts`).

import { SIM } from '../../src/simulation.js';
import { STOPS, STOP_HOURS } from '../../data/travessia.js';
import { toGeo, clamp } from '../../src/geo.js';
import { fmtDistance, fmtDuration, fmtNumber } from '../../src/format.js';
import { t } from '../../src/i18n.js';
import { locateHazards, hazardWarning } from './perigos.js';

export const LIMITS = Object.freeze({
  o2: Object.freeze({ danger: 25, warn: 45 }),
  battery: Object.freeze({ danger: 20, warn: 40 }),
  // Vazamento simulado da emergência de oxigênio: o O₂ fica travado neste teto.
  o2LeakTargetPct: 18,
  stopRiskWarnM: 150,
  noReturnWarnM: 300,
  atHabitatM: 5,
});
export const SEVERITIES = Object.freeze(['critico', 'atencao', 'info']);
export const DIRECTION_TEXT = Object.freeze({ back: t`voltando pelo caminho de ida`, forward: t`seguindo a rota até o fim` });

export const pct = (value) => `${fmtNumber(Math.max(0, value))}%`;
export const stopShortName = (stop) => stop.name.split(' ·')[0];

/** "1,20 km, cerca de 0h29 voltando pelo caminho de ida", ou o aviso de que já se está lá. */
export function homeLine(context) {
  const { habitat } = context;
  if (habitat.distM < LIMITS.atHabitatM) return t`você já está no habitat`;
  const distance = fmtDistance(habitat.distM);
  const eta = fmtDuration(habitat.etaH);
  return habitat.direction === 'back'
    ? t`${distance}, cerca de ${eta} voltando pelo caminho de ida`
    : t`${distance}, cerca de ${eta} seguindo a rota até o fim`;
}

/** Frase completa sobre a distância do habitat pela rota (sem o ponto final). */
export function habitatLine(context) {
  const { habitat } = context;
  if (habitat.distM < LIMITS.atHabitatM) return t`Você já está no habitat`;
  const distance = fmtDistance(habitat.distM);
  const eta = fmtDuration(habitat.etaH);
  return habitat.direction === 'back'
    ? t`O habitat fica a ${distance}, cerca de ${eta} voltando pelo caminho de ida`
    : t`O habitat fica a ${distance}, cerca de ${eta} seguindo a rota até o fim`;
}

/**
 * Paradas do plano, na ordem (inclui o destino livre escolhido no mapa), seguidas das demais
 * paradas dos dados, marcadas como fora do plano.
 */
export function describeStops(plan) {
  const planned = plan.stops.map((entry, order) => Object.freeze({ ...entry.stop, order, inPlan: true, distM: entry.distM }));
  const others = STOPS
    .filter((stop) => !planned.some((entry) => entry.id === stop.id))
    .map((stop) => Object.freeze({ ...stop, order: -1, inPlan: stop.id === 'H', distM: null }));
  return Object.freeze([...planned, ...others]);
}

// Traje: parte da leitura compartilhada. Com o vazamento simulado ligado, o O₂ fica travado em
// um teto, seja qual for o ponto da rota (a barra de posição não desfaz a emergência).
function suitStatus(plan, state, readout, leaking) {
  const { here, suit } = readout;
  const dwellLeftH = (plan.stops.length - state.stopsReached) * STOP_HOURS + state.dwellRemainingH;
  const footLeftH = plan.path.totalFootH - here.footH + dwellLeftH;
  const cabinLeftH = plan.path.totalTravelH - plan.path.totalFootH - (here.travelH - here.footH);
  const leakPct = leaking ? Math.max(0, suit.o2Pct - LIMITS.o2LeakTargetPct) : 0;
  const marginH = suit.marginH - leakPct / SIM.o2PctPerHour.foot;
  return {
    o2Pct: clamp(suit.o2Pct - leakPct, 0, 100),
    batteryPct: suit.batteryPct,
    batteryEndPct: suit.batteryPct - (SIM.batteryPctPerHour.foot * footLeftH + SIM.batteryPctPerHour.cabin * cabinLeftH),
    marginH,
    planEndO2Pct: marginH * SIM.o2PctPerHour.foot,
    hoursToFinish: footLeftH + cabinLeftH,
    leaking,
  };
}

/**
 * Volta ao habitat. Pela rota marcada: voltar pela ida ou seguir até o fim, o que for mais rápido.
 * A pé pelo relevo real (`walkBackH`, de context.safety.walkBackAt): é a conta do oxigênio, porque
 * vale mesmo sem veículo. Sem esse dado (Infinity ou ausente), o oxigênio é estimado pela rota.
 * @param {object} plan Plano de buildPlan.
 * @param {object} here Ponto de samplePath.
 * @param {number} o2Pct Oxigênio atual.
 * @param {number} [walkBackH]
 */
export function habitatReturn(plan, here, o2Pct, walkBackH) {
  const { path } = plan;
  const cabinH = here.travelH - here.footH;
  const back = { direction: 'back', distM: here.distM, etaH: here.travelH, footH: here.footH, cabinH };
  const forward = {
    direction: 'forward',
    distM: path.totalM - here.distM,
    etaH: path.totalTravelH - here.travelH,
    footH: path.totalFootH - here.footH,
    cabinH: path.totalTravelH - path.totalFootH - cabinH,
  };
  const best = back.etaH <= forward.etaH ? back : forward;
  const onFootBasis = Number.isFinite(walkBackH);
  const o2UsePct = onFootBasis
    ? SIM.o2PctPerHour.foot * walkBackH
    : SIM.o2PctPerHour.foot * best.footH + SIM.o2PctPerHour.cabin * best.cabinH;
  return {
    direction: best.direction, distM: best.distM, etaH: best.etaH,
    walkH: onFootBasis ? walkBackH : null, o2UsePct, o2ArrivalPct: o2Pct - o2UsePct,
  };
}

/**
 * Rádio: linha de visada com o mastro do habitat ao longo da rota (`plan.safety.commsGaps`:
 * relevo real, alturas de antena são hipótese da equipe) e a falha simulada da demonstração.
 */
export function commsStatus(plan, distM, failed) {
  const gaps = plan.safety?.commsGaps ?? null;
  const gap = gaps?.find((candidate) => distM >= candidate.fromM && distM < candidate.toM) ?? null;
  return { failed, lineOfSight: gaps ? !gap : null, backInM: gap ? gap.toM - distM : null };
}

function suitAlerts(context, add) {
  const { suit, habitat } = context;
  const home = habitatLine(context);
  const reservePct = pct(context.assumptions.o2ReservePct);
  if (suit.o2Pct < LIMITS.o2.danger) {
    const arrival = habitat.o2ArrivalPct >= 0 ? t`você chegaria com cerca de ${pct(habitat.o2ArrivalPct)} de O₂` : t`o O₂ não cobre a volta: peça resgate agora`;
    const text = suit.leaking ? t`O₂ em ${pct(suit.o2Pct)} · nível crítico (vazamento simulado)` : t`O₂ em ${pct(suit.o2Pct)} · nível crítico`;
    add('o2-critico', 'critico', text, t`Pare a tarefa e retorne. ${home}; ${arrival}.`);
  }
  if (suit.marginH < 0) {
    add('o2-insuficiente', 'critico', t`O₂ não cobre o plano · faltam ${fmtDuration(-suit.marginH)}`, t`Encurte a saída: pule as paradas que faltam. ${home}.`);
  } else if (suit.marginH < SIM.lowMarginH) {
    add('o2-margem', 'atencao', t`Margem de O₂ baixa · ${fmtDuration(suit.marginH)}`, t`Não estenda as paradas além do previsto.`);
  }
  if (habitat.walkH !== null && habitat.o2ArrivalPct < context.assumptions.o2ReservePct && suit.o2Pct >= LIMITS.o2.danger) {
    const fix = context.mode === 'walk' ? t`Retorne agora pelo caminho mais curto.` : t`Você depende do veículo para voltar: não se afaste dele.`;
    add('sem-volta', context.mode === 'walk' ? 'critico' : 'atencao', t`O₂ não cobre a volta a pé com a reserva de ${reservePct} (hipótese da equipe)`, `${fix} ${t`A volta a pé pelo relevo leva ${fmtDuration(habitat.walkH)}.`}`);
  } else if (context.noReturn && context.noReturn.aheadM > 0 && context.noReturn.aheadM <= LIMITS.noReturnWarnM) {
    add('sem-volta-a-frente', 'atencao', t`Ponto sem volta a pé em ${fmtDistance(context.noReturn.aheadM)}`, t`Depois dele o O₂ não cobre a caminhada de volta com a reserva de ${reservePct} (hipótese da equipe). Só siga se o retorno estiver garantido.`);
  }
  if (suit.batteryPct < LIMITS.battery.warn) {
    const level = suit.batteryPct < LIMITS.battery.danger ? 'critico' : 'atencao';
    add('bateria', level, t`Bateria do traje em ${pct(suit.batteryPct)}`, t`Planeje o retorno. ${home}.`);
  }
}

function terrainAlerts(context, alerts, add) {
  const { riskZone, env, hazards, target, focusStop } = context;
  if (riskZone.near) {
    add('zona-risco', 'atencao', t`Rochas cortantes a ${fmtDistance(riskZone.edgeM)} ${riskZone.side} (zona aproximada)`, t`Mantenha-se na rota marcada.`);
  }
  if (env.slopeAheadDeg >= SIM.slopeWarnDeg) {
    add('declive', 'atencao', t`Declive de ${fmtNumber(env.slopeAheadDeg)}° à frente`, t`Reduza o passo e firme o apoio nos próximos ${SIM.slopeLookaheadM} m.`);
  }
  const reported = hazardWarning(hazards.list);
  if (reported) alerts.push(reported);
  if (target.kind === 'stop' && focusStop.risk && target.distM <= LIMITS.stopRiskWarnM) {
    add('risco-parada', 'info', t`Risco na parada ${focusStop.id}: ${focusStop.risk}`, t`Avalie o terreno antes de começar a coleta.`);
  }
}

/**
 * Alertas por severidade. Cada um traz o texto do HUD e a ação que o assistente recomenda.
 * `key` identifica o alerta para saber se ele é novo (igual a `kind`, salvo nos perigos relatados).
 * @returns {Array<{ kind: string, key: string, level: 'critico'|'atencao'|'info', text: string, action: string }>}
 */
export function buildAlerts(context) {
  if (context.finished) return [];
  const alerts = [];
  const add = (kind, level, text, action) => alerts.push({ kind, key: kind, level, text, action });
  const home = habitatLine(context);
  if (context.emergencies.solar) {
    add('solar', 'critico', t`Evento solar · radiação ${SIM.solarEventFactor}× acima do normal (simulado)`, t`Interrompa a coleta e vá para o abrigo. ${home}.`);
  }
  if (context.emergencies.storm) {
    add('tempestade', 'critico', t`Tempestade de poeira · visibilidade reduzida (simulado)`, t`Pare, firme os pés e siga só a rota marcada no visor. ${home}.`);
  }
  suitAlerts(context, add);
  if (context.emergencies.radio) {
    add('radio', 'atencao', t`Falha de rádio com o habitat (simulada)`, t`O visor segue funcionando sem rádio. Não avance para uma parada nova.`);
  } else if (context.comms.lineOfSight === false) {
    add('sem-visada', 'info', t`Sem linha de visada de rádio com o habitat · volta em ${fmtDistance(context.comms.backInM)}`, t`O relevo tapa o mastro do habitat neste trecho (relevo real; alturas de antena são hipótese da equipe). O visor segue funcionando sem rádio.`);
  }
  terrainAlerts(context, alerts, add);
  return alerts.sort((a, b) => SEVERITIES.indexOf(a.level) - SEVERITIES.indexOf(b.level));
}

/**
 * Monta o contexto a partir da simulação compartilhada (src/simulation.js).
 * @param {{
 *   plan: object, stops: ReadonlyArray<object>, state: object, readout: object,
 *   emergencies: { storm: boolean, radio: boolean, o2: boolean },
 *   hazards: ReadonlyArray<object>, outingId: string, journal: object,
 *   protocol: { id: string, step: number } | null,
 *   protocols: Record<string, object>, assumptions: { o2ReservePct: number },
 *   walkBackH: number, shelter: object | null, alerts?: Array<object>,
 * }} input
 *   `plan` de buildPlan; `stops` de describeStops; `state` e `readout` da simulação;
 *   `hazards` de createHazardStore().list(); `journal` de createJournal().stats();
 *   `protocols` de bindProtocols; `assumptions`, `walkBackH` e `shelter` de context.safety.
 *   `alerts` é opcional: quem tem motor de alertas próprio passa a lista pronta.
 * @returns {import('./assistente.js').AssistantContext}
 */
export function buildContext({ plan, stops, state, readout, emergencies, hazards, outingId, journal, protocol, protocols, assumptions, walkBackH, shelter, alerts }) {
  const { here, target } = readout;
  const suit = suitStatus(plan, state, readout, emergencies.o2);
  const geo = toGeo(here.x, here.z);
  const located = locateHazards(hazards, here, readout.heading, outingId);
  const context = {
    mode: plan.mode,
    isCustom: Boolean(plan.isCustom),
    finished: state.finished,
    paused: state.paused,
    stopsReached: state.stopsReached,
    elapsedH: readout.elapsedH,
    clockH: readout.clockH,
    position: { x: here.x, z: here.z, lat: geo.lat, lon: geo.lon, elevM: here.elev, distM: here.distM, totalM: plan.path.totalM, onFoot: here.onFoot },
    target: { kind: target.kind, stopId: target.stop.id, name: target.name, label: target.label, distM: target.distM, etaH: target.etaH, gainM: target.gainM },
    atStop: target.kind === 'dwell',
    focusStop: stops.find((stop) => stop.id === target.stop.id),
    stops,
    plan: {
      stopCount: plan.stopCount,
      totalKm: plan.stats.totalKm,
      hours: plan.stats.hours,
      blockedLegs: plan.stats.blockedLegs.map((leg) => `${leg.from}→${leg.to}`),
    },
    suit,
    env: {
      slopeDeg: readout.slopeDeg,
      slopeAheadDeg: readout.slopeAheadDeg,
      radiationUsvH: readout.radiationRate,
      doseUsv: readout.doseUsv,
      airTempC: readout.airTempC,
    },
    habitat: habitatReturn(plan, here, suit.o2Pct, walkBackH),
    comms: commsStatus(plan, here.distM, emergencies.radio),
    noReturn: plan.safety?.noReturn ? { distM: plan.safety.noReturn.distM, aheadM: plan.safety.noReturn.distM - here.distM } : null,
    shelter,
    assumptions,
    protocols,
    riskZone: { edgeM: Math.max(0, readout.hazard.edgeM), side: readout.hazard.side, near: readout.hazard.near },
    emergencies: { ...emergencies, solar: state.solarEvent },
    protocol,
    hazards: { total: hazards.length, nearest: located[0] ?? null, list: located },
    journal,
  };
  return { ...context, alerts: alerts ?? buildAlerts(context) };
}
