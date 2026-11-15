// HUD da variante cientista: marcação fixa e as funções que a atualizam a cada quadro.
// O DOM só é tocado quando o valor muda, para a animação continuar fluida.
// É a parte específica deste visor: o assistente, o diário e os perigos não dependem dela.

import { SIM } from '../../src/simulation.js';
import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { fmtDistance, fmtDuration, fmtNumber, fmtClock, fmtSigned } from '../../src/format.js';
import { byId, h, setText } from '../../src/dom.js';
import { t } from '../../src/i18n.js';
import { LIMITS, pct } from './contexto.js';

const COMPASS = Object.freeze({ pxPerDeg: 5, marginDeg: 60, tickDeg: 15, maxTargetDeg: 30 });
const CARDINALS = Object.freeze({ 0: 'N', 45: 'NE', 90: t('L', 'ponto cardeal'), 135: 'SE', 180: 'S', 225: t('SO', 'ponto cardeal'), 270: t('O', 'ponto cardeal'), 315: t('NO', 'ponto cardeal') });
const MODE_LABEL = Object.freeze({ walk: t`A pé`, car: t`Veículo` });
const DIRECTION_LABEL = Object.freeze({ back: t`voltando`, forward: t`seguindo` });

// Marcação fixa do HUD (texto estático, sem dado externo). Os textos entram já no idioma da interface.
const HUD_TEMPLATE = `
<div class="cientista-hud" id="cientista-hud" data-panel="closed">
  <div class="cientista-dust" id="cientista-dust" data-on="false" aria-hidden="true"></div>
  <div class="cientista-frame" aria-hidden="true"></div>
  <div class="cientista-markers" id="cientista-markers" aria-hidden="true"></div>

  <div class="cientista-view">
    <section class="cientista-block cientista-clock" aria-label="${t`Tempo de missão`}">
      <span class="cientista-label">${t`Tempo de saída`}</span>
      <b class="cientista-value" id="cientista-elapsed">0h00</b>
      <span class="cientista-sub"><span id="cientista-mode">${t`A pé`}</span> · ${t`hora local`} <span id="cientista-clock">09:00</span> <small>${t`sim.`}</small></span>
    </section>

    <section class="cientista-compass" aria-label="${t`Bússola`}">
      <div class="cientista-compass-window">
        <div class="cientista-tape" id="cientista-tape"></div>
        <i class="cientista-needle"></i>
        <i class="cientista-target" id="cientista-target"></i>
      </div>
      <b class="cientista-value" id="cientista-heading">000°</b>
    </section>

    <section class="cientista-block cientista-next" aria-label="${t`Destinos`}">
      <span class="cientista-label" id="cientista-next-label">${t`Próxima parada`}</span>
      <b class="cientista-value" id="cientista-next-name">–</b>
      <span class="cientista-sub" id="cientista-next-info"></span>
      <span class="cientista-row"><span>Habitat</span><b id="cientista-habitat">–</b></span>
    </section>

    <div class="cientista-alerts" id="cientista-alerts" role="group" aria-label="${t`Alertas`}"></div>
    <i class="cientista-reticle" aria-hidden="true"></i>

    <section class="cientista-block cientista-suit" aria-label="${t`Traje`}">
      <span class="cientista-label">${t`Traje`} <small>${t`simulado`}</small></span>
      <div class="cientista-meter" id="cientista-o2"><span>O₂</span><i></i><b id="cientista-o2-value">100%</b></div>
      <div class="cientista-meter" id="cientista-battery"><span>${t`Bateria`}</span><i></i><b id="cientista-battery-value">100%</b></div>
      <div class="cientista-row"><span>${t`Margem de O₂`}<span class="cientista-wide"> ${t`no fim`}</span></span><b id="cientista-margin">–</b></div>
      <div class="cientista-row cientista-extra"><span>${t`O₂ na volta`}</span><b id="cientista-o2-return">–</b></div>
      <div class="cientista-row cientista-extra" title="${t`Linha de visada calculada sobre o relevo real; as alturas de antena são hipótese da equipe`}"><span>${t`Rádio`} <small>${t`hip.`}</small></span><b id="cientista-radio">–</b></div>
    </section>

    <section class="cientista-block cientista-env" aria-label="${t`Ambiente`}">
      <span class="cientista-label">${t`Ambiente`}</span>
      <div class="cientista-row"><span>${t`Declive`} <small class="cientista-real">${t`DEM USGS`}</small></span><b id="cientista-slope">–</b></div>
      <div class="cientista-row"><span>${t`Altitude`} <small class="cientista-real">${t`DEM USGS`}</small></span><b id="cientista-altitude">–</b></div>
      <div class="cientista-row"><span>${t`Radiação`} <small>RAD</small></span><b id="cientista-radiation">–</b></div>
      <div class="cientista-row"><span>${t`Dose na saída`} <small>${t`est.`}</small></span><b id="cientista-dose">–</b></div>
      <div class="cientista-row"><span>${t`Temp. do ar`} <small>${t`est.`}</small></span><b id="cientista-temperature">–</b></div>
      <div class="cientista-row"><span>${t`Visibilidade`} <small>${t`sim.`}</small></span><b id="cientista-visibility">–</b></div>
      <div class="cientista-row"><span>${t`Relato`}</span><b id="cientista-nearest">–</b></div>
    </section>

    <section class="cientista-strip" id="cientista-strip" data-ui data-kind="assistant" aria-label="${t`Assistente de campo`}">
      <span class="cientista-label">${t`Assistente de campo`} <small>${t`simulado por regras`}</small></span>
      <p id="cientista-strip-text" role="status" aria-live="polite"></p>
      <div class="cientista-strip-actions">
        <button type="button" id="cientista-strip-mic" aria-pressed="false" hidden>${t`Falar`}</button>
        <button type="button" id="cientista-strip-open">${t`Conversar`}</button>
      </div>
    </section>
  </div>

  <aside class="cientista-panel" id="cientista-panel" data-ui aria-label="${t`Assistente de campo`}" hidden></aside>

  <div class="cientista-pop" id="cientista-pop-hazard" data-ui role="group" aria-label="${t`Tipo de perigo a relatar`}" hidden></div>
  <div class="cientista-pop" id="cientista-pop-emergency" data-ui role="group" aria-label="${t`Emergências simuladas`}" hidden></div>

  <div class="cientista-controls" data-ui role="toolbar" aria-label="${t`Controles da simulação`}">
    <button type="button" id="cientista-pause">${t`Pausar`}</button>
    <label class="cientista-speed"><span>${t`Velocidade`}</span> <select id="cientista-speed" aria-label="${t`Velocidade da simulação`}"></select></label>
    <input type="range" id="cientista-scrub" min="0" value="0" aria-label="${t`Posição na rota`}">
    <button type="button" id="cientista-hazard-btn" aria-expanded="false" aria-controls="cientista-pop-hazard">${t`Relatar perigo`}</button>
    <button type="button" id="cientista-emergency-btn" aria-expanded="false" aria-controls="cientista-pop-emergency">${t`Emergências`}</button>
    <button type="button" id="cientista-panel-btn" aria-expanded="false" aria-controls="cientista-panel">${t`Assistente`}</button>
    <button type="button" id="cientista-exit" class="cientista-primary">${t`Voltar ao tablet`}</button>
  </div>
</div>
`;

