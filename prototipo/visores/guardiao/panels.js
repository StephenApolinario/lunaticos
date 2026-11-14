// Painéis do HUD que mudam de forma: pilha de alertas, protocolo em condução, lista
// de abrigos e histórico. Os nós são reaproveitados e só o texto que mudou é escrito,
// para um clique não cair em um botão que acabou de ser recriado.

import { SIM } from '../../src/simulation.js';
import { fmtDistance, fmtDuration, fmtNumber, fmtClock } from '../../src/format.js';
import { h, setText } from '../../src/dom.js';
import { LEVELS } from './catalog.js';
import { fmtWalk } from './rules.js';

const MAX_VISIBLE_ALERTS = 3;
const SHELTER_KINDS = Object.freeze(['habitat', 'vehicle', 'terrain']);

export const setData = (node, key, value) => { const text = String(value); if (node.dataset[key] !== text) node.dataset[key] = text; };
export const setHidden = (node, hidden) => { if (node.hidden !== hidden) node.hidden = hidden; };
const key = (letter) => h('kbd', {}, letter);
const clock = (hours) => fmtClock(SIM.startClockH + hours);

/** Ícone de nível: a forma muda junto com a cor, para não depender só dela. */
export function levelIcon() {
  return h('i', { class: 'guardiao-icone', 'aria-hidden': 'true' });
}
export function setLevel(icon, level) {
  setData(icon, 'level', level);
  setData(icon, 'glyph', LEVELS[level]?.glyph ?? '✓');
}

function createAlertCard(onAck) {
  const icon = levelIcon();
  const level = h('span', { class: 'guardiao-alerta-nivel' });
  const title = h('b');
  const cause = h('dd');
  const effect = h('dd');
  const action = h('dd', { class: 'guardiao-acao' });
  const ack = h('button', { type: 'button', class: 'guardiao-ack', title: 'Reconhecer o alerta (tecla R)' }, 'Reconhecer');
  const root = h('article', { class: 'guardiao-alerta' },
    h('header', {}, icon, h('span', { class: 'guardiao-alerta-titulo' }, level, title), ack),
    h('dl', {}, h('dt', {}, 'Causa'), cause, h('dt', {}, 'Consequência'), effect, h('dt', { class: 'guardiao-acao' }, 'Ação'), action));
  let id = null;
  ack.addEventListener('click', () => onAck(id));
  return {
    root,
    update(alert, isTop) {
      id = alert.id;
      setLevel(icon, alert.level);
      setData(root, 'level', alert.level);
      setData(root, 'ack', alert.ack);
      setData(root, 'top', isTop);
      setText(level, LEVELS[alert.level].label);
      setText(title, alert.title);
      setText(cause, alert.cause);
      setText(effect, alert.effect);
      setText(action, alert.action);
      setHidden(ack, alert.ack);
    },
  };
}

/** Pilha de alertas: no máximo três cartões, o de maior prioridade aberto, e um contador do resto. */
export function createAlertStack(onAck) {
  const more = h('p', { class: 'guardiao-mais', hidden: true });
  const root = h('section', { class: 'guardiao-alertas', 'aria-label': 'Alertas' }, more);
  const cards = new Map();
  let order = '';
  return {
    root,
    update(alerts) {
      const visible = alerts.slice(0, MAX_VISIBLE_ALERTS);
      visible.forEach((alert, index) => {
        if (!cards.has(alert.id)) cards.set(alert.id, createAlertCard(onAck));
        cards.get(alert.id).update(alert, index === 0);
      });
      const nextOrder = visible.map((alert) => alert.id).join('|');
      if (nextOrder !== order) {
        order = nextOrder;
        for (const id of [...cards.keys()]) if (!visible.some((alert) => alert.id === id)) cards.delete(id);
        root.replaceChildren(...visible.map((alert) => cards.get(alert.id).root), more);
      }
      const hiddenCount = alerts.length - visible.length;
      setHidden(more, hiddenCount === 0);
      setText(more, hiddenCount === 0 ? '' : `+${hiddenCount} no histórico (tecla H)`);
    },
  };
}

