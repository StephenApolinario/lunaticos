// HUD do visor navegador: marcação fixa e a atualização dos textos.
// O DOM só é tocado quando o valor muda, para não gerar trabalho a cada quadro.

import { SIM } from '../../src/simulation.js';
import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { fmtDistance, fmtDuration, fmtNumber, fmtClock, fmtSigned } from '../../src/format.js';
import { h, setText } from '../../src/dom.js';
import { t } from '../../src/i18n.js';
import { NAV } from './leitura.js';

const COMPASS = Object.freeze({ pxPerDeg: 5, marginDeg: 60, tickDeg: 15, maxTargetDeg: 30 });
const CARDINALS = Object.freeze({ 0: 'N', 45: 'NE', 90: t('L', 'ponto cardeal'), 135: 'SE', 180: 'S', 225: t('SO', 'ponto cardeal'), 270: t('O', 'ponto cardeal'), 315: t('NO', 'ponto cardeal') });
const MODE_LABEL = Object.freeze({ foot: t`A pé`, cabin: t`Veículo` });
const METER_LEVELS = Object.freeze({ o2: { danger: 25, warn: 45 }, battery: { danger: 20, warn: 40 } });
const SLOPE_DATA_LEVEL = Object.freeze({ ok: 'ok', attention: 'attention', near: 'warn', over: 'danger' });
const RADIO_STATE = Object.freeze({
  clear: { text: t`Visada livre`, level: 'ok' },
  marginal: { text: t`Visada marginal`, level: 'warn' },
  blocked: { text: t`Sem visada`, level: 'danger' },
});
const GLYPH_TEXT = Object.freeze({ stop: '◆', alert: '!', home: 'H' });
const MAX_ALERTS = 4;
const ATTITUDE = Object.freeze({ pxPerDeg: 0.9, maxDeg: 25 });
const LEVEL_FLAT_DEG = 0.5;