// Chave usada no código → id do elemento, sem o prefixo "cientista-".
const ELEMENT_IDS = Object.freeze({
  root: 'hud', dust: 'dust', markers: 'markers', elapsed: 'elapsed', mode: 'mode', clock: 'clock',
  tape: 'tape', targetMarker: 'target', heading: 'heading', nextLabel: 'next-label', nextName: 'next-name',
  nextInfo: 'next-info', habitat: 'habitat', alerts: 'alerts', o2: 'o2', o2Value: 'o2-value',
  battery: 'battery', batteryValue: 'battery-value', margin: 'margin', o2Return: 'o2-return', radio: 'radio',
  slope: 'slope', altitude: 'altitude', radiation: 'radiation', dose: 'dose', temperature: 'temperature',
  visibility: 'visibility', nearest: 'nearest', strip: 'strip', stripText: 'strip-text', stripMic: 'strip-mic',
  stripOpen: 'strip-open', panel: 'panel', popHazard: 'pop-hazard', popEmergency: 'pop-emergency',
  pause: 'pause', speed: 'speed', scrub: 'scrub', hazardButton: 'hazard-btn', emergencyButton: 'emergency-btn',
  panelButton: 'panel-btn', exit: 'exit',
});

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;
const levelFor = (value, limits) => (value < limits.danger ? 'danger' : value < limits.warn ? 'warn' : 'ok');

