// Telas do assistente (DOM): conversa, ciência da parada e diário da saída.
// Cada tela é uma peça independente: cria o próprio elemento, recebe os dados por método e
// avisa o que a pessoa fez por callbacks. `createPanel` junta as três em abas, com o cabeçalho
// do assistente. Nenhuma depende do HUD; o CSS delas está em componentes.css.
// Todo texto de quem usa (pergunta, observação, nota) entra como nó de texto, via h().

import { h, setText } from '../../src/dom.js';
import { MAX_NOTE_CHARS, entryLabel, fmtPosition, fmtStamp } from './diario.js';
import { HAZARD_TYPES } from './perigos.js';

const TABS = Object.freeze([
  { id: 'chat', label: 'Conversa' },
  { id: 'science', label: 'Ciência' },
  { id: 'journal', label: 'Diário' },
]);
const MAX_MESSAGES = 120;
const MAX_QUESTION_CHARS = 240;
const SPEAKER = Object.freeze({ user: 'Você', assistant: 'Assistente', alert: 'Assistente · alerta' });

const button = (label, props = {}) => h('button', { type: 'button', ...props }, label);

function micButton(idleLabel, onClick) {
  const node = button(idleLabel, { class: 'cientista-mic', 'aria-pressed': 'false', hidden: true, onclick: onClick });
  /** Mostra o botão só onde há reconhecimento de fala e marca quando está ouvindo. */
  const setListening = (canListen, listening) => {
    node.hidden = !canListen;
    setText(node, listening ? 'Ouvindo…' : idleLabel);
    node.setAttribute('aria-pressed', String(listening));
  };
  return { node, setListening };
}

/**
 * Conversa: histórico, perguntas rápidas e campo de texto.
 * @param {{ onAsk: (question: string) => void, onMic: () => void }} handlers
 */
export function createChatView({ onAsk, onMic }) {
  let quickKey = '';
  const log = h('ol', { class: 'cientista-log', tabIndex: 0, 'aria-label': 'Histórico da conversa' });
  const quick = h('div', { class: 'cientista-quick', role: 'group', 'aria-label': 'Perguntas rápidas' });
  const input = h('input', {
    type: 'text', class: 'cientista-input', maxLength: MAX_QUESTION_CHARS, autocomplete: 'off', enterKeyHint: 'send',
    placeholder: 'Pergunte ao assistente…', 'aria-label': 'Pergunta para o assistente',
  });
  const mic = micButton('Falar', onMic);
  const form = h('form', {
    class: 'cientista-ask',
    onsubmit: (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      onAsk(text);
    },
  }, input, mic.node, h('button', { type: 'submit', class: 'cientista-send' }, 'Enviar'));
  const element = h('section', { class: 'cientista-ui cientista-pane cientista-pane-chat', 'aria-label': 'Conversa' }, log, quick, form);

  const scrollToEnd = () => { log.scrollTop = log.scrollHeight; };

  /** @param {{ from: 'user'|'assistant'|'alert', text: string, stamp: string }} message */
  function addMessage({ from, text, stamp }) {
    log.append(h('li', { class: 'cientista-msg', dataset: { from } },
      h('span', { class: 'cientista-msg-meta' }, `${SPEAKER[from] ?? SPEAKER.assistant} · ${stamp}`),
      h('p', {}, text)));
    while (log.childElementCount > MAX_MESSAGES) log.firstElementChild.remove();
    scrollToEnd();
  }

  /** @param {ReadonlyArray<[string, string]>} questions Pares [rótulo, pergunta]. */
  function setQuickQuestions(questions) {
    const key = questions.map(([label]) => label).join('|');
    if (key === quickKey) return;
    quickKey = key;
    quick.replaceChildren(...questions.map(([label, question]) => button(label, { class: 'cientista-chip', onclick: () => onAsk(question) })));
  }

  function clear() {
    log.replaceChildren();
    input.value = '';
    quickKey = '';
    quick.replaceChildren();
  }

  return Object.freeze({ element, addMessage, setQuickQuestions, setListening: mic.setListening, focusInput: () => input.focus(), scrollToEnd, clear });
}

function checkItem(text, props = {}) {
  const box = h('input', { type: 'checkbox', ...props });
  const label = h('span', {}, text);
  return { item: h('li', {}, h('label', { class: 'cientista-check' }, box, label)), box, label };
}

/**
 * Ciência da parada: objetivo, pergunta científica, lista de verificação e registro da amostra.
 * @param {{ onRecordSample: (note: string) => void, onMic: () => void, onSuggest: () => void, onContinue: () => void }} handlers
 */
