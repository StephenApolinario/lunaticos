// HUD do Guardião: monta a marcação uma vez e, a cada quadro, só escreve o que mudou.
// Todo texto entra como nó de texto (sem innerHTML).

import { SIM } from '../../src/simulation.js';
import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { fmtDistance, fmtDuration, fmtNumber, fmtClock, fmtSigned } from '../../src/format.js';
import { h, setText } from '../../src/dom.js';
import { t } from '../../src/i18n.js';
import { RULES, FAULTS, SCENARIOS, SHELTER_NAMES } from './catalog.js';
import { fmtWalk } from './rules.js';
import {
  createAlertStack, createProtocolPanel, createShelterPanel, createHistoryPanel, levelIcon, setLevel, setData, setHidden,
} from './panels.js';

const COMPASS = Object.freeze({ pxPerDeg: 5, marginDeg: 60, tickDeg: 15, maxTargetDeg: 30 });
const CARDINALS = Object.freeze({ 0: 'N', 45: 'NE', 90: t('L', 'leste'), 135: 'SE', 180: 'S', 225: t('SO', 'sudoeste'), 270: t('O', 'oeste'), 315: t('NO', 'noroeste') });
const SCRUB_MAX = 1000;
const O2_WARN_PCT = 35;
const ZONE_COLOR = Object.freeze({ ok: 'var(--guardiao-ok)', justa: 'var(--guardiao-atencao)', nao: 'var(--guardiao-emergencia)' });
const RADIO_TEXT = Object.freeze({ ok: t`Visada direta`, noise: t`Com ruído`, shadow: t`Sem visada` });
const TREND_LABEL = Object.freeze({ up: t`subindo`, down: t`caindo`, down2: t`caindo rápido`, flat: t`estável` });

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;
const pct = (value) => `${fmtNumber(Math.max(0, value))}%`;
const minutes = (hours) => `${Math.max(1, Math.round(hours * 60))} min`;
const below = (value, danger, warn) => (value < danger ? 'danger' : value < warn ? 'warn' : 'ok');
const above = (value, warn, danger) => (value >= danger ? 'danger' : value >= warn ? 'warn' : 'ok');
const label = (text, note) => h('span', { class: 'guardiao-rotulo' }, text, note && h('small', {}, ` ${note}`));

function trendArrow() {
  return h('i', { class: 'guardiao-tendencia', role: 'img' });
}
function setTrend(arrow, dir) {
  setData(arrow, 'dir', dir);
  if (arrow.getAttribute('aria-label') !== TREND_LABEL[dir]) arrow.setAttribute('aria-label', TREND_LABEL[dir]);
}

// Nome de uma leitura, com versão curta para a tela do telefone.
function caption(text, short, sim) {
  const name = short ? [h('span', { class: 'guardiao-so-largo' }, text), h('span', { class: 'guardiao-so-estreito' }, short)] : text;
  // `sim` é true para leitura simulada, ou o texto de outra ressalva (por exemplo, valor calculado).
  return h('span', {}, name, sim && h('small', {}, sim === true ? t(' sim.') : ` ${sim}`));
}

// Linha "rótulo · valor", com seta de tendência opcional.
function row(text, { short = null, sim = false, trend = false } = {}) {
  const value = h('b');
  const arrow = trend ? trendArrow() : null;
  return { value, arrow, node: h('div', { class: 'guardiao-linha' }, caption(text, short, sim), h('span', { class: 'guardiao-valor' }, value, arrow)) };
}

function meter(text, short = null) {
  const value = h('b');
  const arrow = trendArrow();
  const node = h('div', { class: 'guardiao-medidor' }, caption(text, short, false), h('i', { class: 'guardiao-barra' }), h('span', { class: 'guardiao-valor' }, value, arrow));
  return { node, value, arrow };
}
function setMeter(target, value, level, trend) {
  target.node.style.setProperty('--fill', (clamp(value, 0, 100) / 100).toFixed(3));
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
  if (r.finished) return t`No habitat`;
  if (r.sheltered) return t`Abrigado · ${SHELTER_NAMES[r.sheltered].toLowerCase()}`;
  const held = r.nav.kind === 'hold';
  if (r.m.inCabin) return held ? t`No veículo · parado` : t`No veículo`;
  if (r.offRoute) return held ? t`A pé · fora da rota · parado` : t`A pé · fora da rota`;
  return held ? t`A pé · parado` : t`A pé`;
}