/** Só escreve o atributo data-* quando o valor muda. */
export function setData(node, key, value) {
  if (node.dataset[key] !== value) node.dataset[key] = value;
}

function setTransform(node, transform) {
  if (node.style.transform !== transform) node.style.transform = transform;
}

function setLeveled(node, text, level) {
  setText(node, text);
  setData(node, 'level', level);
}

/** Monta o HUD dentro de `mount` e devolve os elementos que mudam. */
export function createHud(mount) {
  mount.innerHTML = HUD_TEMPLATE;
  const els = Object.fromEntries(Object.entries(ELEMENT_IDS).map(([key, id]) => [key, byId(`cientista-${id}`)]));
  const { pxPerDeg, marginDeg, tickDeg } = COMPASS;
  for (let deg = -marginDeg; deg <= 360 + marginDeg; deg += tickDeg) {
    const label = CARDINALS[normalizeDeg(deg)] ?? '';
    els.tape.append(h('span', { class: label ? 'cientista-tick cientista-tick-major' : 'cientista-tick', style: `left:${(deg + marginDeg) * pxPerDeg}px` }, label));
  }
  els.speed.replaceChildren(...SIM.speeds.map((speed) => h('option', { value: String(speed) }, `${speed}×`)));
  return els;
}

function setMeter(meter, valueNode, value, limits) {
  const fill = (clamp(value, 0, 100) / 100).toFixed(3);
  if (meter.dataset.fill !== fill) {
    meter.dataset.fill = fill;
    meter.style.setProperty('--fill', fill);
  }
  setData(meter, 'level', levelFor(value, limits));
  setText(valueNode, pct(value));
}

function renderCompass(els, viewHeading, targetBearing) {
  const { pxPerDeg, marginDeg, maxTargetDeg } = COMPASS;
  setTransform(els.tape, `translateX(${(-(viewHeading + marginDeg) * pxPerDeg).toFixed(1)}px)`);
  const hideTarget = targetBearing === null;
  if (els.targetMarker.hidden !== hideTarget) els.targetMarker.hidden = hideTarget;
  if (!hideTarget) {
    const delta = angleDeltaDeg(viewHeading, targetBearing);
    const shown = clamp(delta, -maxTargetDeg, maxTargetDeg);
    setTransform(els.targetMarker, `translateX(${(shown * pxPerDeg).toFixed(1)}px)`);
    setData(els.targetMarker, 'off', String(shown !== delta));
  }
  setText(els.heading, `${String(Math.round(viewHeading) % 360).padStart(3, '0')}°`);
}

function renderTarget(els, context) {
  const { target, habitat } = context;
  setText(els.nextLabel, target.label);
  setText(els.nextName, target.name);
  const info = target.kind === 'dwell'
    ? t`em coleta · faltam ${fmtDuration(target.etaH)}`
    : `${fmtDistance(target.distM)} · ${fmtDuration(target.etaH)} · ${fmtSigned(target.gainM)} m`;
  setText(els.nextInfo, info);
  const home = habitat.distM < LIMITS.atHabitatM ? t`você está aqui` : `${fmtDistance(habitat.distM)} · ${fmtDuration(habitat.etaH)} · ${DIRECTION_LABEL[habitat.direction]}`;
  setText(els.habitat, home);
}

