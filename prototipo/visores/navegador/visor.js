// Visor navegador: o capacete como navegador de terreno. Segue o contrato de ../LEIA-ME.md.
// Este arquivo liga as peças: simulação (sim.js), leitura (leitura.js), assistente (assistente.js),
// HUD (hud.js), minimapa, perfil de altitude e a guia desenhada sobre a cena (mundo.js).

import { SIM } from '../../src/simulation.js';
import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { samplePath, headingAt } from '../../src/route.js';
import { fmtDistance, fmtNumber, fmtSigned } from '../../src/format.js';
import { COLORS } from '../../src/config.js';
import { h, setText } from '../../src/dom.js';
import { t } from '../../src/i18n.js';
import { analyzePlan, nextManeuver, HABITAT } from './analise.js';
import { createNavState, patchState, advance, jumpTo, setFree, FREE } from './sim.js';
import { deriveReadout, NAV } from './leitura.js';
import { buildGuidance, createSpeaker } from './assistente.js';
import { groundAttitude, slopeAlongHeading } from './terreno.js';
import { lineOfSight, antennaFrom } from './radio.js';
import { createHud } from './hud.js';
import { createMinimap, ZOOM_RADII_M, DEFAULT_ZOOM } from './minimapa.js';
import { createProfile } from './perfil.js';
import { createWorldGuide, createEdgeIndicator } from './mundo.js';

const DEG = Math.PI / 180;
const EYE_HEIGHT_M = Object.freeze({ foot: 1.7, cabin: 2.4 });
const MIN_CLEARANCE_M = 1;
const CAMERA = Object.freeze({ basePitchDeg: -5, slopePitchFactor: 0.5, baseTurnRate: 2, turnRatePerMps: 0.125, freeTurnRate: 10, heightRate: 6 });
const LOOK = Object.freeze({ degPerPx: 0.18, maxYawDeg: 120, maxPitchDeg: 45, returnDelayS: 1.5, returnRate: 2.2 });
const SCRUB_MAX = 1000;
const ATTITUDE_RATE = 6;
const PANEL_INTERVAL_S = 0.09;
const RADIO_INTERVAL_S = 0.25;
const TURN_MARK_PASSED_M = 20;
const GUIDE_LIFT_M = 2;
const SLOPE_STEP_M = 10;
// Teclas que pertencem ao próprio controle quando ele está em foco.
const SPACE_TAGS = new Set(['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA']);
const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const MOVE_KEYS = Object.freeze({
  w: 'forward', arrowup: 'forward', s: 'back', arrowdown: 'back',
  a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
});

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;
const zoomLabel = (radiusM) => t`raio ${radiusM >= 1000 ? `${fmtNumber(radiusM / 1000, radiusM % 1000 === 0 ? 0 : 1)} km` : `${radiusM} m`}`;

/**
 * @param {{
 *   mount: HTMLElement,
 *   stageElement: HTMLElement,
 *   camera: import('three').PerspectiveCamera,
 *   terrain: { heightAt: (x: number, z: number) => number, probe: (x: number, z: number) => object, isReal: boolean, cellM: number },
 *   overlays: { setNextStop: (id: string|null, label: string) => void },
 *   onExit: () => void,
 *   safety?: { assumptions?: { habitatMastM: number, suitAntennaM: number, o2ReservePct: number },
 *     commsAt?: (x: number, z: number) => { visible: boolean, distM: number },
 *     walkBackAt?: (x: number, z: number) => number },
 * }} context
 */
