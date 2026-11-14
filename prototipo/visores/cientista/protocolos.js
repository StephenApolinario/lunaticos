// Emergências da demonstração e a condução dos protocolos em conversa.
// Os passos NÃO moram aqui: vêm dos protocolos compartilhados (context.safety.protocols,
// de ../../data/protocolos.js), que são propostas da equipe com fatos de missão e fonte.
// Este módulo liga cada emergência ao seu protocolo e acrescenta os números do momento.

import { fmtDistance, fmtDuration, fmtNumber } from '../../src/format.js';
import { habitatLine, pct, LIMITS } from './contexto.js';

const arrivalLine = (context) => (
  context.habitat.o2ArrivalPct >= 0
    ? `você chegaria com cerca de ${pct(context.habitat.o2ArrivalPct)} de O₂`
    : 'o O₂ atual não cobre a volta: peça resgate'
);

/** Abrigos a partir de onde se está: o habitat e, se houver, a proteção de relevo mais próxima. */
export function shelterLine(context) {
  const habitat = habitatLine(context);
  const away = context.habitat.distM >= LIMITS.atHabitatM && context.habitat.walkH !== null;
  const walk = away ? ` (a pé pelo relevo: ${fmtDuration(context.habitat.walkH)})` : '';
  const site = context.shelter?.terrain;
  if (!site) return `${habitat}${walk}. Não há proteção de relevo mapeada por perto.`;
  return `${habitat}${walk}. Proteção de relevo mais próxima: encosta a ${fmtDistance(site.distM)}, cerca de ${fmtDuration(site.walkH)} a pé, que tapa ${pct(site.skyBlocked * 100)} do céu. É estimativa geométrica sobre o relevo real, não abrigo pressurizado.`;
}

// `alert`: tipo de alerta que dispara o protocolo. `protocolId`: id em data/protocolos.js.
// `live`: os números do momento, ditos junto com o primeiro passo.
export const EMERGENCIES = Object.freeze({
  storm: Object.freeze({
    label: 'Tempestade de poeira',
    alert: 'tempestade',
    protocolId: 'tempestade',
    live: (context) => `Agora: O₂ em ${pct(context.suit.o2Pct)}. ${habitatLine(context)}; ${arrivalLine(context)}.`,
  }),
  solar: Object.freeze({
    label: 'Evento solar',
    alert: 'solar',
    protocolId: 'evento-solar',
    live: (context) => `Agora: taxa simulada de ${fmtNumber(context.env.radiationUsvH)} µSv/h. ${shelterLine(context)}`,
  }),
  radio: Object.freeze({
    label: 'Perda de rádio',
    alert: 'radio',
    protocolId: 'radio',
    live: (context) => `Agora: O₂ em ${pct(context.suit.o2Pct)}, margem de ${fmtDuration(context.suit.marginH)} ao fim do plano. O visor não depende do rádio: rota, relevo, diário e perigos relatados estão guardados aqui.`,
  }),
  o2: Object.freeze({
    label: 'Oxigênio baixo',
    alert: 'o2-critico',
    protocolId: 'oxigenio',
    live: (context) => `Agora: O₂ em ${pct(context.suit.o2Pct)}; a volta gasta cerca de ${pct(context.habitat.o2UsePct)} e ${arrivalLine(context)}.`,
  }),
});

export const PROTOCOL_BY_ALERT = Object.freeze(
  Object.fromEntries(Object.entries(EMERGENCIES).map(([id, emergency]) => [emergency.alert, id])),
);

/**
 * Protocolos compartilhados indexados pela emergência desta variante.
 * @param {(id: string) => object} protocolFor `context.safety.protocolFor`.
 */
export function bindProtocols(protocolFor) {
  return Object.freeze(Object.fromEntries(Object.entries(EMERGENCIES).map(([id, emergency]) => [id, protocolFor(emergency.protocolId)])));
}

export const protocolStepCount = (protocol, context) => context.protocols[protocol.id].steps.length;

/** "Passo 2 de 4: …" para o passo atual do protocolo. */
export function protocolStepText(protocol, context) {
  const { steps } = context.protocols[protocol.id];
  return `Passo ${protocol.step + 1} de ${steps.length}: ${steps[protocol.step]}`;
}

export function protocolIntroText(protocol, context) {
  const shared = context.protocols[protocol.id];
  return `${shared.title}. ${protocolStepText(protocol, context)} Diga “feito” para avançar. ${EMERGENCIES[protocol.id].live(context)} Protocolo proposto pela equipe, não é procedimento oficial da NASA.`;
}

/** Fatos de missão que sustentam o protocolo, com a fonte de cada um. */
export function protocolEvidenceText(id, context) {
  const { evidence } = context.protocols[id];
  if (!evidence?.length) return 'Este protocolo não traz fato de missão associado nos dados.';
  return evidence.map((fact) => `${fact.text} Fonte: ${fact.label}.`).join(' ');
}