// Os textos mudam com a distância. A lista só é refeita quando muda quais alertas existem;
// fora isso, cada texto é atualizado no lugar.
function renderAlerts(container, alerts) {
  const key = alerts.map((alert) => `${alert.level}:${alert.key}`).join('|');
  if (container.dataset.key !== key) {
    container.dataset.key = key;
    container.replaceChildren(...alerts.map((alert) => h('p', { class: 'cientista-alert', dataset: { level: alert.level } }, alert.text)));
    return;
  }
  alerts.forEach((alert, index) => setText(container.children[index], alert.text));
}

function radioText(comms) {
  if (comms.failed) return t`falha (sim.)`;
  if (comms.lineOfSight === null) return t`sem dado`;
  return comms.lineOfSight ? t`visada direta` : t`sem visada · ${fmtDistance(comms.backInM)}`;
}

function renderSuit(els, { suit, habitat, comms, assumptions }) {
  setMeter(els.o2, els.o2Value, suit.o2Pct, LIMITS.o2);
  setMeter(els.battery, els.batteryValue, suit.batteryPct, LIMITS.battery);
  setLeveled(els.margin, fmtDuration(suit.marginH), suit.marginH < 0 ? 'danger' : suit.marginH < SIM.lowMarginH ? 'warn' : 'ok');
  const arrival = habitat.o2ArrivalPct;
  setLeveled(els.o2Return, arrival >= 0 ? t`chega com ${pct(arrival)}` : t`não cobre a volta`, arrival < 0 ? 'danger' : arrival < assumptions.o2ReservePct ? 'warn' : 'ok');
  setLeveled(els.radio, radioText(comms), comms.failed || comms.lineOfSight === false ? 'warn' : 'ok');
}

function renderEnvironment(els, { env, position, emergencies, hazards }) {
  setLeveled(els.slope, `${fmtSigned(env.slopeDeg)}°`, Math.abs(env.slopeDeg) >= SIM.slopeWarnDeg ? 'warn' : 'ok');
  setText(els.altitude, `${fmtNumber(position.elevM)} m`);
  setLeveled(els.radiation, `${fmtNumber(env.radiationUsvH)} µSv/h`, emergencies.solar ? 'danger' : 'ok');
  setText(els.dose, `${fmtNumber(env.doseUsv)} µSv`);
  setText(els.temperature, `${fmtNumber(env.airTempC)} °C`);
  setLeveled(els.visibility, emergencies.storm ? t`reduzida` : 'normal', emergencies.storm ? 'danger' : 'ok');
  const { nearest } = hazards;
  setText(els.nearest, nearest ? `${nearest.label} · ${fmtDistance(nearest.distM)}` : t`nenhum`);
}

/**
 * Atualiza todos os indicadores.
 * @param {Record<string, HTMLElement>} els
 * @param {object} context Objeto de buildContext.
 * @param {number} viewHeading Rumo para onde a câmera olha.
 * @param {number|null} targetBearing Rumo até o próximo destino.
 */
export function renderHud(els, context, viewHeading, targetBearing) {
  setText(els.elapsed, fmtDuration(context.elapsedH));
  setText(els.mode, MODE_LABEL[context.position.onFoot ? 'walk' : 'car']);
  setText(els.clock, fmtClock(context.clockH));
  renderCompass(els, viewHeading, targetBearing);
  renderTarget(els, context);
  renderAlerts(els.alerts, context.alerts);
  renderSuit(els, context);
  renderEnvironment(els, context);
  setData(els.dust, 'on', String(context.emergencies.storm));
}