export function createVisor({ mount, stageElement, camera, terrain, overlays, onExit, safety }) {
  const antenna = antennaFrom(safety?.assumptions);
  const mast = Object.freeze({ ...HABITAT, antennaM: antenna.habitat });
  const hud = createHud(mount, terrain, antenna);
  const { els } = hud;
  const minimap = createMinimap(els.minimap);
  const profile = createProfile(els.profile);
  const edge = createEdgeIndicator();
  els.root.append(edge);
  const world = createWorldGuide({ canvas: els.world, camera, heightAt: terrain.heightAt, edge });
  const speaker = createSpeaker();
  const attitudeBaseM = terrain.cellM / 2;
  const analyses = new WeakMap();
  const held = new Set();

  els.speed.replaceChildren(...SIM.speeds.map((speed) => h('option', { value: String(speed) }, `${speed}×`)));
  els.scrub.max = String(SCRUB_MAX);
  if (!speaker.supported) {
    els.voice.disabled = true;
    els.voice.title = t`Voz indisponível neste navegador`;
  }

  let plan = null;
  let analysis = null;
  let state = createNavState();
  let active = false;
  let smoothedHeading = 0;
  let cameraY = 0;
  let look = Object.freeze({ yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0, lastX: 0, lastY: 0 });
  let attitude = { pitchDeg: 0, rollDeg: 0, slopeDeg: 0 };
  let radioNow = { visible: true, clearanceM: Infinity, blockAtM: 0, distM: 0 };
  let walkBackH = null;
  let scrubbing = false;
  let zoomIndex = DEFAULT_ZOOM;
  let voiceOn = false;
  let timeS = 0;
  let panelWaitS = 0;
  let radioWaitS = 0;
  let layout = { width: 0, height: 0, free: { left: 0, top: 0, width: 0, height: 0 } };

  // A análise da rota sobre o relevo é feita uma vez por plano e guardada.
  function analysisFor(nextPlan) {
    if (!analyses.has(nextPlan)) analyses.set(nextPlan, analyzePlan(nextPlan, terrain, antenna));
    return analyses.get(nextPlan);
  }

  // Tamanho do palco e a área livre no centro do visor (a célula da mira), para o indicador de borda.
  function measure() {
    const frame = mount.getBoundingClientRect();
    const cell = els.reticle.getBoundingClientRect();
    layout = {
      width: frame.width,
      height: frame.height,
      free: { left: cell.left - frame.left, top: cell.top - frame.top, width: cell.width, height: cell.height },
    };
  }

  function syncControls() {
    // O rótulo já diz o estado; aria-pressed junto com rótulo que muda seria contraditório.
    setText(els.pause, state.paused ? t`Continuar` : t`Pausar`);
    els.pause.dataset.active = String(state.paused);
    els.solar.setAttribute('aria-pressed', String(state.solarEvent));
    els.free.setAttribute('aria-pressed', String(Boolean(state.free)));
    els.voice.setAttribute('aria-pressed', String(voiceOn));
    els.pad.hidden = !state.free;
    els.speed.value = String(state.speed);
    setText(els.zoomLabel, zoomLabel(ZOOM_RADII_M[zoomIndex]));
    els.zoomIn.disabled = zoomIndex === 0;
    els.zoomOut.disabled = zoomIndex === ZOOM_RADII_M.length - 1;
  }

  const update = (changes) => { state = patchState(state, changes); syncControls(); };

  function setZoom(index) {
    zoomIndex = clamp(index, 0, ZOOM_RADII_M.length - 1);
    panelWaitS = PANEL_INTERVAL_S;
    syncControls();
  }

  function toggleFree() {
    if (!plan) return;
    state = setFree(plan, analysis, state, !state.free);
    held.clear();
    syncControls();
  }

  function toggleVoice() {
    voiceOn = speaker.setEnabled(!voiceOn);
    syncControls();
  }

  // Onde o astronauta está: na rota (trilhos) ou onde o teclado levou (caminhada livre).
  function currentPose() {
    if (state.free) return { ...state.free, free: true };
    const here = samplePath(plan.path, state.distM);
    return { x: here.x, z: here.z, headingDeg: headingAt(plan.path, state.distM), free: false, offM: 0, side: 'direita', movingKmh: 0 };
  }

  function readInput() {
    return {
      move: (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0),
      turn: (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0),
      pitchDeg: attitude.pitchDeg,
    };
  }

  function readAttitude(pose, dtS) {
    const raw = groundAttitude(terrain.heightAt, pose.x, pose.z, pose.headingDeg, attitudeBaseM);
    const blend = 1 - Math.exp(-dtS * ATTITUDE_RATE);
    return {
      pitchDeg: attitude.pitchDeg + (raw.pitchDeg - attitude.pitchDeg) * blend,
      rollDeg: attitude.rollDeg + (raw.rollDeg - attitude.rollDeg) * blend,
      slopeDeg: attitude.slopeDeg + (raw.slopeDeg - attitude.slopeDeg) * blend,
    };
  }

  // Quem diz se há visada é `safety.commsAt` (a mesma conta do tablet). A reta calculada aqui
  // acrescenta o que ele não devolve: a folga sobre o relevo e onde está o bloqueio.
  function readRadio(pose) {
    const sight = lineOfSight(terrain.heightAt, { x: pose.x, z: pose.z, antennaM: antenna.suit }, mast);
    if (!safety?.commsAt) return sight;
    const { visible } = safety.commsAt(pose.x, pose.z);
    // As duas contas usam a mesma geometria. Se um dia divergirem, a folga daqui deixa de valer.
    return visible === sight.visible ? sight : { ...sight, visible, clearanceM: NaN };
  }

  // Horas de caminhada direta até o habitat, pelo roteador compartilhado (null se o contexto não traz).
  const readWalkBack = (pose) => (safety?.walkBackAt ? safety.walkBackAt(pose.x, pose.z) : null);

  function start(nextPlan) {
    plan = nextPlan;
    analysis = analysisFor(plan);
    state = createNavState();
    look = Object.freeze({ ...look, yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0 });
    held.clear();
    const pose = currentPose();
    const onFoot = samplePath(plan.path, 0).onFoot;
    smoothedHeading = pose.headingDeg;
    cameraY = terrain.heightAt(pose.x, pose.z) + (onFoot ? EYE_HEIGHT_M.foot : EYE_HEIGHT_M.cabin);
    attitude = groundAttitude(terrain.heightAt, pose.x, pose.z, pose.headingDeg, attitudeBaseM);
    radioNow = readRadio(pose);
    walkBackH = readWalkBack(pose);
    minimap.setPlan(plan, analysis);
    profile.setPlan(plan, analysis);
    panelWaitS = PANEL_INTERVAL_S;
    active = true;
    mount.hidden = false;
    measure();
    syncControls();
    // O painel do tablet some nesta tela: o foco vai para o primeiro controle do visor.
    els.pause.focus();
  }

  function stop() {
    active = false;
    mount.hidden = true;
    held.clear();
    voiceOn = speaker.setEnabled(false);
    overlays.setNextStop(null, '');
  }

  // Depois de um tempo sem arrastar, o olhar volta devagar para a frente.
  function settleLook(dtS) {
    if (look.dragging) return;
    const idleS = look.idleS + dtS;
    const keep = idleS > LOOK.returnDelayS ? Math.exp(-dtS * LOOK.returnRate) : 1;
    look = Object.freeze({ ...look, idleS, yawDeg: look.yawDeg * keep, pitchDeg: look.pitchDeg * keep });
  }

  function applyCamera(pose, readout, ground, dtS) {
    const realSpeedMps = (readout.movingKmh / 3.6) * state.speed;
    const turnRate = pose.free ? CAMERA.freeTurnRate : CAMERA.baseTurnRate + realSpeedMps * CAMERA.turnRatePerMps;
    smoothedHeading = normalizeDeg(smoothedHeading + angleDeltaDeg(smoothedHeading, pose.headingDeg) * (1 - Math.exp(-dtS * turnRate)));

    const eyeY = ground.y + (readout.here.onFoot ? EYE_HEIGHT_M.foot : EYE_HEIGHT_M.cabin);
    cameraY += (eyeY - cameraY) * (1 - Math.exp(-dtS * CAMERA.heightRate));
    cameraY = Math.max(cameraY, ground.y + MIN_CLEARANCE_M);

    const pitchDeg = CAMERA.basePitchDeg + attitude.pitchDeg * CAMERA.slopePitchFactor + look.pitchDeg;
    camera.position.set(pose.x, cameraY, pose.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitchDeg * DEG, -(smoothedHeading + look.yawDeg) * DEG, 0);
    // As matrizes precisam estar em dia para projetar a guia neste mesmo quadro.
    camera.updateMatrixWorld();
    return normalizeDeg(smoothedHeading + look.yawDeg);
  }

  function drawWorld(pose, readout) {
    const { target, rejoin, guide } = readout;
    const nextStop = plan.stops[state.stopsReached];
    const dwelling = target.kind === 'dwell';
    world.draw({
      analysis,
      distM: state.distM,
      limitM: dwelling ? state.distM : (nextStop ? nextStop.distM : plan.path.totalM),
      onFoot: readout.here.onFoot,
      color: plan.mode === 'walk' ? COLORS.route : COLORS.vehicle,
      timeS,
      eye: camera.position,
      maneuver: nextManeuver(analysis, state.distM, TURN_MARK_PASSED_M),
      feet: pose,
      rejoin,
      cssWidth: layout.width,
      cssHeight: layout.height,
    });
    const label = rejoin ? t`Retomar a rota · ${fmtDistance(rejoin.distM)}` : `${target.name} · ${fmtDistance(target.distM)}`;
    const edgeTarget = dwelling || state.finished ? null : { x: guide.x, y: terrain.heightAt(guide.x, guide.z) + GUIDE_LIFT_M, z: guide.z, label };
    world.pointTo(edgeTarget, layout.free);
  }

  // Minimapa e perfil são redesenhados poucas vezes por segundo, e só se algo mudou.
  function drawPanels(dtS, pose, readout) {
    panelWaitS += dtS;
    if (panelWaitS < PANEL_INTERVAL_S) return;
    panelWaitS = 0;
    minimap.draw({
      x: pose.x,
      z: pose.z,
      headingDeg: smoothedHeading,
      lookDeg: look.yawDeg,
      distM: state.distM,
      radiusM: ZOOM_RADII_M[zoomIndex],
      targetId: readout.target.stop.id,
      rejoin: readout.rejoin,
      radio: radioNow,
    });
    const ahead = profile.draw(state.distM);
    setText(els.profileCaption, t`Perfil à frente · ${fmtDistance(ahead.aheadM)} · ${fmtSigned(ahead.gainM)} m · máx. ${fmtSigned(ahead.peakDeg)}° · faixa de baixo: rádio`);
  }

  function speak(readout, guidance) {
    if (!voiceOn) return;
    const { primary } = guidance;
    const lossSoon = readout.radio.lossSoon;
    const text = lossSoon ? `${primary.text} ${t`Atenção: o rádio cai em ${fmtDistance(readout.radio.lossInM)}.`}` : primary.text;
    speaker.say(lossSoon ? `${primary.key}|radio` : primary.key, text, primary.level === 'danger');
  }

  function frame(dtS) {
    if (!active || !plan) return;
    timeS += dtS;
    const wasFinished = state.finished;
    state = advance(plan, analysis, state, dtS, readInput());
    if (state.finished !== wasFinished) syncControls();

    const pose = currentPose();
    const ground = terrain.probe(pose.x, pose.z);
    attitude = readAttitude(pose, dtS);
    const aheadFree = pose.free ? slopeAlongHeading(terrain.heightAt, pose.x, pose.z, pose.headingDeg, NAV.slopeLookaheadM, SLOPE_STEP_M) : null;
    const readout = deriveReadout({
      plan, analysis, state, pose, ground, attitude, aheadFree, radioNow, walkBackH,
      o2ReservePct: safety?.assumptions?.o2ReservePct,
    });
    const guidance = buildGuidance(plan, analysis, state, readout);

    radioWaitS += dtS;
    if (radioWaitS >= RADIO_INTERVAL_S) {
      radioWaitS = 0;
      radioNow = readRadio(pose);
      walkBackH = readWalkBack(pose);
    }

    settleLook(dtS);
    const viewHeading = applyCamera(pose, readout, ground, dtS);
    hud.render(readout, guidance, state, viewHeading);
    drawWorld(pose, readout);
    drawPanels(dtS, pose, readout);
    speak(readout, guidance);

    const { target } = readout;
    overlays.setNextStop(target.stop.id, target.kind === 'dwell' ? target.name : `${target.name} · ${fmtDistance(target.distM)}`);
    // Enquanto a pessoa segura a barra, quem manda no valor é ela.
    if (!scrubbing) els.scrub.value = String(Math.round((state.distM / plan.path.totalM) * SCRUB_MAX));
  }

  els.pause.addEventListener('click', () => update({ paused: !state.paused }));
  els.solar.addEventListener('click', () => update({ solarEvent: !state.solarEvent }));
  // Na caminhada livre a velocidade fica em até 20×, senão um quadro pula a chegada na parada.
  els.speed.addEventListener('change', () => {
    const chosen = Number(els.speed.value);
    update({ speed: state.free ? Math.min(chosen, FREE.maxSimSpeed) : chosen });
  });
  els.scrub.addEventListener('pointerdown', () => { scrubbing = true; });
  window.addEventListener('pointerup', () => { scrubbing = false; });
  window.addEventListener('pointercancel', () => { scrubbing = false; });
  els.free.addEventListener('click', toggleFree);
  els.voice.addEventListener('click', toggleVoice);
  els.zoomIn.addEventListener('click', () => setZoom(zoomIndex - 1));
  els.zoomOut.addEventListener('click', () => setZoom(zoomIndex + 1));
  els.exit.addEventListener('click', onExit);
  els.scrub.addEventListener('input', () => {
    if (!plan) return;
    state = jumpTo(plan, analysis, state, (Number(els.scrub.value) / SCRUB_MAX) * plan.path.totalM);
    // No salto a câmera já chega olhando para a rota, em vez de girar até ela.
    smoothedHeading = currentPose().headingDeg;
    radioWaitS = RADIO_INTERVAL_S;
    syncControls();
  });

  document.addEventListener('keydown', (event) => {
    if (!active) return;
    const tag = event.target.tagName;
    // Com a lista de velocidade em foco, Esc pertence a ela (fecha a lista).
    if (event.key === 'Escape') { if (tag !== 'SELECT') onExit(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === ' ') {
      if (SPACE_TAGS.has(tag)) return;
      event.preventDefault();
      update({ paused: !state.paused });
      return;
    }
    if (FIELD_TAGS.has(tag)) return;
    const move = MOVE_KEYS[key];
    if (move && state.free) {
      event.preventDefault();
      held.add(move);
    } else if (key === '+' || key === '=') setZoom(zoomIndex - 1);
    else if (key === '-') setZoom(zoomIndex + 1);
    else if (key === 'l') toggleFree();
    else if (key === 'v' && speaker.supported) toggleVoice();
  });
  document.addEventListener('keyup', (event) => {
    const move = MOVE_KEYS[event.key.toLowerCase()];
    if (move) held.delete(move);
  });
  window.addEventListener('blur', () => held.clear());

  // Botões de direção na tela, para a caminhada livre sem teclado.
  for (const button of els.pad.querySelectorAll('[data-pad]')) {
    const release = () => held.delete(button.dataset.pad);
    button.addEventListener('pointerdown', (event) => {
      button.setPointerCapture(event.pointerId);
      held.add(button.dataset.pad);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  stageElement.addEventListener('pointerdown', (event) => {
    if (!active || event.target.closest('.navegador-controles, .navegador-pad, .navegador-zoom')) return;
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

  new ResizeObserver(() => { if (active) measure(); }).observe(els.reticle);

  return Object.freeze({ start, stop, frame });
}
