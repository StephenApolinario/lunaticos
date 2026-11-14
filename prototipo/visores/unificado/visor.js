// Visor único: o Guardião (oficial de segurança) como base, com a navegação de terreno do
// Navegador e o assistente de campo do Cientista em um só visor. Contrato em ../LEIA-ME.md.
//
// Este arquivo é a cola com o navegador, adaptada de ../guardiao/visor.js: câmera, teclado,
// ponteiro, som e o laço de quadros. A sessão do Guardião (motor, análise, regras, alertas e
// protocolos) dita posição, tempo e segurança; navegacao.js e campo.js só leem dela.

import * as THREE from 'three';
import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { samplePath, headingAt } from '../../src/route.js';
import { fmtDistance } from '../../src/format.js';
import { LEVELS, SCENARIOS, SHELTER_NAMES } from '../guardiao/catalog.js';
import { createAnalyzer } from '../guardiao/analysis.js';
import { statusLine, assistantMessage, goStepText } from '../guardiao/rules.js';
import { protocolView } from '../guardiao/protocols.js';
import {
  createSession, stepSession, setPaused, setSpeed, toggleScenario, clearScenarios, acknowledge, confirmCurrentStep, decideCurrent, scrubTo,
} from '../guardiao/session.js';
import { createAudio } from '../guardiao/audio.js';
import { createHud } from './hud.js';
import { createNavigation } from './navegacao.js';
import { createField } from './campo.js';
import { withReportedHazard, isReportedHazard, targetLabel } from './guia.js';

const DEG = Math.PI / 180;
const EYE_HEIGHT_M = Object.freeze({ walk: 1.7, car: 2.4 });
const MIN_CLEARANCE_M = 1;
const CAMERA = Object.freeze({ basePitchDeg: -5, slopePitchFactor: 0.5, baseTurnRate: 2, turnRatePerMps: 0.125, heightRate: 6 });
const LOOK = Object.freeze({ degPerPx: 0.18, maxYawDeg: 120, maxPitchDeg: 45, returnDelayS: 1.5, returnRate: 2.2 });
// Onde uma tecla é texto do próprio controle. A barra de posição (range) não entra: nela os atalhos valem.
const TYPING_SELECTOR = 'select, textarea, input:not([type="range"])';
// Onde arrastar não vira o olhar: controles, menus e a gaveta do assistente.
const NO_LOOK_SELECTOR = 'button, select, input, textarea, label, .guardiao-historico, .unificado-gaveta, .unificado-pop, .guardiao-cenarios';
// Alarme sem reconhecimento volta a soar a cada tantos segundos.
const REPEAT_S = Object.freeze({ emergencia: 3, perigo: 8 });
const MARK = Object.freeze({ heightM: 3, edge: 1.05, pnrMaxM: 2500 });
// Larguras do visor.css. No telefone o minimapa e as leituras começam recolhidos, atrás dos botões
// da doca; em tela média, só as leituras (a coluna da direita não tem altura para os dois).
const NARROW_QUERY = '(max-width: 820px)';
const MEDIUM_QUERY = '(max-width: 1180px)';

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

/**
 * @param {{
 *   mount: HTMLElement,
 *   stageElement: HTMLElement,
 *   camera: import('three').PerspectiveCamera,
 *   terrain: { isReal: boolean, heightAt: (x: number, z: number) => number, probe: (x: number, z: number) => { y: number, slopeDeg: number, radiation: number, groundTemp: number } },
 *   overlays: { setNextStop: (id: string|null, label: string) => void },
 *   onExit: () => void,
 *   safety: { walkBackAt: Function, commsAt: Function, nearestShelter: Function, protocolFor: Function, assumptions: object },
 * }} context
 */
