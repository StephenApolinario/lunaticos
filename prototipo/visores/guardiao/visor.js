// Visor Guardião: o capacete como oficial de segurança. Tudo na tela responde
// "estou seguro, e se não estiver, o que faço agora?".
// Este arquivo é a cola com o navegador: câmera, teclado, som e o laço de quadros.
// A lógica fica em session.js e nos módulos que ele usa. Contrato em ../LEIA-ME.md.

import * as THREE from 'three';
import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { samplePath, headingAt } from '../../src/route.js';
import { fmtDistance, fmtDuration } from '../../src/format.js';
import { t } from '../../src/i18n.js';
import { LEVELS, SCENARIOS, SHELTER_NAMES } from './catalog.js';
import { createAnalyzer } from './analysis.js';
import { statusLine, assistantMessage, goStepText } from './rules.js';
import { firstUnacked } from './alerts.js';
import { protocolView } from './protocols.js';
import {
  createSession, stepSession, setPaused, setSpeed, toggleScenario, clearScenarios, acknowledge, confirmCurrentStep, decideCurrent, scrubTo,
} from './session.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const DEG = Math.PI / 180;
const EYE_HEIGHT_M = Object.freeze({ walk: 1.7, car: 2.4 });
const MIN_CLEARANCE_M = 1;
const CAMERA = Object.freeze({ basePitchDeg: -5, slopePitchFactor: 0.5, baseTurnRate: 2, turnRatePerMps: 0.125, heightRate: 6 });
const LOOK = Object.freeze({ degPerPx: 0.18, maxYawDeg: 120, maxPitchDeg: 45, returnDelayS: 1.5, returnRate: 2.2 });
// Onde uma tecla é texto do próprio controle. A barra de posição (range) não entra: nela os atalhos valem.
const TYPING_SELECTOR = 'select, textarea, input:not([type="range"])';
// Alarme sem reconhecimento volta a soar a cada tantos segundos.
const REPEAT_S = Object.freeze({ emergencia: 3, perigo: 8 });
const MARK = Object.freeze({ heightM: 3, edge: 1.05, pnrMaxM: 2500 });

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

/**
 * @param {{
 *   mount: HTMLElement,
 *   stageElement: HTMLElement,
 *   camera: import('three').PerspectiveCamera,
 *   terrain: { isReal: boolean, heightAt: (x: number, z: number) => number, probe: (x: number, z: number) => { y: number, slopeDeg: number, radiation: number, groundTemp: number } },
 *   overlays: { setNextStop: (id: string|null, label: string) => void },
 *   onExit: () => void,
 *   safety: { walkBackAt: Function, commsAt: Function, nearestShelter: Function },
 * }} context
 */