// Marcação fixa do HUD (texto estático, sem dado externo). Os textos entram já no idioma da interface.
// Onde o rótulo tem versão longa e curta, cada uma é uma frase inteira (`navegador-longo` e `navegador-curto`).
const TEMPLATE = `
<div class="navegador" data-el="root" data-mode="walk">
  <canvas class="navegador-mundo" data-el="world" aria-hidden="true"></canvas>
  <div class="navegador-frame" aria-hidden="true"></div>

  <div class="navegador-view">
    <section class="navegador-bloco navegador-ritmo" aria-label="${t`Ritmo contra o plano`}">
      <span class="navegador-rotulo">${t`Tempo de saída`} · <span data-el="mode">${t`A pé`}</span></span>
      <b class="navegador-valor" data-el="elapsed">0h00</b>
      <div class="navegador-linha"><span>${t`Ritmo`} <small>${t`simulado`}</small></span><b data-el="pace">${t`no plano`}</b></div>
      <div class="navegador-linha"><span>${t`Velocidade`}</span><b data-el="speedNow">–</b></div>
      <div class="navegador-linha navegador-extra"><span>${t`Hora local`}</span><b data-el="clock">09:00</b></div>
    </section>

    <section class="navegador-bussola" aria-label="${t`Bússola`}">
      <div class="navegador-bussola-janela">
        <div class="navegador-fita" data-el="tape"></div>
        <i class="navegador-agulha"></i>
        <i class="navegador-casa" data-el="homeMarker">H</i>
        <i class="navegador-alvo" data-el="targetMarker"></i>
      </div>
      <b class="navegador-valor" data-el="heading">000°</b>
    </section>

    <section class="navegador-bloco navegador-destino" aria-label="${t`Destinos`}">
      <span class="navegador-rotulo" data-el="nextLabel">${t`Próxima parada`}</span>
      <b class="navegador-valor" data-el="nextName">–</b>
      <span class="navegador-sub"><span data-el="nextDist"></span> <span data-el="nextEta"></span> <span data-el="nextGain"></span></span>
      <div class="navegador-linha navegador-extra"><span>${t`Habitat pela rota`}</span><b data-el="home">–</b></div>
      <div class="navegador-linha"><span>${t`Retorno mais curto`}</span><b data-el="back">–</b></div>
      <div class="navegador-linha navegador-extra"><span>${t`Volta a pé`}</span><b data-el="walkBack">–</b></div>
    </section>

    <section class="navegador-bloco navegador-terreno" aria-label="${t`Leitura do terreno`}">
      <span class="navegador-rotulo">${t`Terreno`} <small data-el="terrainSource">${t`relevo real · USGS`}</small></span>
      <div class="navegador-terreno-corpo">
        <div class="navegador-atitude" aria-hidden="true"><i data-el="horizon"></i></div>
        <div class="navegador-terreno-linhas">
          <div class="navegador-linha"><span>${t`Sob os pés`}</span><b data-el="pitch">–</b></div>
          <div class="navegador-linha"><span>${t`Tombo lateral`}</span><b data-el="roll">–</b></div>
          <div class="navegador-linha"><span>${t`À frente`}</span><b data-el="ahead">–</b></div>
        </div>
      </div>
      <div class="navegador-linha"><span><span class="navegador-longo">${t`Limite de declive`}</span><span class="navegador-curto">${t`Limite`}</span></span><b data-el="limit">–</b></div>
      <div class="navegador-linha navegador-extra"><span>${t`Altitude`}</span><b data-el="altitude">–</b></div>
      <div class="navegador-linha navegador-risco"><span>${t`Risco próximo`}</span><b data-el="risk">–</b></div>
    </section>

    <div class="navegador-alertas" data-el="alerts"></div>
    <p class="visually-hidden" data-el="announce" role="status" aria-live="polite"></p>
    <i class="navegador-mira" data-el="reticle" aria-hidden="true"></i>
    <div class="navegador-pad" data-el="pad" hidden role="group" aria-label="${t`Mover na caminhada livre`}">
      <button type="button" data-pad="left" aria-label="${t`Virar à esquerda`}">◀</button>
      <button type="button" data-pad="forward" aria-label="${t`Andar para a frente`}">▲</button>
      <button type="button" data-pad="back" aria-label="${t`Andar para trás`}">▼</button>
      <button type="button" data-pad="right" aria-label="${t`Virar à direita`}">▶</button>
    </div>

    <section class="navegador-mapa" aria-label="${t`Minimapa`}">
      <canvas class="navegador-minimapa" data-el="minimap" role="img" aria-label="${t`Minimapa centrado no astronauta, girando com o rumo: rota, paradas, trajeto do Curiosity, zona de rochas cortantes, habitat e norte`}"></canvas>
      <div class="navegador-zoom">
        <button type="button" data-el="zoomOut" aria-label="${t`Afastar o minimapa`}">−</button>
        <span data-el="zoomLabel">${t`raio ${'400 m'}`}</span>
        <button type="button" data-el="zoomIn" aria-label="${t`Aproximar o minimapa`}">+</button>
      </div>
    </section>

    <section class="navegador-bloco navegador-traje" aria-label="${t`Traje e ambiente`}">
      <span class="navegador-rotulo">${t`Traje`} <small>${t`simulado`}</small><span class="navegador-longo"> · ${t`ambiente`} <small>${t`medido e estimado`}</small></span></span>
      <div class="navegador-medidor" data-el="o2Meter"><span>O₂</span><i></i><b data-el="o2">100%</b></div>
      <div class="navegador-medidor" data-el="batteryMeter"><span>${t`Bateria`}</span><i></i><b data-el="battery">100%</b></div>
      <div class="navegador-linha"><span><span class="navegador-longo">${t`Margem de O₂ no fim`}</span><span class="navegador-curto">${t`Margem de O₂`}</span></span><b data-el="margin">–</b></div>
      <div class="navegador-linha"><span>${t`Radiação`} <small>RAD</small></span><b data-el="radiation">–</b></div>
      <div class="navegador-linha"><span>${t`Dose na saída`} <small>${t`est.`}</small></span><b data-el="dose">–</b></div>
      <div class="navegador-linha"><span>${t`Temp. do ar`} <small>${t`est.`}</small></span><b data-el="temperature">–</b></div>
    </section>

    <section class="navegador-guia" aria-label="${t`Assistente de navegação`}">
      <span class="navegador-rotulo">${t`Navegador`} <small>${t`regras simuladas`}<span class="navegador-longo"> · ${t`não é IA de verdade`}</span></small></span>
      <div class="navegador-manobra" data-el="maneuver" data-level="info">
        <span class="navegador-glifo" aria-hidden="true">
          <svg data-el="arrow" viewBox="0 0 48 48"><path d="M24 5 39 27H29.5V43h-11V27H9Z"/></svg>
          <b data-el="glyph" hidden></b>
        </span>
        <b class="navegador-manobra-dist" data-el="maneuverDist"></b>
        <span class="navegador-instrucao" data-el="instruction"></span>
      </div>
      <ul class="navegador-avisos" data-el="advisories"></ul>
    </section>

    <section class="navegador-perfil" aria-label="${t`Perfil de altitude à frente`}">
      <span class="navegador-rotulo" data-el="profileCaption">${t`Perfil à frente`}</span>
      <canvas class="navegador-perfil-tela" data-el="profile" role="img" aria-label="${t`Perfil de altitude dos próximos metros da rota, com os trechos de declive forte e a cobertura de rádio`}"></canvas>
    </section>

    <section class="navegador-bloco navegador-radio" aria-label="${t`Rádio com o habitat`}">
      <span class="navegador-rotulo">${t`Rádio`}<span class="navegador-longo"> · habitat</span> <small>${t`visada calculada`}</small></span>
      <b class="navegador-valor" data-el="radioState">–</b>
      <div class="navegador-linha"><span><span class="navegador-longo">${t`Folga sobre o relevo`}</span><span class="navegador-curto">${t`Folga`}</span></span><b data-el="radioClearance">–</b></div>
      <div class="navegador-linha"><span><span class="navegador-longo">${t`Seguindo a rota`}</span><span class="navegador-curto">${t`Na rota`}</span></span><b data-el="radioNext">–</b></div>
      <div class="navegador-linha navegador-extra"><span>${t`Em linha reta`}</span><b data-el="radioDist">–</b></div>
      <span class="navegador-nota" data-el="radioNote"></span>
    </section>
  </div>

  <div class="navegador-controles" role="toolbar" aria-label="${t`Controles da simulação`}">
    <button type="button" data-el="pause">${t`Pausar`}</button>
    <label><span class="navegador-longo">${t`Velocidade`}</span> <select data-el="speed" aria-label="${t`Velocidade da simulação`}"></select></label>
    <input type="range" data-el="scrub" min="0" value="0" aria-label="${t`Posição na rota`}">
    <button type="button" data-el="free" aria-pressed="false" title="${t`Andar com W A S D ou as setas (tecla L)`}"><span class="navegador-longo">${t`Caminhada livre`}</span><span class="navegador-curto">${t`livre`}</span></button>
    <button type="button" data-el="voice" aria-pressed="false" title="${t`Voz do assistente (tecla V)`}">${t`Voz`}</button>
    <button type="button" data-el="solar" aria-pressed="false"><span class="navegador-longo">${t`Simular evento solar`}</span><span class="navegador-curto">${t`solar`}</span></button>
    <button type="button" data-el="exit" class="navegador-primario"><span class="navegador-longo">${t`Voltar ao tablet`}</span><span class="navegador-curto">${t`Sair`}</span></button>
  </div>
</div>
`;

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;
const levelFor = (value, limits) => (value < limits.danger ? 'danger' : value < limits.warn ? 'warn' : 'ok');

