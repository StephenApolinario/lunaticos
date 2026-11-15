// Motor de protocolos: cada alerta grave abre um protocolo passo a passo, com um
// ponto de decisão (seguir ou abortar), a ida ao abrigo e o passo final. Funções puras.

import { protocolFor } from '../../data/protocolos.js';
import { t } from '../../src/i18n.js';
import { PROTOCOLS, levelOrder } from './catalog.js';

export const createProtocols = () => Object.freeze([]);

/** Passos de um protocolo: confirmar, decidir, ir ao abrigo, confirmar o fim. */
export function stepsOf(id) {
  const protocol = PROTOCOLS[id];
  return [
    ...protocol.before.map((text, index) => ({ type: 'ok', text, effect: protocol.effects?.[index] ?? null })),
    { type: 'decision', text: t`Decidir: seguir a missão ou abortar.` },
    { type: 'go', text: t`Ir para o abrigo indicado.` },
    { type: 'ok', text: protocol.after, effect: protocol.afterEffect ?? null },
  ];
}

const decisionIndex = (id) => PROTOCOLS[id].before.length;

// Título e origem: o protocolo da equipe (data/protocolos.js) quando existe um equivalente.
function origin(id) {
  const { shared, name } = PROTOCOLS[id];
  if (!shared) return { title: name, source: t`Proposta desta variante` };
  const team = protocolFor(shared);
  return { title: team.title, source: t`${team.source} · base: ${team.evidence[0].label}` };
}
const pending = (list) => list.filter((instance) => !instance.done);

/** O protocolo em condução: o mais grave e, no empate, o mais recente. */
export function conducting(list) {
  return pending(list).reduce((best, instance) => {
    if (!best) return instance;
    const diff = levelOrder(instance.level) - levelOrder(best.level);
    return diff > 0 || (diff === 0 && instance.startedH > best.startedH) ? instance : best;
  }, null);
}

export const hasPending = (list) => pending(list).length > 0;

/**
 * Concilia os protocolos com os alertas ativos: abre os novos, fecha os de alertas
 * encerrados, reabre a decisão quando o alerta agrava e conclui a ida ao abrigo.
 * @returns {{ list: ReadonlyArray<object>, events: Array<{ type: 'started'|'closed'|'reopened'|'arrived', id: string }> }}
 */
export function syncProtocols(list, alerts, sheltered, clockH) {
  const events = [];
  const next = [];
  for (const instance of list) {
    const alert = alerts.find((candidate) => candidate.id === instance.id);
    if (!alert) {
      events.push({ type: 'closed', id: instance.id });
      continue;
    }
    let updated = instance;
    if (levelOrder(alert.level) > levelOrder(instance.level)) {
      updated = { ...updated, level: alert.level };
      if (instance.done && instance.decision === 'seguir') {
        updated = { ...updated, done: false, decision: null, step: decisionIndex(instance.id) };
        events.push({ type: 'reopened', id: instance.id });
      }
    }
    if (!updated.done && stepsOf(updated.id)[updated.step].type === 'go' && sheltered) {
      updated = { ...updated, step: updated.step + 1 };
      events.push({ type: 'arrived', id: updated.id });
    }
    next.push(updated);
  }
  for (const alert of alerts) {
    // Só alerta de atenção para cima abre protocolo (abrigado, o nível já caiu para informação).
    if (!PROTOCOLS[alert.id] || levelOrder(alert.level) === 0 || next.some((instance) => instance.id === alert.id)) continue;
    next.push({ id: alert.id, step: 0, decision: null, done: false, level: alert.level, startedH: clockH });
    events.push({ type: 'started', id: alert.id });
  }
  return { list: Object.freeze(next), events };
}

const replace = (list, id, changes) => Object.freeze(list.map((instance) => (instance.id === id ? { ...instance, ...changes } : instance)));

/** Confirma o passo atual, se ele for de confirmação. Devolve também o efeito do passo, se houver. */
export function confirmStep(list, id) {
  const instance = list.find((candidate) => candidate.id === id);
  if (!instance || instance.done) return { list, effect: null };
  const steps = stepsOf(id);
  const step = steps[instance.step];
  if (step.type !== 'ok') return { list, effect: null };
  const isLast = instance.step === steps.length - 1;
  return { list: replace(list, id, isLast ? { done: true } : { step: instance.step + 1 }), effect: step.effect };
}

/** Registra a decisão. Seguir encerra o protocolo; abortar leva ao passo de ida ao abrigo. */
export function decide(list, id, choice) {
  const instance = list.find((candidate) => candidate.id === id);
  if (!instance || instance.done || stepsOf(id)[instance.step].type !== 'decision') return list;
  return replace(list, id, choice === 'seguir' ? { decision: 'seguir', done: true } : { decision: 'abortar', step: instance.step + 1 });
}

/**
 * O protocolo em condução pronto para a tela: passos com estado, recomendação e abrigo.
 * @param {object} r Leitura do instante (readout.js).
 * @param {(pick: object|null) => string} goText Texto do passo de ida ao abrigo.
 */
export function protocolView(list, r, goText) {
  const instance = conducting(list);
  if (!instance) return null;
  const pick = r.picks[instance.id];
  const steps = stepsOf(instance.id).map((step, index) => ({
    type: step.type,
    text: step.type === 'go' ? goText(pick) : step.text,
    state: index < instance.step ? 'done' : index === instance.step ? 'current' : 'todo',
  }));
  return {
    id: instance.id,
    ...origin(instance.id),
    steps,
    stepNumber: instance.step + 1,
    current: steps[instance.step],
    pick,
    recommendation: PROTOCOLS[instance.id].recommend(r),
    queued: pending(list).filter((other) => other.id !== instance.id).map((other) => PROTOCOLS[other.id].name),
  };
}
