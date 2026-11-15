// Visor base: câmera em primeira pessoa seguindo a rota e o HUD do capacete.
// Segue o contrato descrito em ../LEIA-ME.md.

import { SIM, createSimState, patchState, advance, jumpTo, deriveReadout } from '../../src/simulation.js';
import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { samplePath, headingAt } from '../../src/route.js';
import { fmtDistance, fmtDuration, fmtNumber, fmtClock, fmtSigned } from '../../src/format.js';
import { byId, h, setText } from '../../src/dom.js';

const DEG = Math.PI / 180;
const EYE_HEIGHT_M = Object.freeze({ walk: 1.7, car: 2.4 });
const MIN_CLEARANCE_M = 1;
const CAMERA = Object.freeze({ basePitchDeg: -5, slopePitchFactor: 0.5, baseTurnRate: 2, turnRatePerMps: 0.125, heightRate: 6 });
const LOOK = Object.freeze({ degPerPx: 0.18, maxYawDeg: 120, maxPitchDeg: 45, returnDelayS: 1.5, returnRate: 2.2 });
const COMPASS = Object.freeze({ pxPerDeg: 5, marginDeg: 60, tickDeg: 15, maxTargetDeg: 30 });
const CARDINALS = Object.freeze({ 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' });
const SCRUB_MAX = 1000;
const MODE_LABEL = Object.freeze({ walk: 'A pé', car: 'Veículo' });
const LEVELS = Object.freeze({ o2: { danger: 25, warn: 45 }, battery: { danger: 20, warn: 40 } });
const TYPING_TAGS = new Set(['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA']);

// Marcação fixa do HUD (texto estático, sem dado externo).
const HUD_TEMPLATE = `
<div class="hud" id="hud">
  <div class="hud-frame" aria-hidden="true"></div>

  <div class="hud-view">
    <section class="hud-block hud-clock" aria-label="Tempo de missão">
      <span class="hud-label">Tempo de saída</span>
      <b class="hud-value" id="hud-elapsed">0h00</b>
      <span class="hud-sub"><span id="hud-mode">A pé</span> · hora local <span id="hud-clock">09:00</span></span>
    </section>

    <section class="hud-compass" aria-label="Bússola">
      <div class="compass-window">
        <div class="compass-tape" id="hud-tape"></div>
        <i class="compass-needle"></i>
        <i class="compass-target" id="hud-target"></i>
      </div>
      <b class="hud-value" id="hud-heading">000°</b>
    </section>

    <section class="hud-block hud-next" aria-label="Próximo destino">
      <span class="hud-label" id="hud-next-label">Próxima parada</span>
      <b class="hud-value" id="hud-next-name">–</b>
      <span class="hud-sub"><span id="hud-next-dist"></span> <span id="hud-next-eta"></span> <span id="hud-next-gain"></span></span>
    </section>

    <div class="hud-alerts" id="hud-alerts"></div>
    <p class="visually-hidden" id="hud-announce" role="status" aria-live="polite"></p>
    <i class="hud-reticle" aria-hidden="true"></i>

    <section class="hud-block hud-suit" aria-label="Traje">
      <span class="hud-label">Traje <small>simulado</small></span>
      <div class="meter" id="hud-o2"><span>O₂</span><i class="meter-bar"></i><b id="hud-o2-value">100%</b></div>
      <div class="meter" id="hud-battery"><span>Bateria</span><i class="meter-bar"></i><b id="hud-battery-value">100%</b></div>
      <div class="hud-row"><span>Margem de O₂ no fim</span><b id="hud-margin">–</b></div>
    </section>

    <section class="hud-block hud-env" aria-label="Ambiente">
      <span class="hud-label">Ambiente</span>
      <div class="hud-row"><span>Declive</span><b id="hud-slope">–</b></div>
      <div class="hud-row"><span>Altitude</span><b id="hud-altitude">–</b></div>
      <div class="hud-row"><span>Radiação <small>RAD</small></span><b id="hud-radiation">–</b></div>
      <div class="hud-row"><span>Dose na saída <small>est.</small></span><b id="hud-dose">–</b></div>
      <div class="hud-row"><span>Temp. do ar <small>est.</small></span><b id="hud-temperature">–</b></div>
    </section>

    <p class="hud-copilot">
      <span class="hud-label">Copiloto <small>regras simuladas</small></span>
      <span id="hud-copilot"></span>
    </p>
  </div>

  <div class="hud-controls" role="toolbar" aria-label="Controles da simulação">
    <button type="button" id="hud-pause">Pausar</button>
    <label>Velocidade <select id="hud-speed"></select></label>
    <input type="range" id="hud-scrub" min="0" value="0" aria-label="Posição na rota">
    <button type="button" id="hud-solar" aria-pressed="false">Simular evento solar</button>
    <button type="button" id="hud-exit" class="primary">Voltar ao tablet</button>
  </div>
</div>
`;

const ELEMENT_IDS = Object.freeze({
  root: 'hud', elapsed: 'hud-elapsed', mode: 'hud-mode', clock: 'hud-clock', heading: 'hud-heading',
  tape: 'hud-tape', targetMarker: 'hud-target', nextLabel: 'hud-next-label', nextName: 'hud-next-name',
  nextDist: 'hud-next-dist', nextEta: 'hud-next-eta', nextGain: 'hud-next-gain', alerts: 'hud-alerts',
  o2Meter: 'hud-o2', o2Value: 'hud-o2-value', batteryMeter: 'hud-battery', batteryValue: 'hud-battery-value',
  margin: 'hud-margin', slope: 'hud-slope', altitude: 'hud-altitude', radiation: 'hud-radiation',
  dose: 'hud-dose', temperature: 'hud-temperature', copilot: 'hud-copilot', announce: 'hud-announce',
  pause: 'hud-pause', speed: 'hud-speed', scrub: 'hud-scrub', solar: 'hud-solar', exit: 'hud-exit',
});

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;
const levelFor = (value, limits) => (value < limits.danger ? 'danger' : value < limits.warn ? 'warn' : 'ok');

function buildCompassTape(tape) {
  const { pxPerDeg, marginDeg, tickDeg } = COMPASS;
  for (let deg = -marginDeg; deg <= 360 + marginDeg; deg += tickDeg) {
    const label = CARDINALS[normalizeDeg(deg)] ?? '';
    tape.append(h('span', { class: label ? 'tick major' : 'tick', style: `left:${(deg + marginDeg) * pxPerDeg}px` }, label));
  }
}

function setMeter(meter, valueNode, pct, limits) {
  meter.style.setProperty('--fill', (pct / 100).toFixed(3));
  meter.dataset.level = levelFor(pct, limits);
  setText(valueNode, `${fmtNumber(pct)}%`);
}

function renderTarget(els, target) {
  setText(els.nextLabel, target.label);
  setText(els.nextName, target.name);
  if (target.kind === 'dwell') {
    setText(els.nextDist, 'coleta em andamento');
    setText(els.nextEta, `faltam ${fmtDuration(target.etaH)}`);
    setText(els.nextGain, '');
    return;
  }
  setText(els.nextDist, fmtDistance(target.distM));
  setText(els.nextEta, `chegada em ${fmtDuration(target.etaH)}`);
  setText(els.nextGain, `${fmtSigned(target.gainM)} m`);
}

// Os alertas visíveis mudam a cada metro (têm distância e ângulo no texto). O leitor de
// tela só é avisado quando um tipo de alerta aparece ou some, senão falaria sem parar.
function renderAlerts(container, announcer, alerts) {
  const key = alerts.map((alert) => `${alert.level}:${alert.text}`).join('|');
  if (container.dataset.key !== key) {
    container.dataset.key = key;
    container.replaceChildren(...alerts.map((alert) => h('p', { class: `alert ${alert.level}` }, alert.text)));
  }
  const kinds = alerts.map((alert) => alert.kind).join('|');
  if (announcer.dataset.kinds !== kinds) {
    announcer.dataset.kinds = kinds;
    announcer.textContent = alerts.map((alert) => alert.text).join('. ');
  }
}

function renderCompass(els, viewHeading, targetBearing) {
  const { pxPerDeg, marginDeg, maxTargetDeg } = COMPASS;
  els.tape.style.transform = `translateX(${-(viewHeading + marginDeg) * pxPerDeg}px)`;
  els.targetMarker.hidden = targetBearing === null;
  if (targetBearing !== null) {
    const delta = angleDeltaDeg(viewHeading, targetBearing);
    const shown = clamp(delta, -maxTargetDeg, maxTargetDeg);
    els.targetMarker.style.transform = `translateX(${shown * pxPerDeg}px)`;
    els.targetMarker.dataset.off = String(shown !== delta);
  }
  setText(els.heading, `${String(Math.round(viewHeading) % 360).padStart(3, '0')}°`);
}

function renderHud(els, plan, readout, viewHeading) {
  setText(els.elapsed, fmtDuration(readout.elapsedH));
  setText(els.mode, readout.here.onFoot ? MODE_LABEL.walk : MODE_LABEL.car);
  setText(els.clock, fmtClock(readout.clockH));
  renderCompass(els, viewHeading, readout.targetBearing);
  renderTarget(els, readout.target);
  renderAlerts(els.alerts, els.announce, readout.alerts);

  const { suit } = readout;
  setMeter(els.o2Meter, els.o2Value, suit.o2Pct, LEVELS.o2);
  setMeter(els.batteryMeter, els.batteryValue, suit.batteryPct, LEVELS.battery);
  setText(els.margin, fmtDuration(suit.marginH));
  els.margin.dataset.level = suit.marginH < 0 ? 'danger' : suit.marginH < SIM.lowMarginH ? 'warn' : 'ok';

  setText(els.slope, `${fmtSigned(readout.slopeDeg)}°`);
  setText(els.altitude, `${fmtNumber(readout.here.elev)} m`);
  setText(els.radiation, `${fmtNumber(readout.radiationRate)} µSv/h`);
  setText(els.dose, `${fmtNumber(readout.doseUsv)} µSv`);
  setText(els.temperature, `${fmtNumber(readout.airTempC)} °C`);
  setText(els.copilot, readout.copilot);
}

/**
 * @param {{
 *   mount: HTMLElement,
 *   stageElement: HTMLElement,
 *   camera: import('three').PerspectiveCamera,
 *   terrain: { probe: (x: number, z: number) => { y: number, radiation: number, groundTemp: number } },
 *   overlays: { setNextStop: (id: string|null, label: string) => void },
 *   onExit: () => void,
 * }} deps
 */
export function createVisor({ mount, stageElement, camera, terrain, overlays, onExit }) {
  mount.innerHTML = HUD_TEMPLATE;
  const els = Object.fromEntries(Object.entries(ELEMENT_IDS).map(([key, id]) => [key, byId(id)]));
  buildCompassTape(els.tape);
  els.speed.replaceChildren(...SIM.speeds.map((speed) => h('option', { value: String(speed) }, `${speed}×`)));
  els.scrub.max = String(SCRUB_MAX);

  let plan = null;
  let state = createSimState();
  let active = false;
  let smoothedHeading = 0;
  let cameraY = 0;
  let look = Object.freeze({ yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0, lastX: 0, lastY: 0 });

  function syncControls() {
    // O rótulo já diz o estado; aria-pressed junto com rótulo que muda seria contraditório.
    setText(els.pause, state.paused ? 'Continuar' : 'Pausar');
    els.pause.dataset.active = String(state.paused);
    els.solar.setAttribute('aria-pressed', String(state.solarEvent));
    els.speed.value = String(state.speed);
  }

  const update = (changes) => { state = patchState(state, changes); syncControls(); };

  function start(nextPlan) {
    plan = nextPlan;
    state = createSimState();
    look = Object.freeze({ ...look, yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0 });
    smoothedHeading = headingAt(plan.path, 0);
    const origin = samplePath(plan.path, 0);
    cameraY = terrain.probe(origin.x, origin.z).y + EYE_HEIGHT_M[plan.mode];
    active = true;
    mount.hidden = false;
    syncControls();
    // O painel do tablet some nesta tela: o foco vai para o primeiro controle do visor.
    els.pause.focus();
  }

  function stop() {
    active = false;
    mount.hidden = true;
    overlays.setNextStop(null, '');
  }

  // Depois de um tempo sem arrastar, o olhar volta devagar para a frente.
  function settleLook(dtS) {
    if (look.dragging) return;
    const idleS = look.idleS + dtS;
    const keep = idleS > LOOK.returnDelayS ? Math.exp(-dtS * LOOK.returnRate) : 1;
    look = Object.freeze({ ...look, idleS, yawDeg: look.yawDeg * keep, pitchDeg: look.pitchDeg * keep });
  }

  function applyCamera(readout, ground, dtS) {
    const { here } = readout;
    const realSpeedMps = state.paused || state.dwellRemainingH > 0 ? 0 : (here.speedKmh / 3.6) * state.speed;
    const turnRate = CAMERA.baseTurnRate + realSpeedMps * CAMERA.turnRatePerMps;
    smoothedHeading = normalizeDeg(smoothedHeading + angleDeltaDeg(smoothedHeading, readout.heading) * (1 - Math.exp(-dtS * turnRate)));

    const eyeY = ground.y + EYE_HEIGHT_M[here.onFoot ? 'walk' : 'car'];
    cameraY += (eyeY - cameraY) * (1 - Math.exp(-dtS * CAMERA.heightRate));
    cameraY = Math.max(cameraY, ground.y + MIN_CLEARANCE_M);

    const pitchDeg = CAMERA.basePitchDeg + readout.slopeDeg * CAMERA.slopePitchFactor + look.pitchDeg;
    camera.position.set(here.x, cameraY, here.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitchDeg * DEG, -(smoothedHeading + look.yawDeg) * DEG, 0);
    return normalizeDeg(smoothedHeading + look.yawDeg);
  }

  function frame(dtS) {
    if (!active || !plan) return;
    const wasFinished = state.finished;
    state = advance(plan, state, dtS);
    if (state.finished !== wasFinished) syncControls();

    const here = samplePath(plan.path, state.distM);
    const ground = terrain.probe(here.x, here.z);
    const readout = deriveReadout(plan, state, ground);
    settleLook(dtS);
    const viewHeading = applyCamera(readout, ground, dtS);
    renderHud(els, plan, readout, viewHeading);

    const { target } = readout;
    overlays.setNextStop(target.stop.id, target.kind === 'dwell' ? target.name : `${target.name} · ${fmtDistance(target.distM)}`);
    // Enquanto a pessoa segura a barra, quem manda no valor é ela.
    if (!els.scrub.matches(':active')) els.scrub.value = String(Math.round((state.distM / plan.path.totalM) * SCRUB_MAX));
  }

  els.pause.addEventListener('click', () => update({ paused: !state.paused }));
  els.solar.addEventListener('click', () => update({ solarEvent: !state.solarEvent }));
  els.speed.addEventListener('change', () => update({ speed: Number(els.speed.value) }));
  els.exit.addEventListener('click', onExit);
  els.scrub.addEventListener('input', () => {
    if (!plan) return;
    state = jumpTo(plan, state, (Number(els.scrub.value) / SCRUB_MAX) * plan.path.totalM);
    syncControls();
  });

  document.addEventListener('keydown', (event) => {
    if (!active) return;
    if (event.key === 'Escape') onExit();
    if (event.key === ' ' && !TYPING_TAGS.has(event.target.tagName)) {
      event.preventDefault();
      update({ paused: !state.paused });
    }
  });

  stageElement.addEventListener('pointerdown', (event) => {
    if (!active || event.target.closest('.hud-controls')) return;
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