export function createVisor({ mount, stageElement, camera, terrain, overlays, onExit, safety }) {
  if (!safety) throw new Error('O visor único precisa de context.safety (ver visores/LEIA-ME.md).');
  const audio = createAudio();
  const analyzer = createAnalyzer(safety, terrain.isReal);
  const projected = new THREE.Vector3();

  let session = null;
  let active = false;
  let historyOpen = false;
  let mapOn = true;
  let readingsOn = true;
  let repeatS = 0;
  let reportedKey = null;
  let alerts = [];
  let smoothedHeading = 0;
  let cameraY = 0;
  let look = Object.freeze({ yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0, lastX: 0, lastY: 0 });

  function syncControls() {
    if (!session) return;
    const voice = field.voiceState();
    hud.syncControls({
      state: session.state, mode: session.plan.mode, soundOn: audio.soundOn, voiceOn: audio.voiceOn, hasVoice: audio.hasVoice, historyOpen,
      drawerOpen: field.isOpen(), mapOn, readingsOn, zoom: nav.zoomState(), mic: { canListen: voice.canListen, listening: voice.listening === 'chat' },
    });
  }

  // Toda ação do usuário passa por aqui: muda a sessão e refaz a análise no próximo quadro.
  function apply(action, ...args) {
    if (!session) return;
    analyzer.invalidate();
    session = action(session, ...args);
    field.invalidate();
    syncControls();
  }

  const toggleHistory = () => { historyOpen = !historyOpen; syncControls(); };
  const toggleDrawer = () => (field.isOpen() ? field.closeDrawer() : field.openDrawer(null, !matchMedia('(pointer: coarse)').matches));
  const zoomMap = (delta) => { nav.zoom(delta); syncControls(); };
  const isNarrow = () => matchMedia(NARROW_QUERY).matches;
  // No telefone, minimapa e leituras abrem por cima da área livre: um de cada vez.
  const toggleWidgets = (map, readings) => { mapOn = map; readingsOn = readings; syncControls(); };

  // Reconhece um alerta. O aviso de perigo relatado não é do Guardião: o reconhecimento dele fica aqui.
  function ack(id) {
    const target = id ?? alerts.find((alert) => !alert.ack)?.id;
    if (!target) return;
    if (isReportedHazard(target)) field.acked.add(target);
    else apply(acknowledge, target);
  }

  const hud = createHud(mount, {
    pause: () => apply(setPaused, !session.state.paused),
    speed: (value) => apply(setSpeed, value),
    scrub: (fraction) => apply(scrubTo, fraction),
    exit: onExit,
    scenario: (id) => apply(toggleScenario, id),
    clear: () => apply(clearScenarios),
    ack,
    confirm: () => apply(confirmCurrentStep),
    decide: (choice) => apply(decideCurrent, choice),
    sound: () => { audio.toggleSound(); syncControls(); },
    voice: () => field.toggleVoice(),
    history: toggleHistory,
    drawer: toggleDrawer,
    talk: () => field.openDrawer('chat', true),
    mic: () => field.listen(),
    report: (type) => field.report(type),
    map: () => toggleWidgets(!mapOn, readingsOn && (mapOn || !isNarrow())),
    readings: () => toggleWidgets(mapOn && (readingsOn || !isNarrow()), !readingsOn),
    zoom: zoomMap,
  });
  const nav = createNavigation({
    canvases: hud.canvases, edge: hud.edge, camera, terrain, assumptions: safety.assumptions, onProfile: hud.setProfileCaption,
  });
  const field = createField({
    drawer: hud.drawer, markersLayer: hud.markers, camera, terrain, safety, audio,
    host: {
      session: () => session,
      confirm: () => apply(confirmCurrentStep),
      decide: (choice) => apply(decideCurrent, choice),
      pause: (paused) => apply(setPaused, paused),
      endScenario: (id) => apply(toggleScenario, id),
      // Chamado quando a gaveta abre ou fecha e quando a voz muda: a gaveta aberta fecha os menus.
      onChange: () => { if (field.isOpen()) hud.closePops(); syncControls(); },
      focusDrawerButton: hud.focusDrawerButton,
    },
  });

  function start(plan) {
    session = createSession(plan);
    analyzer.invalidate();
    nav.setPlan(plan);
    historyOpen = false;
    mapOn = !isNarrow();
    readingsOn = !matchMedia(MEDIUM_QUERY).matches;
    repeatS = 0;
    reportedKey = null;
    alerts = [];
    look = Object.freeze({ ...look, yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0 });
    smoothedHeading = headingAt(plan.path, 0);
    const origin = samplePath(plan.path, 0);
    cameraY = terrain.probe(origin.x, origin.z).y + EYE_HEIGHT_M[plan.mode];
    active = true;
    mount.hidden = false;
    // Entrar no visor é um gesto do usuário: é quando o navegador libera o áudio.
    audio.unlock();
    hud.closePops();
    hud.announce('');
    field.start(plan);
    syncControls();
    hud.focus();
  }

  function stop() {
    active = false;
    mount.hidden = true;
    field.stop();
    overlays.setNextStop(null, '');
  }

  // Depois de um tempo sem arrastar, o olhar volta devagar para a frente.
  function settleLook(dtS) {
    if (look.dragging) return;
    const idleS = look.idleS + dtS;
    const keep = idleS > LOOK.returnDelayS ? Math.exp(-dtS * LOOK.returnRate) : 1;
    look = Object.freeze({ ...look, idleS, yawDeg: look.yawDeg * keep, pitchDeg: look.pitchDeg * keep });
  }

  function applyCamera(r, pos, ground, dtS) {
    const realSpeedMps = r.moving ? (r.m.speedKmh / 3.6) * session.state.speed : 0;
    const turnRate = CAMERA.baseTurnRate + realSpeedMps * CAMERA.turnRatePerMps;
    smoothedHeading = normalizeDeg(smoothedHeading + angleDeltaDeg(smoothedHeading, r.heading) * (1 - Math.exp(-dtS * turnRate)));

    const eyeY = ground.y + EYE_HEIGHT_M[r.m.inCabin ? 'car' : 'walk'];
    cameraY += (eyeY - cameraY) * (1 - Math.exp(-dtS * CAMERA.heightRate));
    cameraY = Math.max(cameraY, ground.y + MIN_CLEARANCE_M);

    const pitchDeg = CAMERA.basePitchDeg + r.slopeDeg * CAMERA.slopePitchFactor + look.pitchDeg;
    camera.position.set(pos.x, cameraY, pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitchDeg * DEG, -(smoothedHeading + look.yawDeg) * DEG, 0);
    // As matrizes precisam estar em dia para projetar a guia e as marcas neste mesmo quadro.
    camera.updateMatrixWorld();
    return normalizeDeg(smoothedHeading + look.yawDeg);
  }

  // Posição na tela (fração do palco) de um ponto do terreno, ou null se estiver fora da vista.
  function project(position) {
    projected.set(position.x, terrain.heightAt(position.x, position.z) + MARK.heightM, position.z).project(camera);
    if (projected.z > 1 || Math.abs(projected.x) > MARK.edge || Math.abs(projected.y) > MARK.edge) return null;
    return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
  }

  // Marcas presas ao terreno: o ponto de não retorno e o abrigo indicado.
  function buildMarks(r, proto) {
    const marks = { pnr: null, shelter: null };
    if (r.pnr.status === 'ahead' && r.pnr.aheadM <= MARK.pnrMaxM) {
      const at = project(r.pnr.position);
      if (at) marks.pnr = { ...at, text: `Ponto de não retorno · ${fmtDistance(r.pnr.aheadM)}` };
    }
    const pick = proto?.pick;
    // O habitat já tem o pino dele no mapa; aqui entram veículo e relevo.
    if (pick && pick.kind !== 'habitat' && pick.distM >= 1) {
      const at = project(pick.position);
      if (at) marks.shelter = { ...at, text: `Abrigo · ${SHELTER_NAMES[pick.kind].toLowerCase()} · ${fmtDistance(pick.distM)}` };
    }
    return marks;
  }

  // Som e anúncio para leitor de tela. A voz é do assistente (campo.js), para haver uma só.
  function announce(events, dtS) {
    const fresh = events.filter((event) => event.type === 'raised' || event.type === 'escalated').map((event) => event.alert);
    const reported = alerts.find((alert) => isReportedHazard(alert.id)) ?? null;
    if (reported && reported.id !== reportedKey) fresh.push(reported);
    reportedKey = reported?.id ?? null;
    for (const alert of fresh) {
      audio.play(alert.level);
      hud.announce(`${LEVELS[alert.level].label}: ${alert.title}. ${alert.action}`);
    }
    const waiting = alerts.find((alert) => !alert.ack) ?? null;
    const everyS = waiting ? REPEAT_S[waiting.level] : undefined;
    repeatS = everyS ? repeatS + dtS : 0;
    if (everyS && repeatS >= everyS) {
      repeatS = 0;
      audio.play(waiting.level);
    }
  }

  function frame(dtS) {
    if (!active || !session) return;
    const before = session;
    session = stepSession(session, dtS, terrain, analyzer);
    const { r } = session;
    // Ao chegar a uma parada, a simulação pausa: a coleta leva o tempo que o astronauta precisar.
    const arrived = session.state.stopsReached > before.state.stopsReached && session.state.dwellRemainingH > 0;
    if (arrived) session = setPaused(session, true);
    if (arrived || session.state.finished !== before.state.finished) syncControls();

    const proto = protocolView(session.protocols, r, goStepText);
    alerts = withReportedHazard(session.alerts.active, field.warningAt(session), field.acked, r.clockH);
    announce(session.events, dtS);
    settleLook(dtS);
    const viewHeading = applyCamera(r, session.pos, session.ground, dtS);
    const { guide, radio } = nav.update(dtS, session, { headingDeg: smoothedHeading, lookDeg: look.yawDeg }, hud.layout());

    const line = field.frame(dtS, {
      before, session, proto, alerts, radio,
      message: assistantMessage(r, alerts, proto),
      instruction: guide.instruction,
      arrivedAt: arrived ? session.plan.stops[session.state.stopsReached - 1].stop : null,
    });
    hud.render({
      r, proto, line, radio, viewHeading, historyOpen,
      alerts: { active: alerts, history: session.alerts.history },
      trends: session.trends.dir, status: statusLine(r, alerts), marks: buildMarks(r, proto),
    });
    overlays.setNextStop(r.target.stopId, targetLabel(r));
  }

  const KEY_ACTIONS = Object.freeze({
    r: () => ack(),
    p: () => apply(confirmCurrentStep),
    a: () => apply(decideCurrent, 'abortar'),
    s: () => apply(decideCurrent, 'seguir'),
    h: toggleHistory,
    m: () => { audio.toggleSound(); syncControls(); },
    v: () => field.toggleVoice(),
    0: () => apply(clearScenarios),
    '+': () => zoomMap(-1),
    '=': () => zoomMap(-1),
    '-': () => zoomMap(1),
  });

  document.addEventListener('keydown', (event) => {
    if (!active || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      // Esc fecha primeiro o que estiver aberto; só então volta ao tablet.
      // Com a lista de velocidade em foco, Esc pertence a ela.
      if (event.target.tagName === 'SELECT' || hud.closePops()) return;
      if (historyOpen) toggleHistory();
      else if (field.isOpen()) field.closeDrawer(true);
      else onExit();
      return;
    }
    // Digitar na conversa, na observação da amostra ou em qualquer campo não dispara atalho.
    if (event.target.matches(TYPING_SELECTOR)) return;
    const key = event.key.toLowerCase();
    if (key === '/') {
      event.preventDefault();
      field.openDrawer('chat', true);
      return;
    }
    // Barra de espaço em um botão já aciona o botão: só vira pausa fora dele.
    if (key === ' ') {
      if (event.target.tagName === 'BUTTON') return;
      event.preventDefault();
      apply(setPaused, !session.state.paused);
      return;
    }
    const scenario = SCENARIOS[Number(key) - 1];
    if (scenario) apply(toggleScenario, scenario.id);
    else KEY_ACTIONS[key]?.();
  });

  stageElement.addEventListener('pointerdown', (event) => {
    if (!active || event.target.closest(NO_LOOK_SELECTOR)) return;
    look = Object.freeze({ ...look, dragging: true, lastX: event.clientX, lastY: event.clientY });
    stageElement.setPointerCapture(event.pointerId);
  });
  stageElement.addEventListener('pointermove', (event) => {
    if (!active || !look.dragging) return;
    look = Object.freeze({
      ...look,
      yawDeg: clamp(look.yawDeg + (event.clientX - look.lastX) * LOOK.degPerPx, -LOOK.maxYawDeg, LOOK.maxYawDeg),
      pitchDeg: clamp(look.pitchDeg - (event.clientY - look.lastY) * LOOK.degPerPx, -LOOK.maxPitchDeg, LOOK.maxPitchDeg),
      lastX: event.clientX,
      lastY: event.clientY,
    });
  });
  const endDrag = () => { look = Object.freeze({ ...look, dragging: false, idleS: 0 }); };
  stageElement.addEventListener('pointerup', endDrag);
  stageElement.addEventListener('pointercancel', endDrag);

  return Object.freeze({ start, stop, frame });
}