export function createVisor({ mount, stageElement, camera, terrain, overlays, onExit, safety }) {
  if (!safety) throw new Error('O visor Guardião precisa de context.safety (ver visores/LEIA-ME.md).');
  const audio = createAudio();
  const analyzer = createAnalyzer(safety, terrain.isReal);
  const projected = new THREE.Vector3();

  let session = null;
  let active = false;
  let historyOpen = false;
  let spokenKey = null;
  let repeatS = 0;
  let smoothedHeading = 0;
  let cameraY = 0;
  let look = Object.freeze({ yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0, lastX: 0, lastY: 0 });

  function syncControls() {
    if (!session) return;
    hud.syncControls({ state: session.state, mode: session.plan.mode, soundOn: audio.soundOn, voiceOn: audio.voiceOn, hasVoice: audio.hasVoice, historyOpen });
  }

  // Toda ação do usuário passa por aqui: muda a sessão e refaz a análise no próximo quadro.
  function apply(action, ...args) {
    if (!session) return;
    analyzer.invalidate();
    session = action(session, ...args);
    syncControls();
  }

  const toggleHistory = () => { historyOpen = !historyOpen; syncControls(); };
  const hud = createHud(mount, {
    pause: () => apply(setPaused, !session.state.paused),
    speed: (value) => apply(setSpeed, value),
    scrub: (fraction) => apply(scrubTo, fraction),
    exit: onExit,
    scenario: (id) => apply(toggleScenario, id),
    clear: () => apply(clearScenarios),
    ack: (id) => apply(acknowledge, id),
    confirm: () => apply(confirmCurrentStep),
    decide: (choice) => apply(decideCurrent, choice),
    sound: () => { audio.toggleSound(); syncControls(); },
    voice: () => { audio.toggleVoice(); syncControls(); },
    history: toggleHistory,
  });

  function start(plan) {
    session = createSession(plan);
    analyzer.invalidate();
    historyOpen = false;
    spokenKey = null;
    repeatS = 0;
    look = Object.freeze({ ...look, yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0 });
    smoothedHeading = headingAt(plan.path, 0);
    const origin = samplePath(plan.path, 0);
    cameraY = terrain.probe(origin.x, origin.z).y + EYE_HEIGHT_M[plan.mode];
    active = true;
    mount.hidden = false;
    // Entrar no visor é um gesto do usuário: é quando o navegador libera o áudio.
    audio.unlock();
    syncControls();
    hud.focus();
  }

  function stop() {
    active = false;
    mount.hidden = true;
    audio.silence();
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
      if (at) marks.pnr = { ...at, text: t`Ponto de não retorno · ${fmtDistance(r.pnr.aheadM)}` };
    }
    const pick = proto?.pick;
    // O habitat já tem o pino dele no mapa; aqui entram veículo e relevo.
    if (pick && pick.kind !== 'habitat' && pick.distM >= 1) {
      const at = project(pick.position);
      if (at) marks.shelter = { ...at, text: t`Abrigo · ${SHELTER_NAMES[pick.kind].toLowerCase()} · ${fmtDistance(pick.distM)}` };
    }
    return marks;
  }

  function announce(events, alerts, assistant, dtS) {
    for (const event of events) {
      if (event.type !== 'raised' && event.type !== 'escalated') continue;
      audio.play(event.alert.level);
      hud.announce(`${LEVELS[event.alert.level].label}: ${event.alert.title}. ${event.alert.action}`);
    }
    const waiting = firstUnacked(alerts);
    const everyS = waiting ? REPEAT_S[waiting.level] : undefined;
    repeatS = everyS ? repeatS + dtS : 0;
    if (everyS && repeatS >= everyS) {
      repeatS = 0;
      audio.play(waiting.level);
    }
    if (assistant.key !== spokenKey) {
      spokenKey = assistant.key;
      audio.speak(assistant.text, assistant.priority);
    }
  }

  function frame(dtS) {
    if (!active || !session) return;
    const wasFinished = session.state.finished;
    session = stepSession(session, dtS, terrain, analyzer);
    const { r, alerts } = session;
    if (session.state.finished !== wasFinished) syncControls();

    const proto = protocolView(session.protocols, r, goStepText);
    const assistant = assistantMessage(r, alerts.active, proto);
    announce(session.events, alerts, assistant, dtS);
    settleLook(dtS);
    const viewHeading = applyCamera(r, session.pos, session.ground, dtS);
    hud.render({
      r, alerts, proto, assistant, viewHeading, historyOpen,
      trends: session.trends.dir, status: statusLine(r, alerts.active), marks: buildMarks(r, proto),
    });

    const { target } = r;
    const atTarget = target.kind === 'dwell' || target.kind === 'home';
    const howFar = target.timeOnly ? fmtDuration(target.etaH) : fmtDistance(target.distM);
    const pinText = target.kind === 'shelter' ? t`Abrigo · ${target.name} · ${howFar}` : `${target.name} · ${howFar}`;
    overlays.setNextStop(target.stopId, atTarget ? target.name : pinText);
  }

  const KEY_ACTIONS = Object.freeze({
    r: () => apply(acknowledge),
    p: () => apply(confirmCurrentStep),
    a: () => apply(decideCurrent, 'abortar'),
    s: () => apply(decideCurrent, 'seguir'),
    h: toggleHistory,
    m: () => { audio.toggleSound(); syncControls(); },
    v: () => { audio.toggleVoice(); syncControls(); },
    0: () => apply(clearScenarios),
  });

  document.addEventListener('keydown', (event) => {
    if (!active || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      if (historyOpen) toggleHistory();
      else onExit();
      return;
    }
    if (event.target.matches(TYPING_SELECTOR)) return;
    const key = event.key.toLowerCase();
    // Barra de espaço em um botão já aciona o botão: só vira pausa fora dele.
    if (key === ' ' && event.target.tagName !== 'BUTTON') {
      event.preventDefault();
      apply(setPaused, !session.state.paused);
      return;
    }
    const scenario = SCENARIOS[Number(key) - 1];
    if (scenario) apply(toggleScenario, scenario.id);
    else KEY_ACTIONS[key]?.();
  });

  stageElement.addEventListener('pointerdown', (event) => {
    if (!active || event.target.closest('button, select, input, label, .guardiao-historico')) return;
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