function targetInfo(target) {
  if (target.kind === 'home') return t`você está no habitat`;
  if (target.kind === 'dwell') return t`coleta em andamento · faltam ${fmtDuration(target.etaH)}`;
  if (target.timeOnly) return t`${fmtDuration(target.etaH)} a pé`;
  return `${fmtDistance(target.distM)} · ${fmtDuration(target.etaH)} · ${fmtSigned(target.gainM)} m`;
}

// Linha do habitat: distância (quando conhecida), tempo e por onde.
function habitatText(r) {
  if (r.finished) return t`você está nele`;
  const habitat = r.shelters.find((option) => option.kind === 'habitat');
  if (habitat.distM === null) return `${fmtWalk(habitat.timeH)} ${habitat.dirText}`;
  return t`${fmtDistance(habitat.distM)} · ${fmtWalk(habitat.timeH)} ${habitat.dirText}`;
}

/**
 * @param {HTMLElement} mount
 * @param {Record<string, Function>} on Ações: pause, speed, scrub, exit, scenario, clear, ack, confirm, decide, sound, voice, history.
 */
export function createHud(mount, on) {
  const els = {
    elapsed: h('b', { class: 'guardiao-grande' }), mode: h('span', { class: 'guardiao-sub' }),
    tape: h('div', { class: 'guardiao-fita' }), targetMarker: h('i', { class: 'guardiao-alvo' }), heading: h('b', { class: 'guardiao-rumo' }),
    nextLabel: label(t`Próxima parada`), nextName: h('b', { class: 'guardiao-grande' }), nextInfo: h('span', { class: 'guardiao-sub' }),
    statusIcon: levelIcon(), statusWord: h('b'), statusText: h('span'),
    o2: meter('O₂'), o2Info: h('span', { class: 'guardiao-sub' }), battery: meter(t`Bateria`, t`Bat.`),
    pressure: row(t`Pressão`, { trend: true }), integrity: row(t`Integridade`, { short: t`Integr.` }), o2End: row(t`O₂ ao fim do plano`, { short: t`O₂ no fim` }),
    radiation: row(t`Radiação`, { short: t('Rad.'), sim: 'RAD', trend: true }), dose: row(t`Dose da saída`, { short: t('Dose'), sim: t('est.') }),
    temperature: row(t`Temp. do ar`, { short: t('Temp.'), sim: t('est.'), trend: true }), wind: row(t`Vento`, { sim: true }),
    slope: row(t`Declive · à frente`, { short: t`Decl. · frente` }), altitude: row(t('Altitude'), { short: t('Alt.'), trend: true }), radio: row(t`Rádio`, { sim: t('calc.') }), habitat: row('Habitat'),
    retLabel: label(t`Volto a pé ao habitat?`, t`caminho no relevo real · O₂ simulado`), retVerdict: h('b', { class: 'guardiao-veredito' }), retOxygen: h('span', { class: 'guardiao-sub' }),
    strip: h('div', { class: 'guardiao-faixa', role: 'img' }), stripDone: h('i', { class: 'guardiao-faixa-feito' }),
    stripHere: h('i', { class: 'guardiao-faixa-aqui' }), stripPnr: h('i', { class: 'guardiao-faixa-pnr' }), pnrText: h('span', { class: 'guardiao-sub guardiao-pnr-texto' }),
    assistant: h('span', { class: 'guardiao-fala', role: 'status', 'aria-live': 'polite' }),
    announcer: h('p', { class: 'visually-hidden', role: 'alert' }), dust: h('div', { class: 'guardiao-poeira', 'aria-hidden': 'true' }),
    markPnr: h('div', { class: 'guardiao-marca', hidden: true, dataset: { kind: 'pnr' } }), markShelter: h('div', { class: 'guardiao-marca', hidden: true, dataset: { kind: 'abrigo' } }),
    pause: h('button', { type: 'button', onclick: on.pause }, t`Pausar`),
    speed: h('select', { onchange: (event) => on.speed(Number(event.target.value)) }, SIM.speeds.map((speed) => h('option', { value: String(speed) }, `${speed}×`))),
    scrub: h('input', { type: 'range', min: '0', max: String(SCRUB_MAX), value: '0', 'aria-label': t`Posição na rota`, oninput: (event) => on.scrub(Number(event.target.value) / SCRUB_MAX) }),
    sound: h('button', { type: 'button', title: t`Som dos alertas (tecla M)`, onclick: on.sound }, t`Som`),
    voice: h('button', { type: 'button', title: t`Voz do assistente (tecla V)`, onclick: on.voice }, t`Voz`),
    history: h('button', { type: 'button', title: t`Histórico de alertas (tecla H)`, 'aria-expanded': 'false', onclick: on.history }, t`Histórico`),
    exit: h('button', { type: 'button', class: 'guardiao-primario', title: t`Voltar ao tablet (Esc)`, onclick: on.exit }, t`Voltar`, h('span', { class: 'guardiao-so-largo' }, ` ${t`ao tablet`}`)),
  };
  els.strip.append(els.stripDone, els.stripPnr, els.stripHere);
  buildCompassTape(els.tape);

  const alertStack = createAlertStack(on.ack);
  const protocolPanel = createProtocolPanel({ onConfirm: on.confirm, onDecide: on.decide });
  const shelterPanel = createShelterPanel();
  const historyPanel = createHistoryPanel(on.history);
  const scenarioButtons = SCENARIOS.map((scenario, index) => ({
    scenario,
    node: h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => on.scenario(scenario.id) }, h('kbd', {}, String(index + 1)), ` ${scenario.label}`),
  }));

  const root = h('div', { class: 'guardiao', dataset: { level: 'seguro' } },
    els.dust,
    h('div', { class: 'guardiao-moldura', 'aria-hidden': 'true' }),
    els.markPnr, els.markShelter,
    h('div', { class: 'guardiao-vista' },
      h('section', { class: 'guardiao-bloco guardiao-relogio', 'aria-label': t`Tempo de saída` }, label(t`Tempo de saída`), els.elapsed, els.mode),
      h('section', { class: 'guardiao-bussola', 'aria-label': t`Bússola` },
        h('div', { class: 'guardiao-janela' }, els.tape, h('i', { class: 'guardiao-agulha' }), els.targetMarker), els.heading),
      h('section', { class: 'guardiao-bloco guardiao-destino', 'aria-label': t`Destino` }, els.nextLabel, els.nextName, els.nextInfo, els.habitat.node),
      h('section', { class: 'guardiao-status', 'aria-label': t`Estado de segurança` }, els.statusIcon, els.statusWord, els.statusText),
      alertStack.root,
      h('div', { class: 'guardiao-coluna' }, protocolPanel.root, shelterPanel.root),
      h('i', { class: 'guardiao-mira', 'aria-hidden': 'true' }),
      h('section', { class: 'guardiao-bloco guardiao-traje', 'aria-label': t`Traje` }, label(t`Traje`, t`simulado`),
        els.o2.node, els.o2Info, els.battery.node, els.pressure.node, els.integrity.node, els.o2End.node),
      h('section', { class: 'guardiao-bloco guardiao-retorno', 'aria-label': t`Retorno a pé` }, els.retLabel, els.retVerdict, els.retOxygen, els.strip, els.pnrText),
      h('section', { class: 'guardiao-bloco guardiao-ambiente', 'aria-label': t`Ambiente` }, label(t`Ambiente`),
        els.radiation.node, els.dose.node, els.temperature.node, els.wind.node, els.slope.node, els.altitude.node, els.radio.node,
        h('span', { class: 'guardiao-fonte' }, t`Declive, altitude e visada do rádio: DEM real (USGS/JPL); a altura das antenas é hipótese. Radiação: média medida pelo RAD do Curiosity. Temperatura: estimada entre os extremos do REMS. Vento: simulado.`)),
      h('p', { class: 'guardiao-assistente' }, label(t`Oficial de protocolo`, t`IA simulada · motor de regras`), els.assistant)),
    historyPanel.root,
    h('div', { class: 'guardiao-doca' },
      h('div', { class: 'guardiao-controles', role: 'toolbar', 'aria-label': t`Controles da simulação` },
        els.pause, h('label', {}, `${t`Velocidade`} `, els.speed), els.scrub, els.sound, els.voice, els.history, els.exit),
      h('div', { class: 'guardiao-cenarios', role: 'toolbar', 'aria-label': t`Cenários de emergência para demonstração` },
        label(t`Cenários`, t`simulados`), scenarioButtons.map((button) => button.node),
        h('button', { type: 'button', class: 'guardiao-limpar', onclick: on.clear }, h('kbd', {}, '0'), ` ${t`Limpar`}`))),
    els.announcer);
  mount.replaceChildren(root);

  let gradient = '';
  let size = { width: mount.clientWidth, height: mount.clientHeight };
  new ResizeObserver(([entry]) => { size = { width: entry.contentRect.width, height: entry.contentRect.height }; }).observe(mount);

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
    setText(els.o2Info, r.o2RatePctH > 0 ? t`resta ${fmtDuration(r.o2AutonomyH)} · ${fmtNumber(r.o2RatePctH, 1)} %/h` : t`consumo parado no habitat`);
    setMeter(els.battery, r.batteryPct, below(r.batteryPct, RULES.batteryDangerPct, RULES.batteryCautionPct), r.batteryTrend);
    setRow(els.pressure, `${fmtNumber(r.pressureKpa, 1)} kPa`, below(r.pressureKpa, RULES.pressureNominalKpa * 0.9, RULES.pressureNominalKpa * 0.98));
    let integrity = 'ok';
    if (r.integrityPct < 100) integrity = r.patched ? 'warn' : 'danger';
    setRow(els.integrity, pct(r.integrityPct), integrity);
    setRow(els.o2End, `${fmtNumber(Math.round(r.o2EndPct))}%`, below(r.o2EndPct, 0, RULES.o2ReservePct));
  }

  function renderEnvironment(r, trends) {
    setRow(els.radiation, `${fmtNumber(r.radiationRate)} µSv/h`, r.fx.radFactor > 1 ? 'danger' : 'ok');
    setRow(els.dose, `${fmtNumber(r.doseUsv)}/${fmtNumber(RULES.doseLimitUsv)} µSv`, above(r.doseUsv / RULES.doseLimitUsv, RULES.doseCautionFrac, 1));
    setRow(els.temperature, `${fmtNumber(r.airTempC)} °C`, r.airTempC < RULES.suitMinTempC ? 'danger' : 'ok');
    setRow(els.wind, r.windMps === null ? t`sem medição` : `${fmtNumber(r.windMps)} m/s`, above(r.windMps ?? 0, RULES.windCautionMps, RULES.windDangerMps));
    setRow(els.slope, `${fmtSigned(r.slopeDeg)}° · ${fmtNumber(r.slopeAheadDeg)}°`, above(r.slopeAheadDeg, RULES.slopeCautionDeg, RULES.slopeDangerDeg));
    setRow(els.altitude, `${fmtNumber(r.altitudeM)} m`);
    const lost = r.radio.state === 'lost';
    setRow(els.radio, lost ? t`Sem resposta · ${minutes(r.radio.lostH)}` : RADIO_TEXT[r.radio.state], lost ? 'danger' : r.radio.state === 'ok' ? 'ok' : 'warn');
    setTrend(els.pressure.arrow, trends.pressure ?? 'flat');
    setTrend(els.radiation.arrow, trends.radiation ?? 'flat');
    setTrend(els.temperature.arrow, trends.temperature ?? 'flat');
    setTrend(els.altitude.arrow, trends.altitude ?? 'flat');
  }

  function renderReturn(r) {
    const vehicleQuestion = r.m.vehicleM !== null && !r.m.vehicleDown;
    setText(els.retLabel.firstChild, vehicleQuestion ? t`Se o veículo quebrar aqui, volto a pé?` : t`Volto a pé ao habitat?`);
    let verdict = t`Não`;
    if (r.ret.reaches) verdict = t`Só com a reserva`;
    if (r.ret.ok) verdict = t`Sim`;
    const walk = Number.isFinite(r.ret.timeH) ? t`${fmtDuration(r.ret.timeH)} de caminhada` : t`sem caminho a pé conhecido`;
    setText(els.retVerdict, r.finished ? t`Você está no habitat` : `${verdict} · ${walk}`);
    setData(els.retVerdict, 'level', r.ret.ok || r.finished ? 'ok' : r.ret.reaches ? 'warn' : 'danger');
    setText(els.retOxygen, r.ret.reaches ? t`gasta ${pct(r.ret.o2NeedPct)} de O₂ · chega com ${pct(r.ret.o2AfterPct)} · reserva de ${RULES.o2ReservePct}%` : t`o O₂ não alcança · reserva de ${RULES.o2ReservePct}%`);

    const nextGradient = zonesGradient(r.zones);
    if (nextGradient !== gradient) {
      gradient = nextGradient;
      els.strip.style.backgroundImage = gradient;
    }
    const progress = `${(r.progress * 100).toFixed(2)}%`;
    els.stripDone.style.transform = `scaleX(${r.progress.toFixed(4)})`;
    els.stripHere.style.transform = `translateX(${progress})`;
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
    const stripLabel = t`Rota: ${pct(r.progress * 100)} percorrida. ${pnrText}`;
    if (els.strip.getAttribute('aria-label') !== stripLabel) els.strip.setAttribute('aria-label', stripLabel);
  }

  function renderMark(node, mark) {
    setHidden(node, !mark);
    if (!mark) return;
    setText(node, mark.text);
    node.style.transform = `translate(${(mark.x * size.width).toFixed(1)}px, ${(mark.y * size.height).toFixed(1)}px)`;
  }

  /** Desenha um quadro. `view` vem do visor: leitura, alertas, protocolo, fala, estado e marcas. */
  function render({ r, alerts, trends, proto, assistant, status, viewHeading, marks, historyOpen }) {
    setText(els.elapsed, fmtDuration(r.clockH));
    setText(els.mode, t`${modeText(r)} · hora local ${fmtClock(r.localClockH)}`);
    renderCompass(viewHeading, r.targetBearing);
    setText(els.nextLabel.firstChild, r.target.label);
    setText(els.nextName, r.target.name);
    setText(els.nextInfo, targetInfo(r.target));
    setRow(els.habitat, habitatText(r));

    setData(root, 'level', status.level);
    setData(root, 'pending', alerts.active.some((alert) => !alert.ack));
    setData(root, 'protocol', Boolean(proto));
    setLevel(els.statusIcon, status.level);
    setText(els.statusWord, status.word);
    setText(els.statusText, status.text);

    alertStack.update(alerts.active);
    protocolPanel.update(proto);
    shelterPanel.update(r.shelters, proto ? proto.pick : r.nearestShelter);
    historyPanel.update(alerts.history, historyOpen);
    renderSuit(r);
    renderEnvironment(r, trends);
    renderReturn(r);
    setText(els.assistant, assistant.text);

    let haze = 0;
    if (r.fx.dust) haze = r.fx.dust.arrived ? 1 : 0.15 + 0.45 * (1 - r.fx.dust.etaH / FAULTS.dustEtaH);
    els.dust.style.opacity = haze.toFixed(2);
    renderMark(els.markPnr, marks.pnr);
    renderMark(els.markShelter, marks.shelter);
    // Enquanto a pessoa segura a barra, quem manda no valor é ela.
    if (!els.scrub.matches(':active')) els.scrub.value = String(Math.round(r.progress * SCRUB_MAX));
  }

  /** Estado dos botões, que só muda por ação do usuário. */
  function syncControls({ state, mode, soundOn, voiceOn, hasVoice, historyOpen }) {
    // O rótulo já diz o estado; aria-pressed junto com rótulo que muda seria contraditório.
    setText(els.pause, state.paused ? t`Continuar` : t`Pausar`);
    setData(els.pause, 'active', state.paused);
    els.speed.value = String(state.speed);
    els.sound.setAttribute('aria-pressed', String(soundOn));
    els.voice.setAttribute('aria-pressed', String(voiceOn));
    els.voice.disabled = !hasVoice;
    els.history.setAttribute('aria-expanded', String(historyOpen));
    for (const { scenario, node } of scenarioButtons) {
      const unavailable = Boolean(scenario.needsVehicle) && mode !== 'car';
      node.disabled = unavailable;
      node.title = unavailable ? t`Só existe no plano com veículo` : '';
      node.setAttribute('aria-pressed', String(Boolean(state.scenarios[scenario.id])));
    }
  }

  return Object.freeze({
    render,
    syncControls,
    announce: (text) => { els.announcer.textContent = text; },
    focus: () => els.pause.focus(),
  });
}