export function createScienceView({ onRecordSample, onMic, onSuggest, onContinue }) {
  const checks = new Map();
  let stopId = null;
  const eyebrow = h('p', { class: 'cientista-eyebrow' });
  const title = h('h3', {});
  const status = h('p', { class: 'cientista-status' });
  const objective = h('dd', {});
  const question = h('dd', {});
  const remember = (field) => (event) => checks.set(stopId, { ...checks.get(stopId), [field]: event.target.checked });
  const risk = checkItem('', { onchange: remember('risk') });
  const task = checkItem('', { onchange: remember('task') });
  const sample = checkItem('Amostra registrada no diário', { disabled: true });

  const note = h('textarea', { class: 'cientista-note', rows: 3, maxLength: MAX_NOTE_CHARS, placeholder: 'O que você viu e coletou…', 'aria-label': 'Observação da amostra' });
  const dictate = micButton('Ditar', onMic);
  const form = h('form', {
    class: 'cientista-sample',
    onsubmit: (event) => {
      event.preventDefault();
      onRecordSample(note.value);
      note.value = '';
    },
  }, note, h('div', { class: 'cientista-actions' }, dictate.node, h('button', { type: 'submit', class: 'cientista-send' }, 'Registrar amostra')));
  const resume = button('Concluir parada e seguir', { class: 'cientista-send cientista-resume', hidden: true, onclick: onContinue });

  const element = h('section', { class: 'cientista-ui cientista-pane cientista-pane-science', 'aria-label': 'Ciência da parada' },
    eyebrow, title, status,
    h('dl', { class: 'cientista-facts' }, h('dt', {}, 'Objetivo'), objective, h('dt', {}, 'Pergunta científica'), question),
    h('h4', {}, 'Lista de verificação'),
    h('ul', { class: 'cientista-checklist' }, risk.item, task.item, sample.item),
    button('O que observar aqui?', { class: 'cientista-chip', onclick: onSuggest }),
    h('h4', {}, 'Registro da amostra'),
    form, resume,
    h('p', { class: 'cientista-fine' }, 'Textos das paradas: roteiro da travessia (dados do protótipo). Hora e posição do registro vêm da simulação.'));

  function showStop(stop) {
    stopId = stop.id;
    setText(eyebrow, `${stop.id === 'H' ? 'Habitat' : `Parada ${stop.id}`} · capítulo “${stop.ch}”`);
    setText(title, stop.name);
    setText(objective, stop.sci);
    setText(question, stop.q);
    setText(task.label, `Tarefa: ${stop.task}`);
    setText(risk.label, stop.risk ? `Risco do local conferido: ${stop.risk}` : '');
    risk.item.hidden = !stop.risk;
    const saved = checks.get(stop.id) ?? {};
    risk.box.checked = Boolean(saved.risk);
    task.box.checked = Boolean(saved.task);
  }

  /**
   * @param {{ stop: object, atStop: boolean, paused: boolean, statusText: string, sampleCount: number }} view
   *   `stop` no formato de data/travessia.js (`id`, `name`, `ch`, `sci`, `q`, `task`, `risk`).
   */
  function update({ stop, atStop, paused, statusText, sampleCount }) {
    if (stopId !== stop.id) showStop(stop);
    setText(status, statusText);
    setText(sample.label, sampleCount ? `Amostra registrada no diário (${sampleCount})` : 'Amostra registrada no diário');
    if (sample.box.checked !== sampleCount > 0) sample.box.checked = sampleCount > 0;
    const canResume = atStop && paused;
    if (resume.hidden === canResume) resume.hidden = !canResume;
  }

  function appendNote(text) {
    note.value = `${note.value} ${text}`.trim().slice(0, MAX_NOTE_CHARS);
  }

  function clear() {
    note.value = '';
    checks.clear();
    stopId = null;
  }

  return Object.freeze({ element, update, appendNote, setListening: dictate.setListening, clear });
}

/**
 * Diário: registros da saída, exportação e perigos relatados guardados.
 * @param {{ onExport: () => void, onDeleteHazard: (id: string) => void }} handlers
 */
