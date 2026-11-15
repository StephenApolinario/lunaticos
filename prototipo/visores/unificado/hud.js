// HUD do visor único no desenho "cabine escura": a vista do terreno fica livre e só o que o
// astronauta precisa o tempo todo está na tela. No alto, a linha da saída, o rumo e a próxima
// parada; embaixo, três blocos (O₂, bateria, volta a pé), a barra única do estado com a frase da
// IA e o minimapa. O resto abre a pedido, em três folhas: próxima parada e terreno, traje e
// ambiente, volta a pé e abrigo. Alertas e protocolo aparecem sozinhos, no alto, e não saem.
// Monta a marcação uma vez e, a cada quadro, só escreve o que mudou (sem innerHTML).

import { SIM } from '../../src/simulation.js';
import { clamp } from '../../src/geo.js';
import { fmtDistance, fmtDuration, fmtNumber, fmtClock, fmtSigned } from '../../src/format.js';
import { h, svg, setRichText, setText } from '../../src/dom.js';
import { t } from '../../src/i18n.js';
import { RULES, FAULTS, SCENARIOS, SHELTER_NAMES } from '../guardiao/catalog.js';
import { fmtWalk } from '../guardiao/rules.js';
import { createAlertStack, createProtocolPanel, createShelterPanel, createHistoryPanel, setData, setHidden } from '../guardiao/panels.js';
import { createEdgeIndicator } from '../navegador/mundo.js';
import { HAZARD_TYPES } from '../cientista/perigos.js';
import { alertReading } from './guia.js';

