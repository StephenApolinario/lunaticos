// Gerente de alertas, no espírito dos painéis de aviso de voo: cada condição vira um
// alerta com nível, os alertas são ordenados por prioridade, podem ser reconhecidos
// e tudo fica em um histórico de tamanho limitado. Funções puras.

import { t } from '../../src/i18n.js';
import { levelOrder } from './catalog.js';

const HISTORY_MAX = 60;

export const createAlerts = () => Object.freeze({ active: Object.freeze([]), history: Object.freeze([]) });

// Nível mais alto primeiro; no mesmo nível, o que ainda não foi reconhecido e o mais recente.
function byPriority(a, b) {
  return levelOrder(b.level) - levelOrder(a.level) || Number(a.ack) - Number(b.ack) || b.raisedH - a.raisedH;
}

const logEntry = (alert, clockH, note) => ({ id: alert.id, level: alert.level, title: alert.title, raisedH: clockH, ackH: null, clearedH: null, note });

// Atualiza o registro aberto mais recente de um alerta.
function updateOpen(history, id, changes) {
  const index = history.findLastIndex((entry) => entry.id === id && entry.clearedH === null);
  if (index < 0) return history;
  return history.map((entry, i) => (i === index ? { ...entry, ...changes } : entry));
}

/**
 * Concilia as condições detectadas com os alertas ativos.
 * @param {Array<{ id: string, level: string, title: string, cause: string, effect: string, action: string }>} conditions
 * @returns {{ state: ReturnType<typeof createAlerts>, events: Array<{ type: 'raised'|'escalated'|'cleared', alert: object }> }}
 */
export function syncAlerts(previous, conditions, clockH) {
  const events = [];
  let { history } = previous;
  const active = conditions.map((condition) => {
    const old = previous.active.find((alert) => alert.id === condition.id);
    // Informação não pede reconhecimento.
    const fresh = { ...condition, raisedH: clockH, ack: condition.level === 'info' };
    if (!old) {
      events.push({ type: 'raised', alert: fresh });
      history = [...history, logEntry(fresh, clockH, null)];
      return fresh;
    }
    if (levelOrder(condition.level) > levelOrder(old.level)) {
      // Agravou: volta a pedir reconhecimento e abre novo registro.
      events.push({ type: 'escalated', alert: fresh });
      history = [...updateOpen(history, old.id, { clearedH: clockH }), logEntry(fresh, clockH, t`agravou`)];
      return fresh;
    }
    return { ...condition, raisedH: old.raisedH, ack: old.ack || condition.level === 'info' };
  });
  for (const old of previous.active) {
    if (conditions.some((condition) => condition.id === old.id)) continue;
    events.push({ type: 'cleared', alert: old });
    history = updateOpen(history, old.id, { clearedH: clockH });
  }
  return {
    state: Object.freeze({ active: Object.freeze(active.sort(byPriority)), history: Object.freeze(history.slice(-HISTORY_MAX)) }),
    events,
  };
}

/** Reconhece um alerta: ele continua ativo, mas para de soar e de pedir atenção. */
export function ackAlert(state, id, clockH) {
  const target = state.active.find((alert) => alert.id === id);
  if (!target || target.ack) return state;
  return Object.freeze({
    active: Object.freeze(state.active.map((alert) => (alert.id === id ? { ...alert, ack: true } : alert)).sort(byPriority)),
    history: Object.freeze(updateOpen(state.history, id, { ackH: clockH })),
  });
}

/** O alerta de maior prioridade que ainda espera reconhecimento. */
export const firstUnacked = (state) => state.active.find((alert) => !alert.ack) ?? null;