export function createJournalView({ onExport, onDeleteHazard }) {
  const entryList = h('ol', { class: 'cientista-entries', tabIndex: 0, 'aria-label': 'Registros da saída' });
  const hazardList = h('ul', { class: 'cientista-hazards', 'aria-label': 'Perigos relatados' });
  const element = h('section', { class: 'cientista-ui cientista-pane cientista-pane-journal', 'aria-label': 'Diário da saída' },
    h('div', { class: 'cientista-actions' },
      h('h4', {}, 'Registros desta saída'),
      button('Exportar .txt', { class: 'cientista-chip', onclick: onExport })),
    entryList,
    h('h4', {}, 'Perigos relatados ', h('small', {}, 'guardados neste navegador')),
    hazardList);

  const entryItem = (entry) => h('li', { dataset: { kind: entry.kind } },
    h('span', { class: 'cientista-msg-meta' }, `${entryLabel(entry.kind)}${entry.stopId ? ` · parada ${entry.stopId}` : ''} · ${fmtStamp(entry)}`),
    h('p', {}, `${entry.text} (${fmtPosition(entry.position)})`));

  const hazardItem = (hazard, outingId) => {
    const label = HAZARD_TYPES[hazard.type];
    const note = hazard.note ? ` · “${hazard.note}”` : '';
    return h('li', {},
      h('p', {}, h('strong', {}, label), ` · ${fmtPosition(hazard)}${note} · ${hazard.outing === outingId ? 'desta saída' : 'de saída anterior'}`),
      button('Apagar', { class: 'cientista-chip', 'aria-label': `Apagar relato: ${label}`, onclick: () => onDeleteHazard(hazard.id) }));
  };

  /**
   * @param {ReadonlyArray<object>} entries `createJournal().entries()`.
   * @param {ReadonlyArray<object>} hazards `createHazardStore().list()`.
   * @param {string} outingId Saída atual, para separar os relatos de saídas anteriores.
   */
  function render(entries, hazards, outingId) {
    entryList.replaceChildren(...(entries.length ? entries.map(entryItem) : [h('li', { class: 'cientista-empty' }, 'Nenhum registro ainda.')]));
    hazardList.replaceChildren(...(hazards.length
      ? hazards.map((hazard) => hazardItem(hazard, outingId))
      : [h('li', { class: 'cientista-empty' }, 'Nenhum perigo relatado neste navegador.')]));
    entryList.scrollTop = entryList.scrollHeight;
  }

  return Object.freeze({ element, render });
}

/**
 * Painel do assistente: cabeçalho (voz, fechar) e as três telas em abas.
 * @param {HTMLElement} root Elemento que recebe o painel.
 * @param {{
 *   onAsk: (text: string) => void, onMic: (target: 'chat'|'note') => void, onVoiceToggle: () => void,
 *   onRecordSample: (note: string) => void, onContinue: () => void, onSuggest: () => void,
 *   onExport: () => void, onDeleteHazard: (id: string) => void, onClose: () => void,
 * }} handlers
 */
export function createPanel(root, handlers) {
  const chat = createChatView({ onAsk: handlers.onAsk, onMic: () => handlers.onMic('chat') });
  const science = createScienceView({
    onRecordSample: handlers.onRecordSample, onMic: () => handlers.onMic('note'), onSuggest: handlers.onSuggest, onContinue: handlers.onContinue,
  });
  const journal = createJournalView({ onExport: handlers.onExport, onDeleteHazard: handlers.onDeleteHazard });
  const views = { chat, science, journal };

  const voiceButton = button('Voz desligada', { class: 'cientista-chip', 'aria-pressed': 'false', onclick: handlers.onVoiceToggle });
  const tabButtons = TABS.map((tab) => button(tab.label, { 'aria-pressed': 'false', dataset: { tab: tab.id }, onclick: () => setTab(tab.id) }));

  root.classList.add('cientista-ui');
  root.append(
    h('header', { class: 'cientista-panel-head' },
      h('div', {}, h('strong', {}, 'Assistente de campo'), h('small', { class: 'cientista-sim' }, 'simulado por regras', h('span', { class: 'cientista-wide' }, ' · sem modelo de linguagem'))),
      voiceButton,
      button('×', { class: 'cientista-close', 'aria-label': 'Fechar painel do assistente', onclick: handlers.onClose })),
    h('div', { class: 'cientista-tabs', role: 'group', 'aria-label': 'Seções do painel' }, tabButtons),
    chat.element, science.element, journal.element,
  );

  function setTab(id) {
    for (const tab of TABS) {
      views[tab.id].element.hidden = tab.id !== id;
      tabButtons.find((candidate) => candidate.dataset.tab === tab.id).setAttribute('aria-pressed', String(tab.id === id));
    }
    if (id === 'chat') chat.scrollToEnd();
  }

  /** @param {{ canSpeak: boolean, canListen: boolean, speaking: boolean, listening: string|null }} voice */
  function setVoiceState({ canSpeak, canListen, speaking, listening }) {
    voiceButton.disabled = !canSpeak;
    setText(voiceButton, !canSpeak ? 'Voz indisponível' : speaking ? 'Voz ligada' : 'Voz desligada');
    voiceButton.setAttribute('aria-pressed', String(speaking));
    chat.setListening(canListen, listening === 'chat');
    science.setListening(canListen, listening === 'note');
  }

  function reset() {
    chat.clear();
    science.clear();
    setTab('chat');
  }

  setTab('chat');
  return Object.freeze({ chat, science, journal, setTab, setVoiceState, reset });
}
