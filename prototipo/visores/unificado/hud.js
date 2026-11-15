// HUD do visor único. A base é o HUD do Guardião (estado de segurança, alertas, protocolo,
// abrigos, retorno a pé), adaptado de ../guardiao/hud.js para um layout novo que também
// recebe o minimapa, o perfil e a guia do Navegador e a linha e a gaveta do assistente.
// Monta a marcação uma vez e, a cada quadro, só escreve o que mudou (sem innerHTML).

import { SIM } from '../../src/simulation.js';
import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { fmtDistance, fmtDuration, fmtNumber, fmtClock, fmtSigned } from '../../src/format.js';
import { h, setRichText, setText } from '../../src/dom.js';
import { RULES, FAULTS, SCENARIOS, SHELTER_NAMES } from '../guardiao/catalog.js';
import { fmtWalk } from '../guardiao/rules.js';
import {
  createAlertStack, createProtocolPanel, createShelterPanel, createHistoryPanel, levelIcon, setLevel, setData, setHidden,
} from '../guardiao/panels.js';
import { createEdgeIndicator } from '../navegador/mundo.js';
import { HAZARD_TYPES } from '../cientista/perigos.js';

const COMPASS = Object.freeze({ pxPerDeg: 5, marginDeg: 60, tickDeg: 15, maxTargetDeg: 30 });
const CARDINALS = Object.freeze({ 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' });
const SCRUB_MAX = 1000;
const O2_WARN_PCT = 35;
const ZONE_COLOR = Object.freeze({ ok: 'var(--guardiao-ok)', justa: 'var(--guardiao-atencao)', nao: 'var(--guardiao-emergencia)' });
const RADIO_TEXT = Object.freeze({ ok: 'Visada direta', noise: 'Com ruído', shadow: 'Sem visada' });
const TREND_LABEL = Object.freeze({ up: 'subindo', down: 'caindo', down2: 'caindo rápido', flat: 'estável' });

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;
const pct = (value) => `${fmtNumber(Math.max(0, value))}%`;
const minutes = (hours) => `${Math.max(1, Math.round(hours * 60))} min`;
const below = (value, danger, warn) => (value < danger ? 'danger' : value < warn ? 'warn' : 'ok');
const above = (value, warn, danger) => (value >= danger ? 'danger' : value >= warn ? 'warn' : 'ok');
const label = (text, note) => h('span', { class: 'guardiao-rotulo' }, text, note && h('small', {}, ` ${note}`));
const button = (text, props = {}) => h('button', { type: 'button', ...props }, text);
// Texto com versão curta para a tela do telefone.
const wide = (text, short) => [h('span', { class: 'guardiao-so-largo' }, text), h('span', { class: 'guardiao-so-estreito' }, short)];

function trendArrow() {
  return h('i', { class: 'guardiao-tendencia', role: 'img' });
}
function setTrend(arrow, dir) {
  setData(arrow, 'dir', dir);
  if (arrow.getAttribute('aria-label') !== TREND_LABEL[dir]) arrow.setAttribute('aria-label', TREND_LABEL[dir]);
}

// Nome de uma leitura. `sim` é true para leitura simulada, ou o texto de outra ressalva.
function caption(text, short, sim) {
  return h('span', {}, short ? wide(text, short) : text, sim && h('small', {}, sim === true ? ' sim.' : ` ${sim}`));
}

// Linha "rótulo · valor", com seta de tendência opcional.
function row(text, { short = null, sim = false, trend = false } = {}) {
  const value = h('b');
  const arrow = trend ? trendArrow() : null;
  return { value, arrow, node: h('div', { class: 'guardiao-linha' }, caption(text, short, sim), h('span', { class: 'guardiao-valor' }, value, arrow)) };
}

function meter(text, short = null, note = true) {
  const value = h('b');
  const arrow = trendArrow();
  const node = h('div', { class: 'guardiao-medidor' }, caption(text, short, note), h('i', { class: 'guardiao-barra' }), h('span', { class: 'guardiao-valor' }, value, arrow));
  return { node, value, arrow };
}
function setMeter(target, value, level, trend) {
  const fill = (clamp(value, 0, 100) / 100).toFixed(3);
  if (target.fill !== fill) {
    target.fill = fill;
    target.node.style.setProperty('--fill', fill);
  }
  setData(target.node, 'level', level);
  setText(target.value, pct(value));
  setTrend(target.arrow, trend);
}
function setRow(target, text, level = 'ok') {
  setText(target.value, text);
  setData(target.value, 'level', level);
}

function buildCompassTape(tape) {
  const { pxPerDeg, marginDeg, tickDeg } = COMPASS;
  for (let deg = -marginDeg; deg <= 360 + marginDeg; deg += tickDeg) {
    const cardinal = CARDINALS[normalizeDeg(deg)] ?? '';
    tape.append(h('span', { class: cardinal ? 'guardiao-tick guardiao-tick-maior' : 'guardiao-tick', style: `left:${(deg + marginDeg) * pxPerDeg}px` }, cardinal));
  }
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
  if (r.finished) return 'No habitat';
  if (r.sheltered) return `Abrigado · ${SHELTER_NAMES[r.sheltered].toLowerCase()}`;
  const how = r.m.inCabin ? 'No veículo' : r.offRoute ? 'A pé · fora da rota' : 'A pé';
  return r.nav.kind === 'hold' ? `${how} · parado` : how;
}

function targetInfo(target) {
  if (target.kind === 'home') return 'você está no habitat';
  if (target.kind === 'dwell') return `coleta em andamento · faltam ${fmtDuration(target.etaH)}`;
  if (target.timeOnly) return `${fmtDuration(target.etaH)} a pé`;
  return `${fmtDistance(target.distM)} · ${fmtDuration(target.etaH)} · ${fmtSigned(target.gainM)} m`;
}

function buildElements(on) {
  return {
    elapsed: h('b', { class: 'guardiao-grande' }), mode: h('span', { class: 'guardiao-sub' }),
    tape: h('div', { class: 'guardiao-fita' }), targetMarker: h('i', { class: 'guardiao-alvo' }), heading: h('b', { class: 'guardiao-rumo' }),
    nextLabel: label('Próxima parada'), nextName: h('b', { class: 'guardiao-grande' }), nextInfo: h('span', { class: 'guardiao-sub' }),
    statusIcon: levelIcon(), statusWord: h('b'), statusText: h('span'),
    o2: meter('O₂', null, 'calc.'), o2Info: h('span', { class: 'guardiao-sub' }), battery: meter('Bateria', 'Bat.', 'hip.'),
    pressure: row('Pressão', { short: 'Press.', sim: 'EMU', trend: true }), integrity: row('Integridade', { short: 'Integr.', sim: 'treino' }),
    o2End: row('O₂ ao fim do plano', { short: 'O₂ fim', sim: 'calc.' }),
    radiation: row('Radiação', { short: 'Rad.', sim: 'RAD', trend: true }), dose: row('Dose da saída', { short: 'Dose', sim: 'est.' }),
    temperature: row('Temp. do ar', { short: 'Temp.', sim: 'est.', trend: true }), wind: row('Vento'),
    slope: row('Declive · à frente', { short: 'Decl./frente' }), altitude: row('Altitude', { short: 'Alt.', trend: true }),
    radio: row('Rádio', { sim: 'calc.' }), radioAhead: h('span', { class: 'guardiao-sub unificado-radio-adiante' }), habitat: row('Habitat'),
    retLabel: label('Volto a pé ao habitat?', 'caminho no relevo real · O₂ calculado'), retVerdict: h('b', { class: 'guardiao-veredito' }), retOxygen: h('span', { class: 'guardiao-sub' }),
    strip: h('div', { class: 'guardiao-faixa', role: 'img' }), stripDone: h('i', { class: 'guardiao-faixa-feito' }),
    stripHere: h('i', { class: 'guardiao-faixa-aqui' }), stripPnr: h('i', { class: 'guardiao-faixa-pnr' }), pnrText: h('span', { class: 'guardiao-sub guardiao-pnr-texto' }),
    profile: h('canvas', { class: 'navegador-perfil-tela', role: 'img', 'aria-label': 'Perfil de altitude da rota à frente' }),
    profileCaption: h('span'),
    minimap: h('canvas', { class: 'navegador-minimapa', role: 'img', 'aria-label': 'Minimapa: você no centro, rumo para cima, rota, paradas e linha de rádio até o habitat' }),
    zoomIn: button('+', { 'aria-label': 'Aproximar o minimapa (tecla +)', onclick: () => on.zoom(-1) }),
    zoomOut: button('−', { 'aria-label': 'Afastar o minimapa (tecla -)', onclick: () => on.zoom(1) }),
    zoomLabel: h('span', { class: 'guardiao-sub' }),
    world: h('canvas', { class: 'navegador-mundo', 'aria-hidden': 'true' }), edge: createEdgeIndicator(),
    markers: h('div', { class: 'cientista-markers', 'aria-hidden': 'true' }),
    // A célula livre do centro da grade, por onde se vê a rota à frente. Só serve para medir essa área.
    area: h('i', { class: 'unificado-area', 'aria-hidden': 'true' }),
    assistant: h('span', { class: 'guardiao-fala', role: 'status', 'aria-live': 'polite' }),
    assistantNote: h('small', {}, 'IA de bordo · verificando…'),
    talk: button('Conversar ', { class: 'unificado-botao', title: 'Abrir a conversa (tecla /)', onclick: on.talk }),
    mic: button('Falar', { class: 'unificado-botao', 'aria-pressed': 'false', hidden: true, onclick: on.mic }),
    announcer: h('p', { class: 'visually-hidden', role: 'alert' }), dust: h('div', { class: 'guardiao-poeira', 'aria-hidden': 'true' }),
    markPnr: h('div', { class: 'guardiao-marca', hidden: true, dataset: { kind: 'pnr' } }), markShelter: h('div', { class: 'guardiao-marca', hidden: true, dataset: { kind: 'abrigo' } }),
    drawer: h('aside', { class: 'unificado-gaveta cientista-panel', 'aria-label': 'Assistente, ciência da parada e diário', hidden: true }),
    pause: button('Pausar', { onclick: on.pause }),
    speed: h('select', { onchange: (event) => on.speed(Number(event.target.value)) }, SIM.speeds.map((speed) => h('option', { value: String(speed) }, `${speed}×`))),
    scrub: h('input', { type: 'range', min: '0', max: String(SCRUB_MAX), value: '0', 'aria-label': 'Posição na rota', oninput: (event) => on.scrub(Number(event.target.value) / SCRUB_MAX) }),
    drawerButton: button('Assistente', { title: 'Conversa, ciência da parada e diário (tecla /)', 'aria-expanded': 'false', onclick: on.drawer }),
    hazardButton: button(wide('Relatar perigo', 'Perigo'), { title: 'Marcar um perigo onde você está', 'aria-expanded': 'false' }),
    mapButton: button('Mapa', { title: 'Mostrar ou esconder o minimapa e o perfil', onclick: on.map }),
    readingsButton: button('Leituras', { title: 'Mostrar ou esconder traje e ambiente', onclick: on.readings }),
    scenarioButton: button('Cenários', { class: 'unificado-so-estreito', title: 'Cenários de emergência para treino', 'aria-expanded': 'false' }),
    sound: button('Som', { title: 'Som dos alertas (tecla M)', onclick: on.sound }),
    voice: button('Voz', { title: 'Voz do assistente (tecla V)', onclick: on.voice }),
    history: button(wide('Histórico', 'Hist.'), { title: 'Histórico de alertas (tecla H)', 'aria-expanded': 'false', onclick: on.history }),
    exit: button(['Voltar', h('span', { class: 'guardiao-so-largo' }, ' ao tablet')], { class: 'guardiao-primario', title: 'Voltar ao tablet (Esc)', onclick: on.exit }),
  };
}

/**
 * @param {HTMLElement} mount
 * @param {Record<string, Function>} on Ações: pause, speed, scrub, exit, scenario, clear, ack, confirm, decide,
 *   sound, voice, history, drawer, talk, mic, report, map, readings, zoom.
 */
export function createHud(mount, on) {
  const els = buildElements(on);
  els.strip.append(els.stripDone, els.stripPnr, els.stripHere);
  els.talk.append(h('kbd', {}, '/'));
  buildCompassTape(els.tape);

  const alertStack = createAlertStack(on.ack);
  const protocolPanel = createProtocolPanel({ onConfirm: on.confirm, onDecide: on.decide });
  const shelterPanel = createShelterPanel();
  const historyPanel = createHistoryPanel(on.history);
  const scenarioButtons = SCENARIOS.map((scenario, index) => ({
    scenario,
    // Em tela estreita os cenários são um menu: escolher um fecha o menu.
    node: button([h('kbd', {}, String(index + 1)), ` ${scenario.label}`], { 'aria-pressed': 'false', onclick: () => { setScenariosOpen(false); on.scenario(scenario.id); } }),
  }));
  const popHazard = h('div', { class: 'unificado-pop', role: 'group', 'aria-label': 'Relatar perigo aqui', hidden: true },
    h('b', {}, 'Relatar perigo aqui'),
    Object.entries(HAZARD_TYPES).map(([type, text]) => button(text, { onclick: () => { closePops(); els.hazardButton.focus(); on.report(type); } })),
    h('span', { class: 'unificado-nota' }, 'Fica guardado neste navegador e avisa nas próximas saídas.'));
  const dock = h('div', { class: 'guardiao-doca' },
    h('div', { class: 'guardiao-controles', role: 'toolbar', 'aria-label': 'Controles da simulação e do visor' },
      els.pause, h('label', {}, 'Velocidade ', els.speed), els.scrub,
      els.drawerButton, els.hazardButton, els.mapButton, els.readingsButton, els.scenarioButton, els.sound, els.voice, els.history, els.exit),
    h('div', { class: 'guardiao-cenarios', role: 'toolbar', 'aria-label': 'Cenários de emergência para demonstração' },
      label('Cenários', 'de treino'), scenarioButtons.map((entry) => entry.node),
      button([h('kbd', {}, '0'), ' Limpar'], { class: 'guardiao-limpar', onclick: () => { setScenariosOpen(false); on.clear(); } })));

  const root = h('div', { class: 'guardiao unificado', dataset: { level: 'seguro', gaveta: 'fechada', mapa: 'on', leituras: 'on', cenarios: 'fechado' } },
    els.dust, els.world, els.markers,
    h('div', { class: 'guardiao-moldura', 'aria-hidden': 'true' }),
    els.markPnr, els.markShelter, els.edge,
    h('div', { class: 'guardiao-vista' },
      h('section', { class: 'guardiao-bloco guardiao-relogio', 'aria-label': 'Tempo de saída' }, label('Tempo de saída'), els.elapsed, els.mode),
      h('section', { class: 'guardiao-bussola', 'aria-label': 'Bússola' },
        h('div', { class: 'guardiao-janela' }, els.tape, h('i', { class: 'guardiao-agulha' }), els.targetMarker), els.heading),
      h('section', { class: 'guardiao-bloco guardiao-destino', 'aria-label': 'Destino' }, els.nextLabel, els.nextName, els.nextInfo, els.habitat.node),
      h('section', { class: 'guardiao-status', 'aria-label': 'Estado de segurança' }, els.statusIcon, els.statusWord, els.statusText),
      h('div', { class: 'unificado-seguranca' }, alertStack.root, protocolPanel.root, shelterPanel.root),
      els.area,
      // Em tela larga este grupo não tem caixa (display: contents) e cada peça vai para a sua área da
      // grade; no telefone ele é a área livre, e minimapa e leituras abrem por cima dela.
      h('div', { class: 'unificado-livre' },
        h('i', { class: 'guardiao-mira', 'aria-hidden': 'true' }),
        h('section', { class: 'guardiao-bloco unificado-leituras', 'aria-label': 'Traje e ambiente' }, label('Traje e ambiente', 'calc. = calculado · est. = estimado · hip. = hipótese'),
          els.o2.node, els.o2Info, els.battery.node,
          h('div', { class: 'unificado-grade' }, els.pressure.node, els.integrity.node, els.o2End.node, els.radiation.node, els.dose.node,
            els.temperature.node, els.wind.node, els.slope.node, els.altitude.node),
          els.radio.node, els.radioAhead,
          h('span', { class: 'guardiao-fonte' }, 'Declive, altitude e visada do rádio: DEM real (USGS/JPL); a altura das antenas é hipótese da equipe. Radiação: média medida pelo RAD do Curiosity. Temperatura: estimada entre os extremos medidos pelo REMS. Oxigênio: calculado com a taxa metabólica medida na Apollo e o tanque do traje avançado da NASA (não há traje real). Bateria: hipótese da equipe. Pressão: a do traje EMU. Vento: sem medição desde o sol 1491; o cenário usa o mais forte publicado.')),
        h('section', { class: 'unificado-mapa', 'aria-label': 'Minimapa' }, els.minimap,
          h('div', { class: 'unificado-zoom' }, els.zoomOut, els.zoomLabel, els.zoomIn))),
      h('div', { class: 'guardiao-assistente unificado-fala', dataset: { kind: 'guia' } },
        h('span', { class: 'guardiao-rotulo' }, 'Assistente ', els.assistantNote), els.assistant, h('span', { class: 'unificado-fala-acoes' }, els.talk, els.mic)),
      h('section', { class: 'guardiao-bloco guardiao-retorno unificado-rota', 'aria-label': 'Retorno a pé e perfil à frente' },
        els.retLabel, h('div', { class: 'unificado-veredito' }, els.retVerdict, els.retOxygen), els.strip, els.pnrText,
        h('div', { class: 'unificado-perfil' }, els.profile,
          h('span', { class: 'guardiao-sub unificado-perfil-legenda' }, els.profileCaption, h('span', { class: 'guardiao-so-largo' }, ' · faixa de baixo: rádio'))))),
    historyPanel.root, els.drawer, popHazard, dock, els.announcer);
  const fala = els.assistant.parentElement;
  mount.replaceChildren(root);

  let gradient = '';
  let scenariosOpen = false;
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
  // A doca muda de altura com a largura da tela: o visor acompanha o tamanho real dela.
  new ResizeObserver(() => root.style.setProperty('--guardiao-doca', `${dock.offsetHeight}px`)).observe(dock);

  function setScenariosOpen(open) {
    scenariosOpen = open;
    setData(root, 'cenarios', open ? 'aberto' : 'fechado');
    els.scenarioButton.setAttribute('aria-expanded', String(open));
  }
  function setHazardOpen(open) {
    popHazard.hidden = !open;
    els.hazardButton.setAttribute('aria-expanded', String(open));
    if (open) popHazard.querySelector('button').focus();
  }
  /** Fecha os menus abertos. @returns {boolean} true se havia algum aberto. */
  function closePops() {
    const wasOpen = !popHazard.hidden || scenariosOpen;
    setHazardOpen(false);
    setScenariosOpen(false);
    return wasOpen;
  }
  els.hazardButton.addEventListener('click', () => { const open = popHazard.hidden; closePops(); setHazardOpen(open); });
  els.scenarioButton.addEventListener('click', () => { const open = !scenariosOpen; closePops(); setScenariosOpen(open); });

  function renderCompass(viewHeading, targetBearing) {
    const { pxPerDeg, marginDeg, maxTargetDeg } = COMPASS;
    els.tape.style.transform = `translateX(${(-(viewHeading + marginDeg) * pxPerDeg).toFixed(1)}px)`;
    setHidden(els.targetMarker, targetBearing === null);
    if (targetBearing !== null) {
      const delta = angleDeltaDeg(viewHeading, targetBearing);
      const shown = clamp(delta, -maxTargetDeg, maxTargetDeg);
      els.targetMarker.style.transform = `translateX(${(shown * pxPerDeg).toFixed(1)}px)`;
      setData(els.targetMarker, 'off', shown !== delta);
    }
    setText(els.heading, `${String(Math.round(viewHeading) % 360).padStart(3, '0')}°`);
  }

  function renderSuit(r) {
    setMeter(els.o2, r.o2Pct, below(r.o2Pct, RULES.o2ReservePct, O2_WARN_PCT), r.o2Trend);
    setText(els.o2Info, r.o2RatePctH > 0 ? `resta ${fmtDuration(r.o2AutonomyH)} · ${fmtNumber(r.o2RatePctH, 1)} %/h` : 'consumo parado no habitat');
    setMeter(els.battery, r.batteryPct, below(r.batteryPct, RULES.batteryDangerPct, RULES.batteryCautionPct), r.batteryTrend);
    setRow(els.pressure, `${fmtNumber(r.pressureKpa, 1)} kPa`, below(r.pressureKpa, RULES.pressureNominalKpa * 0.9, RULES.pressureNominalKpa * 0.98));
    let integrity = 'ok';
    if (r.integrityPct < 100) integrity = r.patched ? 'warn' : 'danger';
    setRow(els.integrity, pct(r.integrityPct), integrity);
    setRow(els.o2End, `${fmtNumber(Math.round(r.o2EndPct))}%`, below(r.o2EndPct, 0, RULES.o2ReservePct));
  }

  // `radio`: { ahead: string, soon: boolean }, a leitura do Navegador de quando o sinal muda seguindo a rota.
  function renderEnvironment(r, trends, radio) {
    setRow(els.radiation, `${fmtNumber(r.radiationRate)} µSv/h`, r.fx.radFactor > 1 ? 'danger' : 'ok');
    setRow(els.dose, `${fmtNumber(r.doseUsv)}/${fmtNumber(RULES.doseLimitUsv)} µSv`, above(r.doseUsv / RULES.doseLimitUsv, RULES.doseCautionFrac, 1));
    setRow(els.temperature, `${fmtNumber(r.airTempC)} °C`, r.airTempC < RULES.suitMinTempC ? 'danger' : 'ok');
    setRow(els.wind, r.windMps === null ? 'sem medição' : `${fmtNumber(r.windMps)} m/s`, above(r.windMps ?? 0, RULES.windCautionMps, RULES.windDangerMps));
    setRow(els.slope, `${fmtSigned(r.slopeDeg)}° · ${fmtNumber(r.slopeAheadDeg)}°`, above(r.slopeAheadDeg, RULES.slopeCautionDeg, RULES.slopeDangerDeg));
    setRow(els.altitude, `${fmtNumber(r.altitudeM)} m`);
    const lost = r.radio.state === 'lost';
    setRow(els.radio, lost ? `Sem resposta · ${minutes(r.radio.lostH)}` : RADIO_TEXT[r.radio.state], lost ? 'danger' : r.radio.state === 'ok' ? 'ok' : 'warn');
    setText(els.radioAhead, lost || r.finished ? '' : `seguindo a rota, o sinal ${radio.ahead}`);
    setData(els.radioAhead, 'soon', radio.soon && !lost);
    setTrend(els.pressure.arrow, trends.pressure ?? 'flat');
    setTrend(els.radiation.arrow, trends.radiation ?? 'flat');
    setTrend(els.temperature.arrow, trends.temperature ?? 'flat');
    setTrend(els.altitude.arrow, trends.altitude ?? 'flat');
  }

  function renderReturn(r) {
    const vehicleQuestion = r.m.vehicleM !== null && !r.m.vehicleDown;
    setText(els.retLabel.firstChild, vehicleQuestion ? 'Se o veículo quebrar aqui, volto a pé?' : 'Volto a pé ao habitat?');
    let verdict = 'Não';
    if (r.ret.reaches) verdict = 'Só com a reserva';
    if (r.ret.ok) verdict = 'Sim';
    setText(els.retVerdict, r.finished ? 'Você está no habitat' : `${verdict} · ${Number.isFinite(r.ret.timeH) ? `${fmtDuration(r.ret.timeH)} de caminhada` : 'sem caminho a pé conhecido'}`);
    setData(els.retVerdict, 'level', r.ret.ok || r.finished ? 'ok' : r.ret.reaches ? 'warn' : 'danger');
    setText(els.retOxygen, r.ret.reaches ? `gasta ${pct(r.ret.o2NeedPct)} de O₂ · chega com ${pct(r.ret.o2AfterPct)} · reserva de ${RULES.o2ReservePct}%` : `o O₂ não alcança · reserva de ${RULES.o2ReservePct}%`);

    const nextGradient = zonesGradient(r.zones);
    if (nextGradient !== gradient) {
      gradient = nextGradient;
      els.strip.style.backgroundImage = gradient;
    }
    els.stripDone.style.transform = `scaleX(${r.progress.toFixed(4)})`;
    els.stripHere.style.transform = `translateX(${(r.progress * 100).toFixed(2)}%)`;
    setHidden(els.stripPnr, r.pnr.status !== 'ahead' || r.finished);
    let pnrText = 'Sem ponto de não retorno nesta rota.';
    if (r.pnr.status === 'ahead') {
      els.stripPnr.style.transform = `translateX(${((r.pnr.distM / r.plan.path.totalM) * 100).toFixed(2)}%)`;
      pnrText = `Ponto de não retorno em ${fmtDistance(r.pnr.aheadM)} · ${fmtDuration(r.pnr.etaH)}`;
    }
    if (r.pnr.status === 'passed') pnrText = 'Ponto de não retorno ultrapassado.';
    if (r.finished) pnrText = 'Saída encerrada.';
    setText(els.pnrText, pnrText);
    setData(els.pnrText, 'status', r.finished ? 'none' : r.pnr.status);
    const stripLabel = `Rota: ${pct(r.progress * 100)} percorrida. ${pnrText}`;
    if (els.strip.getAttribute('aria-label') !== stripLabel) els.strip.setAttribute('aria-label', stripLabel);
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
    setText(els.elapsed, fmtDuration(r.clockH));
    setText(els.mode, `${modeText(r)} · hora local ${fmtClock(r.localClockH)}`);
    renderCompass(viewHeading, r.targetBearing);
    setText(els.nextLabel.firstChild, r.target.label);
    setText(els.nextName, r.target.name);
    setText(els.nextInfo, targetInfo(r.target));
    const habitat = r.shelters.find((option) => option.kind === 'habitat');
    setRow(els.habitat, r.finished ? 'você está nele' : `${habitat.distM === null ? '' : `${fmtDistance(habitat.distM)} · `}${fmtWalk(habitat.timeH)} ${habitat.dirText}`);

    setData(root, 'level', status.level);
    setData(root, 'pending', alerts.active.some((alert) => !alert.ack));
    setData(root, 'protocol', Boolean(proto));
    setLevel(els.statusIcon, status.level);
    setText(els.statusWord, status.word);
    setText(els.statusText, status.text);

    alertStack.update(alerts.active);
    protocolPanel.update(proto);
    shelterPanel.update(r.shelters, proto ? proto.pick : r.nearestShelter);
    historyPanel.update(alerts.history, historyOpen, r.startClockH);
    renderSuit(r);
    renderEnvironment(r, trends, radio);
    renderReturn(r);
    setRichText(els.assistant, line.text);
    setData(fala, 'kind', line.kind);

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

  /**
   * Estado dos botões, que só muda por ação do usuário.
   * @param {{ state: object, mode: string, soundOn: boolean, voiceOn: boolean, hasVoice: boolean, historyOpen: boolean,
   *   drawerOpen: boolean, mapOn: boolean, readingsOn: boolean, zoom: { text: string, canIn: boolean, canOut: boolean },
   *   mic: { canListen: boolean, listening: boolean } }} controls
   */
  function syncControls({ state, mode, soundOn, voiceOn, hasVoice, historyOpen, drawerOpen, mapOn, readingsOn, zoom, mic, assistantNote, voiceInfo }) {
    setText(els.assistantNote, assistantNote);
    // O botão de voz diz qual voz está em uso (a neural local ou a do sistema).
    if (voiceInfo && els.voice.title !== voiceInfo) els.voice.title = voiceInfo;
    // O rótulo já diz o estado; aria-pressed junto com rótulo que muda seria contraditório.
    setText(els.pause, state.paused ? 'Continuar' : 'Pausar');
    setData(els.pause, 'active', state.paused);
    els.speed.value = String(state.speed);
    els.sound.setAttribute('aria-pressed', String(soundOn));
    els.voice.setAttribute('aria-pressed', String(voiceOn));
    els.voice.disabled = !hasVoice;
    els.history.setAttribute('aria-expanded', String(historyOpen));
    els.drawerButton.setAttribute('aria-expanded', String(drawerOpen));
    els.drawer.hidden = !drawerOpen;
    setData(root, 'gaveta', drawerOpen ? 'aberta' : 'fechada');
    els.mapButton.setAttribute('aria-pressed', String(mapOn));
    setData(root, 'mapa', mapOn ? 'on' : 'off');
    els.readingsButton.setAttribute('aria-pressed', String(readingsOn));
    setData(root, 'leituras', readingsOn ? 'on' : 'off');
    setText(els.zoomLabel, zoom.text);
    els.zoomIn.disabled = !zoom.canIn;
    els.zoomOut.disabled = !zoom.canOut;
    els.mic.hidden = !mic.canListen;
    setText(els.mic, mic.listening ? 'Ouvindo…' : 'Falar');
    els.mic.setAttribute('aria-pressed', String(mic.listening));
    for (const { scenario, node } of scenarioButtons) {
      const unavailable = Boolean(scenario.needsVehicle) && mode !== 'car';
      node.disabled = unavailable;
      node.title = unavailable ? 'Só existe no plano com veículo' : '';
      node.setAttribute('aria-pressed', String(Boolean(state.scenarios[scenario.id])));
    }
  }

  return Object.freeze({
    canvases: Object.freeze({ minimap: els.minimap, profile: els.profile, world: els.world }),
    edge: els.edge,
    markers: els.markers,
    drawer: els.drawer,
    render,
    syncControls,
    closePops,
    layout: () => layout,
    setProfileCaption: (text) => setText(els.profileCaption, text),
    announce: (text) => { els.announcer.textContent = text; },
    focus: () => els.pause.focus(),
    focusDrawerButton: () => els.drawerButton.focus(),
  });
}