/** Protocolo em condução: passos feitos, passo atual, o que falta e a decisão. */
export function createProtocolPanel({ onConfirm, onDecide }) {
  const name = h('b');
  const progress = h('span', { class: 'guardiao-progresso' });
  const steps = h('ol', { class: 'guardiao-passos' });
  const advice = h('p', { class: 'guardiao-recomendacao' });
  const confirm = h('button', { type: 'button', class: 'guardiao-confirmar', onclick: onConfirm }, 'Passo feito ', key('P'));
  const abortText = h('span');
  const abort = h('button', { type: 'button', class: 'guardiao-abortar', onclick: () => onDecide('abortar') }, abortText, ' ', key('A'));
  const carryOn = h('button', { type: 'button', class: 'guardiao-seguir', onclick: () => onDecide('seguir') }, 'Seguir a missão ', key('S'));
  const queue = h('p', { class: 'guardiao-fila' });
  const source = h('p', { class: 'guardiao-fila' });
  const root = h('section', { class: 'guardiao-bloco guardiao-protocolo', 'aria-label': 'Protocolo de emergência', hidden: true },
    h('header', {}, h('span', { class: 'guardiao-rotulo' }, 'Protocolo'), name, progress),
    steps, advice, h('div', { class: 'guardiao-acoes' }, confirm, abort, carryOn), queue, source);
  let shape = '';
  let items = [];
  return {
    root,
    update(view) {
      setHidden(root, !view);
      if (!view) return;
      const nextShape = `${view.id}:${view.steps.length}`;
      if (nextShape !== shape) {
        shape = nextShape;
        items = view.steps.map((step, index) => h('li', { dataset: { n: String(index + 1) } }));
        steps.replaceChildren(...items);
      }
      view.steps.forEach((step, index) => {
        setText(items[index], step.text);
        setData(items[index], 'state', step.state);
      });
      setText(name, view.title);
      setText(source, view.source);
      setText(progress, `passo ${view.stepNumber} de ${view.steps.length}`);
      const { type } = view.current;
      setData(root, 'step', type);
      const deciding = type === 'decision';
      setHidden(advice, type === 'ok');
      if (deciding) {
        setData(advice, 'abort', view.recommendation.abort);
        setText(advice, `${view.recommendation.abort ? 'Recomendo abortar' : 'Recomendo seguir'}: ${view.recommendation.why}.`);
      } else if (type === 'go') {
        setData(advice, 'abort', true);
        setText(advice, view.pick ? 'A caminho do abrigo. O passo fecha sozinho na chegada.' : 'Sem abrigo ao alcance: aguardando resgate.');
      }
      setHidden(confirm, type !== 'ok');
      setHidden(abort, !deciding);
      setHidden(carryOn, !deciding);
      setText(abortText, view.pick ? `Abortar · ir para ${view.pick.name}` : 'Abortar · aguardar resgate');
      setData(abort, 'recommended', view.recommendation.abort);
      setData(carryOn, 'recommended', !view.recommendation.abort);
      setHidden(queue, view.queued.length === 0);
      setText(queue, view.queued.length === 0 ? '' : `Na fila: ${view.queued.join(', ')}`);
    },
  };
}

function shelterInfo(option) {
  if (option.distM === null) return `${fmtWalk(option.timeH)} ${option.dirText} · caminho mais rápido no relevo`;
  if (option.distM < 1) return option.dirText;
  const sky = option.kind === 'terrain' ? ` · ${fmtNumber(option.skyBlocked * 100)}% do céu encoberto` : '';
  return `${fmtDistance(option.distM)} ${option.dirText} · ${fmtDuration(option.timeH)}${sky}`;
}

function shelterOxygen(option) {
  if (!option.reaches) return 'O₂ não alcança';
  return `O₂ chega com ${fmtNumber(Math.max(0, option.o2AfterPct))}%${option.usesReserve ? ' · usa a reserva' : ''}`;
}

/** Onde se abrigar: habitat, veículo e relevo, com distância, tempo e se o O₂ alcança. */
export function createShelterPanel() {
  const rows = Object.fromEntries(SHELTER_KINDS.map((kind) => {
    const name = h('b');
    const info = h('span');
    const oxygen = h('span', { class: 'guardiao-abrigo-o2' });
    return [kind, { name, info, oxygen, node: h('div', { class: 'guardiao-abrigo', hidden: true }, name, info, oxygen) }];
  }));
  const root = h('section', { class: 'guardiao-bloco guardiao-abrigos', 'aria-label': 'Onde se abrigar' },
    h('span', { class: 'guardiao-rotulo' }, 'Onde se abrigar', h('small', {}, ' estimado')),
    ...SHELTER_KINDS.map((kind) => rows[kind].node));
  return {
    root,
    update(shelters, pick) {
      for (const kind of SHELTER_KINDS) {
        const option = shelters.find((candidate) => candidate.kind === kind);
        const row = rows[kind];
        setHidden(row.node, !option);
        if (!option) continue;
        const chosen = pick?.kind === kind;
        setText(row.name, `${option.name}${option.down ? ' (em pane)' : ''}${chosen ? ' · indicado' : ''}`);
        setText(row.info, shelterInfo(option));
        setText(row.oxygen, shelterOxygen(option));
        setData(row.node, 'pick', chosen);
        setData(row.node, 'reach', option.reaches);
      }
    },
  };
}

function historyState(entry) {
  if (entry.clearedH !== null) return `encerrado ${clock(entry.clearedH)}`;
  if (entry.ackH !== null) return `reconhecido ${clock(entry.ackH)}`;
  return entry.level === 'info' ? 'ativo' : 'aguardando reconhecimento';
}

/** Histórico consultável: todos os alertas da saída, do mais novo para o mais antigo. */
export function createHistoryPanel(onClose) {
  const list = h('ol');
  const empty = h('p', { class: 'guardiao-sub' }, 'Nenhum alerta nesta saída.');
  const root = h('aside', { class: 'guardiao-historico', 'aria-label': 'Histórico de alertas', hidden: true },
    h('header', {}, h('b', {}, 'Histórico de alertas'), h('button', { type: 'button', onclick: onClose }, 'Fechar ', key('H'))),
    empty, list);
  let signature = null;
  return {
    root,
    update(history, open) {
      setHidden(root, !open);
      if (!open) return;
      const next = history.map((entry) => `${entry.id}${entry.raisedH}${entry.ackH}${entry.clearedH}`).join('|');
      if (next === signature) return;
      signature = next;
      setHidden(empty, history.length > 0);
      list.replaceChildren(...[...history].reverse().map((entry) => {
        const icon = levelIcon();
        setLevel(icon, entry.level);
        return h('li', { dataset: { level: entry.level, open: String(entry.clearedH === null) } },
          h('time', {}, clock(entry.raisedH)), icon,
          h('span', {}, h('b', {}, entry.title), entry.note ? ` (${entry.note})` : '', h('small', {}, ` ${LEVELS[entry.level].label} · ${historyState(entry)}`)));
      }));
    },
  };
}