const CARDINALS = Object.freeze(['N', 'NE', t('L', 'ponto cardeal'), 'SE', 'S', t('SO', 'ponto cardeal'), t('O', 'ponto cardeal'), t('NO', 'ponto cardeal')]);
const SCRUB_MAX = 1000;
const O2_WARN_PCT = 35;
const ZONE_COLOR = Object.freeze({ ok: 'var(--guardiao-ok)', justa: 'var(--guardiao-atencao)', nao: 'var(--guardiao-emergencia)' });
const RADIO_TEXT = Object.freeze({ ok: t`visada direta`, noise: t`com ruído`, shadow: t`sem visada` });
const TREND_LABEL = Object.freeze({ up: t`subindo`, down: t`caindo`, down2: t`caindo rápido`, flat: t`estável` });
const SHEET_TITLES = Object.freeze({ rota: t`Próxima parada e terreno à frente`, traje: t`Traje e ambiente`, volta: t`Volta a pé e abrigo` });
// Um pouco mais que a animação `cabine-pisca` do visor.css.
const FLASH_MS = 1700;
const SOURCES_TEXT = t('Declive, altitude e visada do rádio: DEM real (USGS/JPL); a altura das antenas é hipótese da equipe. Radiação: média medida pelo RAD do Curiosity. Temperatura: estimada entre os extremos medidos pelo REMS. Oxigênio: calculado com a taxa metabólica medida na Apollo e o tanque do traje avançado da NASA (não há traje real). Bateria: hipótese da equipe. Pressão: a do traje EMU. Vento: sem medição desde o sol 1491; o cenário usa o mais forte publicado.');

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;
const pct = (value) => `${fmtNumber(Math.max(0, value))}%`;
const RESERVE_TEXT = t`Reserva de ${fmtNumber(RULES.o2ReservePct, 1)}%.`;
const minutes = (hours) => `${Math.max(1, Math.round(hours * 60))} min`;
const below = (value, danger, warn) => (value < danger ? 'danger' : value < warn ? 'warn' : 'ok');
const above = (value, warn, danger) => (value >= danger ? 'danger' : value >= warn ? 'warn' : 'ok');
const button = (text, props = {}) => h('button', { type: 'button', ...props }, text);
const icon = (...paths) => svg('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, ...paths);
const micIcon = () => icon(svg('rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }), svg('path', { d: 'M5 11a7 7 0 0 0 14 0M12 18v3' }));
const chatIcon = () => icon(svg('path', { d: 'M4 5h16v11H9l-5 4z' }));

function setTrend(arrow, dir) {
  setData(arrow, 'dir', dir);
  if (arrow.getAttribute('aria-label') !== TREND_LABEL[dir]) arrow.setAttribute('aria-label', TREND_LABEL[dir]);
}

// Linha "rótulo · valor" de uma folha. `note` é a ressalva da leitura (calc., est., hip., …).
function row(text, { note = null, trend = false } = {}) {
  const value = h('b');
  const arrow = trend ? h('i', { class: 'guardiao-tendencia', role: 'img' }) : null;
  return { value, arrow, node: h('div', { class: 'guardiao-linha' }, h('span', {}, text, note && h('small', {}, ` ${note}`)), h('span', { class: 'guardiao-valor' }, value, arrow)) };
}
function setRow(target, text, level = 'ok') {
  setText(target.value, text);
  setData(target.value, 'level', level);
}

// Bloco do canto: rótulo, valor grande e uma terceira linha (barra ou nota). Abre uma folha.
function block(id, text, onclick) {
  const value = h('b');
  const bar = h('i', { class: 'cabine-bloco-barra' });
  const note = h('span', { class: 'cabine-bloco-nota' });
  const node = button([h('span', { class: 'cabine-bloco-rotulo' }, text), value], { class: 'cabine-bloco', 'aria-expanded': 'false', dataset: { bloco: id }, onclick });
  return { node, value, bar, note };
}
function setGauge(target, value, level) {
  const fill = (clamp(value, 0, 100) / 100).toFixed(3);
  if (target.fill !== fill) {
    target.fill = fill;
    target.bar.style.setProperty('--fill', fill);
  }
  setData(target.node, 'level', level);
  setText(target.value, pct(value));
}

function stat(text) {
  const value = h('b');
  return { value, node: h('div', { class: 'cabine-dado' }, h('span', {}, text), value) };
}

function sheet(id, onClose, ...children) {
  const title = SHEET_TITLES[id];
  return h('section', { class: 'cabine-folha', hidden: true, dataset: { folha: id }, 'aria-label': title },
    h('header', {}, h('span', { class: 'cabine-folha-titulo' }, title), button(t`Fechar`, { class: 'cabine-fechar', 'aria-label': t`Fechar: ${title}`, onclick: onClose })),
    ...children);
}

function zonesGradient(zones) {
  let from = '0';
  const stops = zones.map((zone) => {
    const to = (zone.to * 100).toFixed(1);
    const stop = `${ZONE_COLOR[zone.status]} ${from}% ${to}%`;
    from = to;
    return stop;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function modeText(r) {
  if (r.finished) return t`no habitat`;
  if (r.sheltered) return t`abrigado · ${SHELTER_NAMES[r.sheltered].toLowerCase()}`;
  let how = t`a pé`;
  if (r.m.inCabin) how = t`no veículo`;
  else if (r.offRoute) how = t`a pé · fora da rota`;
  return r.nav.kind === 'hold' ? `${how} · ${t`parado`}` : how;
}

// O que a pílula diz ao lado do nome do alvo.
function targetInfo(target) {
  if (target.kind === 'home') return t`você está aqui`;
  if (target.kind === 'dwell') return t`coleta · faltam ${fmtDuration(target.etaH)}`;
  if (target.timeOnly) return t`${fmtDuration(target.etaH)} a pé`;
  return `${fmtDistance(target.distM)} · ${fmtDuration(target.etaH)}`;
}

function buildElements(on) {
  const toggle = (id) => () => on.sheet(id);
  return {
    clock: h('p', { class: 'cabine-hora' }),
    heading: h('b'), cardinal: h('span'),
    stopBadge: h('span', { class: 'cabine-parada-num' }), stopName: h('b'), stopInfo: h('span', { class: 'cabine-parada-info' }),
    // Folha da rota
    targetLabel: h('span', { class: 'cabine-folha-sub' }),
    distance: stat(t`Distância`), arrival: stat(t`Chegada`), gain: stat(t`Desnível`), slope: stat(t`Declive`),
    profile: h('canvas', { class: 'navegador-perfil-tela', role: 'img', 'aria-label': t`Perfil de altitude da rota à frente` }),
    profileCaption: h('span'), radioAhead: h('p', { class: 'cabine-folha-texto' }),
    // Blocos e folha do traje
    o2: block('o2', 'O₂', toggle('traje')), battery: block('bateria', t`Bateria`, toggle('traje')), ret: block('volta', t`Volta a pé`, toggle('volta')),
    alertLabel: h('span', { class: 'cabine-bloco-rotulo' }), alertValue: h('b'), alertNote: h('span', { class: 'cabine-bloco-nota' }),
    pins: h('div', { class: 'cabine-pinos' }),
    o2Row: row('O₂', { note: t`calc.` }), o2Rate: row(t`Consumo`), o2End: row(t`O₂ no fim`, { note: t`calc.` }),
    batteryRow: row(t`Bateria`, { note: t`hip.` }), pressure: row(t`Pressão`, { note: 'EMU', trend: true }), integrity: row(t`Integridade`, { note: t`treino` }),
    radiation: row(t`Radiação`, { note: 'RAD', trend: true }), dose: row(t`Dose`, { note: t`est.` }),
    temperature: row(t`Temperatura`, { note: t`est.`, trend: true }), wind: row(t`Vento`), radio: row(t`Rádio`, { note: t`calc.` }), altitude: row(t`Altitude`, { trend: true }),
    // Folha da volta a pé
    retQuestion: h('span', { class: 'cabine-folha-sub' }), retVerdict: h('b', { class: 'guardiao-veredito' }), retOxygen: h('p', { class: 'cabine-folha-texto' }),
    strip: h('div', { class: 'guardiao-faixa', role: 'img' }), stripDone: h('i', { class: 'guardiao-faixa-feito' }),
    stripHere: h('i', { class: 'guardiao-faixa-aqui' }), stripPnr: h('i', { class: 'guardiao-faixa-pnr' }), pnrText: h('span', { class: 'guardiao-sub guardiao-pnr-texto' }),
    habitat: row(t`Habitat`),
    // Barra única
    statusWord: h('b'), assistant: h('span', { class: 'cabine-fala', role: 'status', 'aria-live': 'polite' }), assistantNote: h('small', { class: 'cabine-fala-nota' }),
    talk: button(chatIcon(), { class: 'cabine-redondo cabine-conversar', 'aria-label': t`Abrir a conversa com a IA de bordo`, title: t`Abrir a conversa (tecla /)`, onclick: on.talk }),
    mic: button(micIcon(), { class: 'cabine-redondo', 'aria-label': t`Falar com a IA de bordo`, 'aria-pressed': 'false', hidden: true, onclick: on.mic }),
    // Minimapa
    minimap: h('canvas', { class: 'navegador-minimapa', 'aria-hidden': 'true' }),
    zoomIn: button('+', { 'aria-label': t`Aproximar o minimapa (tecla +)`, onclick: () => on.zoom(-1) }),
    zoomOut: button('−', { 'aria-label': t`Afastar o minimapa (tecla -)`, onclick: () => on.zoom(1) }),
    zoomLabel: h('span', { class: 'guardiao-sub' }),
    // Cena
    world: h('canvas', { class: 'navegador-mundo', 'aria-hidden': 'true' }), edge: createEdgeIndicator(),
    markers: h('div', { class: 'cientista-markers', 'aria-hidden': 'true' }),
    // A faixa livre do meio da tela, por onde se vê a rota à frente. Só serve para medir essa área.
    area: h('i', { class: 'unificado-area', 'aria-hidden': 'true' }),
    announcer: h('p', { class: 'visually-hidden', role: 'alert' }), dust: h('div', { class: 'guardiao-poeira', 'aria-hidden': 'true' }),
    markPnr: h('div', { class: 'guardiao-marca', hidden: true, dataset: { kind: 'pnr' } }), markShelter: h('div', { class: 'guardiao-marca', hidden: true, dataset: { kind: 'abrigo' } }),
    drawer: h('aside', { class: 'unificado-gaveta cientista-panel', 'aria-label': t`Assistente, ciência da parada e diário`, hidden: true }),
    // Controles do protótipo
    exit: button(t`← Voltar ao tablet`, { class: 'guardiao-primario', title: t`Voltar ao tablet (Esc)`, onclick: on.exit }),
    pause: button(t`Pausar`, { onclick: on.pause }),
    speed: h('select', { 'aria-label': t`Velocidade da simulação`, onchange: (event) => on.speed(Number(event.target.value)) }, SIM.speeds.map((speed) => h('option', { value: String(speed) }, `${speed}×`))),
    scrub: h('input', { type: 'range', min: '0', max: String(SCRUB_MAX), value: '0', 'aria-label': t`Posição na rota`, oninput: (event) => on.scrub(Number(event.target.value) / SCRUB_MAX) }),
    trayButton: button(t`Controles`, { title: t`Assistente, relato de perigo, som e cenários de treino`, 'aria-expanded': 'false' }),
    drawerButton: button(t`Assistente`, { title: t`Conversa, ciência da parada e diário (tecla /)`, 'aria-expanded': 'false', onclick: on.drawer }),
    hazardButton: button(t`Relatar perigo`, { title: t`Marcar um perigo onde você está`, 'aria-expanded': 'false' }),
    history: button(t`Histórico`, { title: t`Histórico de alertas (tecla H)`, 'aria-expanded': 'false', onclick: on.history }),
    sound: button(t`Som`, { title: t`Som dos alertas (tecla M)`, onclick: on.sound }),
    voice: button(t`Voz`, { title: t`Voz do assistente (tecla V)`, onclick: on.voice }),
  };
}

/**
 * @param {HTMLElement} mount
 * @param {Record<string, Function>} on Ações: pause, speed, scrub, exit, scenario, clear, ack, confirm, decide,
 *   sound, voice, history, drawer, talk, mic, report, zoom, openMap (volta ao tablet pelo minimapa) e sheet (abre ou
 *   fecha uma folha: 'rota', 'traje', 'volta' ou null).
 */
export function createHud(mount, on) {
  const els = buildElements(on);
  const closeSheet = () => on.sheet(null);
  els.strip.append(els.stripDone, els.stripPnr, els.stripHere);
  els.o2.node.append(els.o2.bar);
  els.battery.node.append(els.battery.bar);
  els.ret.node.append(els.ret.note);

  const alertStack = createAlertStack(on.ack);
  const protocolPanel = createProtocolPanel({ onConfirm: on.confirm, onDecide: on.decide });
  const shelterPanel = createShelterPanel();
  const historyPanel = createHistoryPanel(on.history);
  const scenarioButtons = SCENARIOS.map((scenario, index) => ({
    scenario,
    node: button([h('kbd', {}, String(index + 1)), ` ${scenario.label}`], { 'aria-pressed': 'false', onclick: () => { setTrayOpen(false); on.scenario(scenario.id); } }),
  }));
  const popHazard = h('div', { class: 'unificado-pop', role: 'group', 'aria-label': t`Relatar perigo aqui`, hidden: true },
    h('b', {}, t`Relatar perigo aqui`),
    Object.entries(HAZARD_TYPES).map(([type, text]) => button(text, { onclick: () => { closePops(); els.trayButton.focus(); on.report(type); } })),
    h('span', { class: 'unificado-nota' }, t`Fica guardado neste navegador e avisa nas próximas saídas.`));

  const stop = button([els.stopBadge, els.stopName, els.stopInfo], { class: 'cabine-parada', 'aria-expanded': 'false', title: SHEET_TITLES.rota, onclick: () => on.sheet('rota') });
  const alertBlock = h('div', { class: 'cabine-bloco', hidden: true, dataset: { bloco: 'alerta' } }, els.alertLabel, els.alertValue, els.alertNote);
  const sheets = {
    rota: sheet('rota', closeSheet, els.targetLabel,
      h('div', { class: 'cabine-dados' }, els.distance.node, els.arrival.node, els.gain.node, els.slope.node),
      els.profile, h('p', { class: 'cabine-folha-texto' }, els.profileCaption, ` · ${t`faixa de baixo: rádio`}`), els.radioAhead),
    traje: sheet('traje', closeSheet,
      h('div', { class: 'cabine-colunas' },
        h('div', {}, h('b', {}, t`Traje`), els.o2Row.node, els.o2Rate.node, els.o2End.node, els.batteryRow.node, els.pressure.node, els.integrity.node),
        h('div', {}, h('b', {}, t`Ambiente`), els.radiation.node, els.dose.node, els.temperature.node, els.wind.node, els.radio.node, els.altitude.node)),
      h('p', { class: 'cabine-legenda' }, t`calc. = calculado · est. = estimado · hip. = hipótese. A lista completa de fontes fica no tablet.`),
      h('details', { class: 'cabine-fontes' }, h('summary', {}, t`De onde vem cada leitura`), h('p', {}, SOURCES_TEXT))),
    volta: sheet('volta', closeSheet, els.retQuestion, els.retVerdict, els.retOxygen, els.strip, els.pnrText, els.habitat.node, shelterPanel.root),
  };
  const tray = h('div', { class: 'cabine-bandeja', hidden: true },
    h('div', { class: 'guardiao-controles', role: 'toolbar', 'aria-label': t`Assistente, perigos, som e voz` }, els.drawerButton, els.hazardButton, els.history, els.sound, els.voice),
    h('div', { class: 'guardiao-cenarios', role: 'toolbar', 'aria-label': t`Cenários de emergência para demonstração` },
      h('span', { class: 'guardiao-rotulo' }, t`Cenários de treino`), scenarioButtons.map((entry) => entry.node),
      button([h('kbd', {}, '0'), ` ${t`Limpar`}`], { class: 'guardiao-limpar', onclick: () => { setTrayOpen(false); on.clear(); } })));
  const dock = h('div', { class: 'guardiao-doca cabine-doca' },
    h('div', { class: 'cabine-doca-linha', role: 'toolbar', 'aria-label': t`Controles da simulação` }, els.exit, els.pause, els.speed, els.scrub, els.trayButton),
    tray);
  const bar = h('div', { class: 'cabine-barra', dataset: { kind: 'guia' } },
    h('span', { class: 'cabine-estado' }, h('i', { 'aria-hidden': 'true' }), els.statusWord),
    h('span', { class: 'cabine-fala-caixa' }, els.assistant, els.assistantNote), els.talk, els.mic);

  const root = h('div', { class: 'guardiao unificado cabine', dataset: { level: 'seguro', gaveta: 'fechada', mapa: 'on', folha: 'nenhuma' } },
    els.dust, els.world, els.markers,
    h('div', { class: 'guardiao-moldura', 'aria-hidden': 'true' }),
    els.markPnr, els.markShelter, els.edge,
    h('div', { class: 'cabine-vista' },
      h('div', { class: 'cabine-alto' }, els.clock,
        h('section', { class: 'cabine-rumo', 'aria-label': t`Rumo` }, els.heading, els.cardinal), h('span', { 'aria-hidden': 'true' })),
      els.area,
      h('div', { class: 'cabine-centro' }, stop,
        h('div', { class: 'cabine-aviso' }, alertStack.root, protocolPanel.root), sheets.rota),
      h('div', { class: 'cabine-base' },
        h('div', { class: 'cabine-blocos' }, els.o2.node, els.battery.node, els.ret.node, alertBlock, els.pins),
        bar,
        h('section', { class: 'cabine-mapa', 'aria-label': t`Minimapa` },
          // Tocar no minimapa abre o mapa inteiro, no tablet, centrado no astronauta.
          button(els.minimap, {
            class: 'cabine-mapa-botao', title: t`Abrir o mapa no tablet`, onclick: on.openMap,
            'aria-label': t`Minimapa: você no centro, rumo para cima, rota, paradas e linha de rádio até o habitat. Abrir o mapa no tablet`,
          }),
          h('div', { class: 'unificado-zoom' }, els.zoomOut, els.zoomLabel, els.zoomIn)),
        sheets.traje, sheets.volta)),
    historyPanel.root, els.drawer, popHazard, dock, els.announcer);
  mount.replaceChildren(root);

  const flashTargets = { o2: els.o2.node, bateria: els.battery.node, volta: els.ret.node, parada: stop, hora: els.clock };
  const flashTimers = new Map();
  const sheetOpeners = { rota: stop, traje: els.o2.node, volta: els.ret.node };
  const blocks = { o2: els.o2.node, bateria: els.battery.node, volta: els.ret.node };
  let gradient = '';
  let hiddenBlocks = new Set();
  let layout = { width: 0, height: 0, free: { left: 0, top: 0, width: 0, height: 0 } };

  // Tamanho do palco e a área livre no centro, para as marcas no terreno e o indicador de borda.
  function measure() {
    const frame = mount.getBoundingClientRect();
    const cell = els.area.getBoundingClientRect();
    layout = { width: frame.width, height: frame.height, free: { left: cell.left - frame.left, top: cell.top - frame.top, width: cell.width, height: cell.height } };
  }
  const resized = new ResizeObserver(measure);
  resized.observe(mount);
  resized.observe(els.area);
  // A barra de controles muda de altura com a largura da tela: o visor acompanha o tamanho real dela.
  new ResizeObserver(() => root.style.setProperty('--guardiao-doca', `${dock.offsetHeight}px`)).observe(dock);

  function setTrayOpen(open) {
    // Fechar a bandeja com o foco dentro dela devolve o foco ao botão que a abre.
    const hadFocus = !open && tray.contains(document.activeElement);
    tray.hidden = !open;
    els.trayButton.setAttribute('aria-expanded', String(open));
    if (hadFocus) els.trayButton.focus();
  }
  function setHazardOpen(open) {
    popHazard.hidden = !open;
    els.hazardButton.setAttribute('aria-expanded', String(open));
    if (open) popHazard.querySelector('button').focus();
  }
  /** Fecha os menus abertos. @returns {boolean} true se havia algum aberto. */
  function closePops() {
    const wasOpen = !popHazard.hidden || !tray.hidden;
    setHazardOpen(false);
    setTrayOpen(false);
    return wasOpen;
  }
  els.trayButton.addEventListener('click', () => { const open = tray.hidden; closePops(); setTrayOpen(open); });
  els.hazardButton.addEventListener('click', () => { closePops(); setHazardOpen(true); });

  function renderTop(r, viewHeading) {
    setText(els.clock, t`${fmtDuration(r.clockH)} de saída · ${fmtClock(r.localClockH)} hora local · ${modeText(r)}`);
    const heading = Math.round(viewHeading) % 360;
    setText(els.heading, `${String(heading).padStart(3, '0')}°`);
    setText(els.cardinal, CARDINALS[Math.round(normalizeDeg(viewHeading) / 45) % 8]);
    setText(els.stopBadge, r.target.stopId ?? '');
    setHidden(els.stopBadge, !r.target.stopId);
    setText(els.stopName, r.target.name);
    setText(els.stopInfo, targetInfo(r.target));
  }

  // `radio`: { ahead: string, soon: boolean }, a frase do Navegador sobre quando o sinal muda seguindo a rota.
  function renderRoute(r, radio) {
    const { target } = r;
    const still = target.kind === 'home' || target.kind === 'dwell';
    setText(els.targetLabel, `${target.label}: ${target.name}`);
    let distance = fmtDistance(target.distM);
    if (still) distance = t`aqui`;
    else if (target.timeOnly) distance = t`sem medida`;
    setText(els.distance.value, distance);
    setText(els.arrival.value, target.kind === 'home' ? t`chegou` : fmtDuration(target.etaH));
    setText(els.gain.value, still || target.timeOnly ? t`sem medida` : `${fmtSigned(target.gainM)} m`);
    setText(els.slope.value, t`${fmtSigned(r.slopeDeg)}° · ${fmtNumber(r.slopeAheadDeg)}° à frente`);
    setData(els.slope.value, 'level', above(r.slopeAheadDeg, RULES.slopeCautionDeg, RULES.slopeDangerDeg));
    const lost = r.radio.state === 'lost';
    setText(els.radioAhead, lost || r.finished ? '' : `${t`Rádio: ${RADIO_TEXT[r.radio.state]}.`} ${radio.ahead}`);
    setData(els.radioAhead, 'soon', radio.soon && !lost);
  }

  function renderSuit(r, trends) {
    setGauge(els.o2, r.o2Pct, below(r.o2Pct, RULES.o2ReservePct, O2_WARN_PCT));
    setGauge(els.battery, r.batteryPct, below(r.batteryPct, RULES.batteryDangerPct, RULES.batteryCautionPct));
    setRow(els.o2Row, r.o2RatePctH > 0 ? t`${pct(r.o2Pct)} · resta ${fmtDuration(r.o2AutonomyH)}` : pct(r.o2Pct), els.o2.node.dataset.level);
    setRow(els.o2Rate, r.o2RatePctH > 0 ? `${fmtNumber(r.o2RatePctH, 1)} %/h` : t`parado no habitat`);
    setRow(els.o2End, `${fmtNumber(Math.round(r.o2EndPct))}%`, below(r.o2EndPct, 0, RULES.o2ReservePct));
    setRow(els.batteryRow, pct(r.batteryPct), els.battery.node.dataset.level);
    setRow(els.pressure, `${fmtNumber(r.pressureKpa, 1)} kPa`, below(r.pressureKpa, RULES.pressureNominalKpa * 0.9, RULES.pressureNominalKpa * 0.98));
    let integrity = 'ok';
    if (r.integrityPct < 100) integrity = r.patched ? 'warn' : 'danger';
    setRow(els.integrity, pct(r.integrityPct), integrity);
    setTrend(els.pressure.arrow, trends.pressure ?? 'flat');
  }

  function renderEnvironment(r, trends) {
    setRow(els.radiation, `${fmtNumber(r.radiationRate)} µSv/h`, r.fx.radFactor > 1 ? 'danger' : 'ok');
    setRow(els.dose, t`${fmtNumber(r.doseUsv)} de ${fmtNumber(RULES.doseLimitUsv)} µSv`, above(r.doseUsv / RULES.doseLimitUsv, RULES.doseCautionFrac, 1));
    setRow(els.temperature, `${fmtNumber(r.airTempC)} °C`, r.airTempC < RULES.suitMinTempC ? 'danger' : 'ok');
    setRow(els.wind, r.windMps === null ? t`sem medição` : `${fmtNumber(r.windMps)} m/s`, above(r.windMps ?? 0, RULES.windCautionMps, RULES.windDangerMps));
    const lost = r.radio.state === 'lost';
    setRow(els.radio, lost ? t`sem resposta · ${minutes(r.radio.lostH)}` : RADIO_TEXT[r.radio.state], lost ? 'danger' : r.radio.state === 'ok' ? 'ok' : 'warn');
    setRow(els.altitude, `${fmtNumber(r.altitudeM)} m`);
    setTrend(els.radiation.arrow, trends.radiation ?? 'flat');
    setTrend(els.temperature.arrow, trends.temperature ?? 'flat');
    setTrend(els.altitude.arrow, trends.altitude ?? 'flat');
  }

  function renderReturn(r) {
    const level = r.ret.ok || r.finished ? 'ok' : r.ret.reaches ? 'warn' : 'danger';
    const hasPath = Number.isFinite(r.ret.timeH);
    const walk = hasPath ? fmtDuration(r.ret.timeH) : t`sem caminho`;
    setText(els.ret.value, r.finished ? t`chegou` : walk);
    let note = t`O₂ não alcança`;
    if (r.ret.reaches) note = t`só com a reserva`;
    if (r.ret.ok) note = t`garantida`;
    setText(els.ret.note, r.finished ? t`no habitat` : note);
    setData(els.ret.node, 'level', level);

    const vehicleQuestion = r.m.vehicleM !== null && !r.m.vehicleDown;
    setText(els.retQuestion, vehicleQuestion ? t`Se o veículo quebrar aqui, volto a pé? Caminho no relevo real, O₂ calculado.` : t`Volto a pé ao habitat? Caminho no relevo real, O₂ calculado.`);
    let verdict = t`Não`;
    if (r.ret.reaches) verdict = t`Só com a reserva`;
    if (r.ret.ok) verdict = t`Sim`;
    setText(els.retVerdict, r.finished ? t`Você está no habitat` : `${verdict} · ${hasPath ? t`${walk} de caminhada` : t`sem caminho a pé conhecido`}`);
    setData(els.retVerdict, 'level', level);
    const oxygen = r.ret.reaches ? t`Gasta ${pct(r.ret.o2NeedPct)} de O₂ e chega com ${pct(r.ret.o2AfterPct)}.` : t`O O₂ não alcança.`;
    setText(els.retOxygen, `${oxygen} ${RESERVE_TEXT}`);

    const nextGradient = zonesGradient(r.zones);
    if (nextGradient !== gradient) {
      gradient = nextGradient;
      els.strip.style.backgroundImage = gradient;
    }
    els.stripDone.style.transform = `scaleX(${r.progress.toFixed(4)})`;
    els.stripHere.style.transform = `translateX(${(r.progress * 100).toFixed(2)}%)`;
    setHidden(els.stripPnr, r.pnr.status !== 'ahead' || r.finished);
    let pnrText = t`Sem ponto de não retorno nesta rota.`;
    if (r.pnr.status === 'ahead') {
      els.stripPnr.style.transform = `translateX(${((r.pnr.distM / r.plan.path.totalM) * 100).toFixed(2)}%)`;
      pnrText = t`Ponto de não retorno em ${fmtDistance(r.pnr.aheadM)} · ${fmtDuration(r.pnr.etaH)}`;
    }
    if (r.pnr.status === 'passed') pnrText = t`Ponto de não retorno ultrapassado.`;
    if (r.finished) pnrText = t`Saída encerrada.`;
    setText(els.pnrText, pnrText);
    setData(els.pnrText, 'status', r.finished ? 'none' : r.pnr.status);
    const stripLabel = `${t`Rota: ${pct(r.progress * 100)} percorrida.`} ${pnrText}`;
    if (els.strip.getAttribute('aria-label') !== stripLabel) els.strip.setAttribute('aria-label', stripLabel);
    const habitat = r.shelters.find((option) => option.kind === 'habitat');
    setRow(els.habitat, r.finished ? t`você está nele` : `${habitat.distM === null ? '' : `${fmtDistance(habitat.distM)} · `}${fmtWalk(habitat.timeH)} ${habitat.dirText}`);
  }

  // O bloco de alerta mostra a leitura que explica o alerta mais grave. Com alerta na tela, os
  // blocos que o astronauta mandou tirar voltam.
  function renderAlertBlock(r, alerts, alerting) {
    const reading = alerting ? alertReading(alerts.find((alert) => alert.level !== 'info'), r) : null;
    setHidden(alertBlock, !reading);
    if (reading) {
      setText(els.alertLabel, reading.label);
      setText(els.alertValue, reading.value);
      setText(els.alertNote, reading.note);
    }
    for (const [id, node] of Object.entries(blocks)) setHidden(node, hiddenBlocks.has(id) && !alerting);
  }

  function renderMark(node, mark) {
    setHidden(node, !mark);
    if (!mark) return;
    setText(node, mark.text);
    node.style.transform = `translate(${(mark.x * layout.width).toFixed(1)}px, ${(mark.y * layout.height).toFixed(1)}px)`;
  }

  /**
   * Desenha um quadro.
   * @param {{ r: object, alerts: { active: ReadonlyArray<object>, history: ReadonlyArray<object> }, trends: object, proto: object|null,
   *   status: { level: string, word: string, text: string }, line: { text: string, kind: string }, radio: { ahead: string, soon: boolean },
   *   viewHeading: number, marks: object, historyOpen: boolean }} view
   */
  function render({ r, alerts, trends, proto, status, line, radio, viewHeading, marks, historyOpen }) {
    renderTop(r, viewHeading);
    renderRoute(r, radio);
    setData(root, 'level', status.level);
    setData(root, 'pending', alerts.active.some((alert) => !alert.ack));
    setData(root, 'protocol', Boolean(proto));
    setText(els.statusWord, status.word);

    alertStack.update(alerts.active);
    protocolPanel.update(proto);
    shelterPanel.update(r.shelters, proto ? proto.pick : r.nearestShelter);
    historyPanel.update(alerts.history, historyOpen, r.startClockH);
    renderSuit(r, trends);
    renderEnvironment(r, trends);
    renderReturn(r);
    renderAlertBlock(r, alerts.active, status.level !== 'seguro');
    setRichText(els.assistant, line.text);
    setData(bar, 'kind', line.kind);

    let haze = 0;
    if (r.fx.dust) haze = r.fx.dust.arrived ? 1 : 0.15 + 0.45 * (1 - r.fx.dust.etaH / FAULTS.dustEtaH);
    const opacity = haze.toFixed(2);
    if (els.dust.style.opacity !== opacity) els.dust.style.opacity = opacity;
    renderMark(els.markPnr, marks.pnr);
    renderMark(els.markShelter, marks.shelter);
    // Enquanto a pessoa segura a barra, quem manda no valor é ela.
    if (!els.scrub.matches(':active')) {
      const value = String(Math.round(r.progress * SCRUB_MAX));
      if (els.scrub.value !== value) els.scrub.value = value;
    }
  }

  function syncSheets(open) {
    setData(root, 'folha', open ?? 'nenhuma');
    // Fechar uma folha com o foco dentro dela devolve o foco à peça que a abre.
    const closing = Object.keys(sheets).find((id) => id !== open && sheets[id].contains(document.activeElement));
    for (const [id, node] of Object.entries(sheets)) node.hidden = id !== open;
    if (closing) sheetOpeners[closing].focus();
    stop.setAttribute('aria-expanded', String(open === 'rota'));
    els.o2.node.setAttribute('aria-expanded', String(open === 'traje'));
    els.battery.node.setAttribute('aria-expanded', String(open === 'traje'));
    els.ret.node.setAttribute('aria-expanded', String(open === 'volta'));
  }

  /**
   * Estado dos botões, que só muda por ação do usuário ou da IA.
   * @param {{ state: object, mode: string, soundOn: boolean, voiceOn: boolean, hasVoice: boolean, historyOpen: boolean,
   *   drawerOpen: boolean, mapOn: boolean, sheet: 'rota'|'traje'|'volta'|null, hiddenBlocks: ReadonlySet<string>,
   *   zoom: { text: string, canIn: boolean, canOut: boolean }, mic: { canListen: boolean, listening: boolean },
   *   assistantNote: string, voiceInfo: string }} controls
   */
  function syncControls({ state, mode, soundOn, voiceOn, hasVoice, historyOpen, drawerOpen, mapOn, sheet: openSheet, hiddenBlocks: hidden, zoom, mic, assistantNote, voiceInfo }) {
    hiddenBlocks = hidden;
    syncSheets(openSheet);
    // A nota só traz texto quando há o que dizer: a IA verificando ou fora do ar.
    setText(els.assistantNote, assistantNote);
    // O botão de voz diz qual voz está em uso (a neural ou a do sistema).
    if (voiceInfo && els.voice.title !== voiceInfo) els.voice.title = voiceInfo;
    // O rótulo já diz o estado; aria-pressed junto com rótulo que muda seria contraditório.
    setText(els.pause, state.paused ? t`Continuar` : t`Pausar`);
    setData(els.pause, 'active', state.paused);
    els.speed.value = String(state.speed);
    els.sound.setAttribute('aria-pressed', String(soundOn));
    els.voice.setAttribute('aria-pressed', String(voiceOn));
    els.voice.disabled = !hasVoice;
    els.history.setAttribute('aria-expanded', String(historyOpen));
    els.drawerButton.setAttribute('aria-expanded', String(drawerOpen));
    els.drawer.hidden = !drawerOpen;
    setData(root, 'gaveta', drawerOpen ? 'aberta' : 'fechada');
    setData(root, 'mapa', mapOn ? 'on' : 'off');
    setText(els.zoomLabel, zoom.text);
    els.zoomIn.disabled = !zoom.canIn;
    els.zoomOut.disabled = !zoom.canOut;
    els.mic.hidden = !mic.canListen;
    els.mic.setAttribute('aria-pressed', String(mic.listening));
    els.mic.setAttribute('aria-label', mic.listening ? t`Ouvindo. Toque para parar` : t`Falar com a IA de bordo`);
    for (const { scenario, node } of scenarioButtons) {
      const unavailable = Boolean(scenario.needsVehicle) && mode !== 'car';
      node.disabled = unavailable;
      node.title = unavailable ? t`Só existe no plano com veículo` : '';
      node.setAttribute('aria-pressed', String(Boolean(state.scenarios[scenario.id])));
    }
  }

  /** Destaca por um instante peças que já estão na tela ('o2', 'bateria', 'volta', 'parada', 'hora'). */
  function flash(targets) {
    for (const node of targets.map((id) => flashTargets[id]).filter(Boolean)) {
      node.classList.remove('cabine-pisca');
      // Ler o tamanho obriga o navegador a recomeçar a animação quando a classe volta.
      node.getBoundingClientRect();
      node.classList.add('cabine-pisca');
      // Um temporizador por peça: pedir de novo só recomeça o destaque.
      clearTimeout(flashTimers.get(node));
      flashTimers.set(node, setTimeout(() => node.classList.remove('cabine-pisca'), FLASH_MS));
    }
  }

  return Object.freeze({
    canvases: Object.freeze({ minimap: els.minimap, profile: els.profile, world: els.world }),
    edge: els.edge,
    markers: els.markers,
    drawer: els.drawer,
    pins: els.pins,
    render,
    syncControls,
    closePops,
    flash,
    layout: () => layout,
    setProfileCaption: (text) => setText(els.profileCaption, text),
    announce: (text) => { els.announcer.textContent = text; },
    focus: () => els.pause.focus(),
    focusDrawerButton: () => els.talk.focus(),
  });
}