function setData(node, key, value) {
  if (node.dataset[key] !== value) node.dataset[key] = value;
}

function setHidden(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

function buildCompassTape(tape) {
  const { pxPerDeg, marginDeg, tickDeg } = COMPASS;
  for (let deg = -marginDeg; deg <= 360 + marginDeg; deg += tickDeg) {
    const label = CARDINALS[normalizeDeg(deg)] ?? '';
    tape.append(h('span', { class: label ? 'navegador-tique navegador-tique-maior' : 'navegador-tique', style: `left:${(deg + marginDeg) * pxPerDeg}px` }, label));
  }
}

// Marcador sobre a fita da bússola: preso à borda (e vazado) quando o alvo está fora da janela.
function placeMarker(marker, viewHeading, bearing) {
  setHidden(marker, bearing === null);
  if (bearing === null) return;
  const delta = angleDeltaDeg(viewHeading, bearing);
  const shown = clamp(delta, -COMPASS.maxTargetDeg, COMPASS.maxTargetDeg);
  marker.style.translate = `${shown * COMPASS.pxPerDeg}px 0`;
  setData(marker, 'off', String(shown !== delta));
}

function renderCompass(els, viewHeading, readout) {
  els.tape.style.transform = `translateX(${-(viewHeading + COMPASS.marginDeg) * COMPASS.pxPerDeg}px)`;
  placeMarker(els.targetMarker, viewHeading, readout.targetBearing);
  placeMarker(els.homeMarker, viewHeading, readout.homeBearing);
  setText(els.heading, `${String(Math.round(viewHeading) % 360).padStart(3, '0')}°`);
}

function renderPace(els, readout, state) {
  const mode = readout.here.onFoot ? MODE_LABEL.foot : MODE_LABEL.cabin;
  setText(els.mode, state.free ? t`${mode} · livre` : mode);
  setText(els.elapsed, fmtDuration(readout.elapsedH));
  setText(els.pace, readout.pace.text);
  setData(els.pace, 'level', readout.pace.level);
  let speed = `${fmtNumber(readout.movingKmh, 1)} km/h`;
  if (state.finished) speed = t`no habitat`;
  else if (state.paused) speed = t`pausado`;
  else if (state.dwellRemainingH > 0) speed = t`em coleta`;
  setText(els.speedNow, speed);
  setText(els.clock, fmtClock(readout.clockH));
}

// Volta a pé direta ao habitat: pelo roteador quando o contexto traz, senão pelo ponto sem volta do plano.
function walkBackText({ walkBack, noReturn }) {
  if (walkBack?.noRoute) return t`sem caminho a pé`;
  if (walkBack) {
    const oxygen = walkBack.covered ? t`sobra ${fmtNumber(walkBack.o2AfterPct)}% de O₂` : t`O₂ não cobre`;
    return `${fmtDuration(walkBack.walkH)} · ${oxygen}`;
  }
  if (!noReturn) return t`coberta neste plano`;
  return noReturn.passed ? t`sem volta há ${fmtDistance(-noReturn.aheadM)}` : t`sem volta em ${fmtDistance(noReturn.aheadM)}`;
}

function renderDestination(els, readout) {
  const { target, home, back } = readout;
  setText(els.nextLabel, target.label);
  setText(els.nextName, target.name);
  if (target.kind === 'dwell') {
    setText(els.nextDist, t`coleta em andamento`);
    setText(els.nextEta, t`faltam ${fmtDuration(target.etaH)}`);
    setText(els.nextGain, '');
  } else {
    setText(els.nextDist, fmtDistance(target.distM));
    setText(els.nextEta, t`chegada em ${fmtDuration(target.etaH)}`);
    setText(els.nextGain, `${fmtSigned(target.gainM)} m`);
  }
  setText(els.home, `${fmtDistance(home.distM)} · ${fmtDuration(home.timeH)}`);
  setText(els.back, `${fmtDistance(back.distM)} · ${fmtDuration(back.timeH)} · ${back.via === 'back' ? t`pela ida` : t`em frente`}`);
  setText(els.walkBack, walkBackText(readout));
  setData(els.walkBack, 'level', readout.stranded ? 'warn' : 'ok');
}

function renderTerrain(els, readout) {
  const { terrain, here, risk } = readout;
  const pitch = clamp(terrain.pitchDeg, -ATTITUDE.maxDeg, ATTITUDE.maxDeg);
  const roll = clamp(terrain.rollDeg, -ATTITUDE.maxDeg, ATTITUDE.maxDeg);
  // A linha é o chão visto de frente: sobe quando o terreno sobe, gira para o lado em que ele cai.
  els.horizon.style.transform = `translateY(${(-pitch * ATTITUDE.pxPerDeg).toFixed(1)}px) rotate(${roll.toFixed(1)}deg)`;

  setText(els.pitch, `${fmtSigned(terrain.pitchDeg)}°`);
  setData(els.pitch, 'level', SLOPE_DATA_LEVEL[terrain.level]);
  const rollAbs = Math.abs(terrain.rollDeg);
  let rollText = terrain.rollDeg > 0 ? t`${fmtNumber(rollAbs)}° à dir.` : t`${fmtNumber(rollAbs)}° à esq.`;
  if (rollAbs < LEVEL_FLAT_DEG) rollText = t`nivelado`;
  setText(els.roll, rollText);
  setData(els.roll, 'level', SLOPE_DATA_LEVEL[terrain.rollLevel]);
  const aheadDeg = fmtSigned(terrain.aheadDeg);
  setText(els.ahead, terrain.aheadInM >= 10 ? t`${aheadDeg}° em ${fmtDistance(terrain.aheadInM)}` : `${aheadDeg}°`);
  setData(els.ahead, 'level', SLOPE_DATA_LEVEL[terrain.aheadLevel]);

  setText(els.limit, here.onFoot ? t`${terrain.limitDeg}° a pé` : t`${terrain.limitDeg}° de veículo`);
  setText(els.altitude, `${fmtNumber(readout.elevM)} m`);
  setText(els.risk, risk.text);
  setData(els.risk, 'level', risk.level);
}

function setMeter(meter, valueNode, pct, limits) {
  const fill = (pct / 100).toFixed(3);
  if (meter.style.getPropertyValue('--fill') !== fill) meter.style.setProperty('--fill', fill);
  setData(meter, 'level', levelFor(pct, limits));
  setText(valueNode, `${fmtNumber(pct)}%`);
}

function renderSuit(els, readout) {
  const { suit } = readout;
  setMeter(els.o2Meter, els.o2, suit.o2Pct, METER_LEVELS.o2);
  setMeter(els.batteryMeter, els.battery, suit.batteryPct, METER_LEVELS.battery);
  setText(els.margin, fmtDuration(suit.marginH));
  let marginLevel = 'ok';
  if (suit.marginH < 0) marginLevel = 'danger';
  else if (suit.marginH < SIM.lowMarginH) marginLevel = 'warn';
  setData(els.margin, 'level', marginLevel);
  setText(els.radiation, `${fmtNumber(readout.radiationRate)} µSv/h`);
  setText(els.dose, `${fmtNumber(readout.doseUsv)} µSv`);
  setText(els.temperature, `${fmtNumber(readout.airTempC)} °C`);
}

function renderRadio(els, readout) {
  const { radio } = readout;
  const status = RADIO_STATE[radio.status];
  setText(els.radioState, status.text);
  setData(els.radioState, 'level', status.level);
  let clearance = '–';
  if (Number.isFinite(radio.clearanceM)) {
    clearance = radio.visible ? `${fmtSigned(radio.clearanceM)} m` : t`${fmtSigned(radio.clearanceM)} m a ${fmtDistance(radio.blockAtM)}`;
  }
  setText(els.radioClearance, clearance);
  let next = t`sem mudança até o fim`;
  if (radio.route.changeInM !== null) {
    const changeIn = fmtDistance(radio.route.changeInM);
    next = t`volta em ${changeIn}`;
    // Um corte de menos de 40 m não é a perda do alerta: aparece com outro nome.
    if (radio.route.visible) next = radio.route.nextLengthM < NAV.radioMinGapM ? t`corte curto em ${changeIn}` : t`cai em ${changeIn}`;
  }
  setText(els.radioNext, next);
  setData(els.radioNext, 'level', radio.lossSoon ? 'warn' : 'ok');
  setText(els.radioDist, fmtDistance(radio.distM));
}

function renderGuidance(els, guidance) {
  const { primary, advisories } = guidance;
  setData(els.maneuver, 'level', primary.level);
  const isArrow = primary.glyph === 'arrow';
  setHidden(els.arrow, !isArrow);
  setHidden(els.glyph, isArrow);
  if (isArrow) els.arrow.style.transform = `rotate(${Math.round(clamp(primary.turnDeg, -170, 180))}deg)`;
  else setText(els.glyph, GLYPH_TEXT[primary.glyph] ?? '');
  setText(els.maneuverDist, primary.distM === null ? '' : fmtDistance(primary.distM));
  setText(els.instruction, primary.text);

  const key = advisories.map((item) => `${item.level}:${item.text}`).join('|');
  if (els.advisories.dataset.key !== key) {
    els.advisories.dataset.key = key;
    els.advisories.replaceChildren(...advisories.map((item) => h('li', { dataset: { level: item.level } }, item.text)));
  }
}

// Os alertas visíveis mudam a cada metro (têm distância no texto). O leitor de tela só é
// avisado quando um tipo de alerta aparece ou some, senão falaria sem parar.
function renderAlerts(els, alerts) {
  const shown = alerts.slice(0, MAX_ALERTS);
  const key = shown.map((alert) => `${alert.level}:${alert.text}`).join('|');
  if (els.alerts.dataset.key !== key) {
    els.alerts.dataset.key = key;
    els.alerts.replaceChildren(...shown.map((alert) => h('p', { class: 'navegador-alerta', dataset: { level: alert.level } }, alert.text)));
  }
  const kinds = shown.map((alert) => alert.kind).join('|');
  if (els.announce.dataset.kinds !== kinds) {
    els.announce.dataset.kinds = kinds;
    els.announce.textContent = shown.map((alert) => alert.text).join('. ');
  }
}

/**
 * Monta o HUD dentro de `mount`.
 * @param {HTMLElement} mount
 * @param {{ isReal: boolean }} terrain
 * @param {{ suit: number, habitat: number }} antenna Alturas de antena presumidas, em metros.
 */
export function createHud(mount, terrain, antenna) {
  mount.innerHTML = TEMPLATE;
  const els = Object.fromEntries([...mount.querySelectorAll('[data-el]')].map((node) => [node.dataset.el, node]));
  buildCompassTape(els.tape);
  setText(els.terrainSource, terrain.isReal ? t`relevo real · USGS` : t`relevo aproximado`);
  setText(els.radioNote, terrain.isReal
    ? t`Geometria sobre o relevo real. Antenas presumidas (hipótese da equipe): traje ${antenna.suit} m, mastro do habitat ${antenna.habitat} m. Sem difração nem relé.`
    : t`Geometria sobre o relevo aproximado. Antenas presumidas (hipótese da equipe): traje ${antenna.suit} m, mastro do habitat ${antenna.habitat} m. Sem difração nem relé.`);

  /**
   * @param {object} readout Resultado de `deriveReadout`.
   * @param {object} guidance Resultado de `buildGuidance`.
   * @param {object} state Estado de `sim.js`.
   * @param {number} viewHeading Rumo para onde a câmera olha.
   */
  function render(readout, guidance, state, viewHeading) {
    setData(els.root, 'mode', readout.here.onFoot ? 'walk' : 'car');
    renderPace(els, readout, state);
    renderCompass(els, viewHeading, readout);
    renderDestination(els, readout);
    renderTerrain(els, readout);
    renderAlerts(els, readout.alerts);
    renderSuit(els, readout);
    renderRadio(els, readout);
    renderGuidance(els, guidance);
  }

  return Object.freeze({ els, render });
}
