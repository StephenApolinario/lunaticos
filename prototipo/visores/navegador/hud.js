// HUD do visor navegador: marcação fixa e a atualização dos textos.
// O DOM só é tocado quando o valor muda, para não gerar trabalho a cada quadro.

import { SIM } from '../../src/simulation.js';
import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { fmtDistance, fmtDuration, fmtNumber, fmtClock, fmtSigned } from '../../src/format.js';
import { h, setText } from '../../src/dom.js';
import { NAV } from './leitura.js';

const COMPASS = Object.freeze({ pxPerDeg: 5, marginDeg: 60, tickDeg: 15, maxTargetDeg: 30 });
const CARDINALS = Object.freeze({ 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' });
const MODE_LABEL = Object.freeze({ foot: 'A pé', cabin: 'Veículo' });
const METER_LEVELS = Object.freeze({ o2: { danger: 25, warn: 45 }, battery: { danger: 20, warn: 40 } });
const SLOPE_DATA_LEVEL = Object.freeze({ ok: 'ok', attention: 'attention', near: 'warn', over: 'danger' });
const RADIO_STATE = Object.freeze({
  clear: { text: 'Visada livre', level: 'ok' },
  marginal: { text: 'Visada marginal', level: 'warn' },
  blocked: { text: 'Sem visada', level: 'danger' },
});
const GLYPH_TEXT = Object.freeze({ stop: '◆', alert: '!', home: 'H' });
const MAX_ALERTS = 4;
const ATTITUDE = Object.freeze({ pxPerDeg: 0.9, maxDeg: 25 });
const LEVEL_FLAT_DEG = 0.5;

// Marcação fixa do HUD (texto estático, sem dado externo).
const TEMPLATE = `
<div class="navegador" data-el="root" data-mode="walk">
  <canvas class="navegador-mundo" data-el="world" aria-hidden="true"></canvas>
  <div class="navegador-frame" aria-hidden="true"></div>

  <div class="navegador-view">
    <section class="navegador-bloco navegador-ritmo" aria-label="Ritmo contra o plano">
      <span class="navegador-rotulo">Tempo de saída · <span data-el="mode">A pé</span></span>
      <b class="navegador-valor" data-el="elapsed">0h00</b>
      <div class="navegador-linha"><span>Ritmo <small>simulado</small></span><b data-el="pace">no plano</b></div>
      <div class="navegador-linha"><span>Velocidade</span><b data-el="speedNow">–</b></div>
      <div class="navegador-linha navegador-extra"><span>Hora local</span><b data-el="clock">09:00</b></div>
    </section>

    <section class="navegador-bussola" aria-label="Bússola">
      <div class="navegador-bussola-janela">
        <div class="navegador-fita" data-el="tape"></div>
        <i class="navegador-agulha"></i>
        <i class="navegador-casa" data-el="homeMarker">H</i>
        <i class="navegador-alvo" data-el="targetMarker"></i>
      </div>
      <b class="navegador-valor" data-el="heading">000°</b>
    </section>

    <section class="navegador-bloco navegador-destino" aria-label="Destinos">
      <span class="navegador-rotulo" data-el="nextLabel">Próxima parada</span>
      <b class="navegador-valor" data-el="nextName">–</b>
      <span class="navegador-sub"><span data-el="nextDist"></span> <span data-el="nextEta"></span> <span data-el="nextGain"></span></span>
      <div class="navegador-linha navegador-extra"><span>Habitat pela rota</span><b data-el="home">–</b></div>
      <div class="navegador-linha"><span>Retorno mais curto</span><b data-el="back">–</b></div>
      <div class="navegador-linha navegador-extra"><span>Volta a pé</span><b data-el="walkBack">–</b></div>
    </section>

    <section class="navegador-bloco navegador-terreno" aria-label="Leitura do terreno">
      <span class="navegador-rotulo">Terreno <small data-el="terrainSource">relevo real · USGS</small></span>
      <div class="navegador-terreno-corpo">
        <div class="navegador-atitude" aria-hidden="true"><i data-el="horizon"></i></div>
        <div class="navegador-terreno-linhas">
          <div class="navegador-linha"><span>Sob os pés</span><b data-el="pitch">–</b></div>
          <div class="navegador-linha"><span>Tombo lateral</span><b data-el="roll">–</b></div>
          <div class="navegador-linha"><span>À frente</span><b data-el="ahead">–</b></div>
        </div>
      </div>
      <div class="navegador-linha"><span>Limite<span class="navegador-longo"> de declive</span></span><b data-el="limit">–</b></div>
      <div class="navegador-linha navegador-extra"><span>Altitude</span><b data-el="altitude">–</b></div>
      <div class="navegador-linha navegador-risco"><span>Risco próximo</span><b data-el="risk">–</b></div>
    </section>

    <div class="navegador-alertas" data-el="alerts"></div>
    <p class="visually-hidden" data-el="announce" role="status" aria-live="polite"></p>
    <i class="navegador-mira" data-el="reticle" aria-hidden="true"></i>
    <div class="navegador-pad" data-el="pad" hidden role="group" aria-label="Mover na caminhada livre">
      <button type="button" data-pad="left" aria-label="Virar à esquerda">◀</button>
      <button type="button" data-pad="forward" aria-label="Andar para a frente">▲</button>
      <button type="button" data-pad="back" aria-label="Andar para trás">▼</button>
      <button type="button" data-pad="right" aria-label="Virar à direita">▶</button>
    </div>

    <section class="navegador-mapa" aria-label="Minimapa">
      <canvas class="navegador-minimapa" data-el="minimap" role="img" aria-label="Minimapa centrado no astronauta, girando com o rumo: rota, paradas, trajeto do Curiosity, zona de rochas cortantes, habitat e norte"></canvas>
      <div class="navegador-zoom">
        <button type="button" data-el="zoomOut" aria-label="Afastar o minimapa">−</button>
        <span data-el="zoomLabel">raio 400 m</span>
        <button type="button" data-el="zoomIn" aria-label="Aproximar o minimapa">+</button>
      </div>
    </section>

    <section class="navegador-bloco navegador-traje" aria-label="Traje e ambiente">
      <span class="navegador-rotulo">Traje<span class="navegador-longo"> e ambiente</span> <small>simulado</small></span>
      <div class="navegador-medidor" data-el="o2Meter"><span>O₂</span><i></i><b data-el="o2">100%</b></div>
      <div class="navegador-medidor" data-el="batteryMeter"><span>Bateria</span><i></i><b data-el="battery">100%</b></div>
      <div class="navegador-linha"><span>Margem de O₂<span class="navegador-longo"> no fim</span></span><b data-el="margin">–</b></div>
      <div class="navegador-linha"><span>Radiação</span><b data-el="radiation">–</b></div>
      <div class="navegador-linha"><span>Dose na saída</span><b data-el="dose">–</b></div>
      <div class="navegador-linha"><span>Temp. do ar</span><b data-el="temperature">–</b></div>
    </section>

    <section class="navegador-guia" aria-label="Assistente de navegação">
      <span class="navegador-rotulo">Navegador <small>regras simuladas<span class="navegador-longo"> · não é IA de verdade</span></small></span>
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

    <section class="navegador-perfil" aria-label="Perfil de altitude à frente">
      <span class="navegador-rotulo" data-el="profileCaption">Perfil à frente</span>
      <canvas class="navegador-perfil-tela" data-el="profile" role="img" aria-label="Perfil de altitude dos próximos metros da rota, com os trechos de declive forte e a cobertura de rádio"></canvas>
    </section>

    <section class="navegador-bloco navegador-radio" aria-label="Rádio com o habitat">
      <span class="navegador-rotulo">Rádio<span class="navegador-longo"> · habitat</span> <small>visada calculada</small></span>
      <b class="navegador-valor" data-el="radioState">–</b>
      <div class="navegador-linha"><span>Folga<span class="navegador-longo"> sobre o relevo</span></span><b data-el="radioClearance">–</b></div>
      <div class="navegador-linha"><span><span class="navegador-longo">Seguindo a rota</span><span class="navegador-curto">Na rota</span></span><b data-el="radioNext">–</b></div>
      <div class="navegador-linha navegador-extra"><span>Em linha reta</span><b data-el="radioDist">–</b></div>
      <span class="navegador-nota" data-el="radioNote"></span>
    </section>
  </div>

  <div class="navegador-controles" role="toolbar" aria-label="Controles da simulação">
    <button type="button" data-el="pause">Pausar</button>
    <label><span class="navegador-longo">Velocidade</span> <select data-el="speed" aria-label="Velocidade da simulação"></select></label>
    <input type="range" data-el="scrub" min="0" value="0" aria-label="Posição na rota">
    <button type="button" data-el="free" aria-pressed="false" title="Andar com W A S D ou as setas (tecla L)"><span class="navegador-longo">Caminhada </span>livre</button>
    <button type="button" data-el="voice" aria-pressed="false" title="Voz do assistente (tecla V)">Voz</button>
    <button type="button" data-el="solar" aria-pressed="false"><span class="navegador-longo">Simular evento </span>solar</button>
    <button type="button" data-el="exit" class="navegador-primario"><span class="navegador-longo">Voltar ao tablet</span><span class="navegador-curto">Sair</span></button>
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
  setText(els.mode, state.free ? `${mode} · livre` : mode);
  setText(els.elapsed, fmtDuration(readout.elapsedH));
  setText(els.pace, readout.pace.text);
  setData(els.pace, 'level', readout.pace.level);
  let speed = `${fmtNumber(readout.movingKmh, 1)} km/h`;
  if (state.finished) speed = 'no habitat';
  else if (state.paused) speed = 'pausado';
  else if (state.dwellRemainingH > 0) speed = 'em coleta';
  setText(els.speedNow, speed);
  setText(els.clock, fmtClock(readout.clockH));
}

// Volta a pé direta ao habitat: pelo roteador quando o contexto traz, senão pelo ponto sem volta do plano.
function walkBackText({ walkBack, noReturn }) {
  if (walkBack?.noRoute) return 'sem caminho a pé';
  if (walkBack) {
    const oxygen = walkBack.covered ? `sobra ${fmtNumber(walkBack.o2AfterPct)}% de O₂` : 'O₂ não cobre';
    return `${fmtDuration(walkBack.walkH)} · ${oxygen}`;
  }
  if (!noReturn) return 'coberta neste plano';
  return noReturn.passed ? `sem volta há ${fmtDistance(-noReturn.aheadM)}` : `sem volta em ${fmtDistance(noReturn.aheadM)}`;
}

function renderDestination(els, readout) {
  const { target, home, back } = readout;
  setText(els.nextLabel, target.label);
  setText(els.nextName, target.name);
  if (target.kind === 'dwell') {
    setText(els.nextDist, 'coleta em andamento');
    setText(els.nextEta, `faltam ${fmtDuration(target.etaH)}`);
    setText(els.nextGain, '');
  } else {
    setText(els.nextDist, fmtDistance(target.distM));
    setText(els.nextEta, `chegada em ${fmtDuration(target.etaH)}`);
    setText(els.nextGain, `${fmtSigned(target.gainM)} m`);
  }
  setText(els.home, `${fmtDistance(home.distM)} · ${fmtDuration(home.timeH)}`);
  setText(els.back, `${fmtDistance(back.distM)} · ${fmtDuration(back.timeH)} · ${back.via === 'back' ? 'pela ida' : 'em frente'}`);
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
  setText(els.roll, rollAbs < LEVEL_FLAT_DEG ? 'nivelado' : `${fmtNumber(rollAbs)}° ${terrain.rollDeg > 0 ? 'à dir.' : 'à esq.'}`);
  setData(els.roll, 'level', SLOPE_DATA_LEVEL[terrain.rollLevel]);
  const where = terrain.aheadInM >= 10 ? ` em ${fmtDistance(terrain.aheadInM)}` : '';
  setText(els.ahead, `${fmtSigned(terrain.aheadDeg)}°${where}`);
  setData(els.ahead, 'level', SLOPE_DATA_LEVEL[terrain.aheadLevel]);

  setText(els.limit, `${terrain.limitDeg}° ${here.onFoot ? 'a pé' : 'de veículo'}`);
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
    clearance = radio.visible ? `${fmtSigned(radio.clearanceM)} m` : `${fmtSigned(radio.clearanceM)} m a ${fmtDistance(radio.blockAtM)}`;
  }
  setText(els.radioClearance, clearance);
  let next = 'sem mudança até o fim';
  if (radio.route.changeInM !== null) {
    let what = 'volta';
    // Um corte de menos de 40 m não é a perda do alerta: aparece com outro nome.
    if (radio.route.visible) what = radio.route.nextLengthM < NAV.radioMinGapM ? 'corte curto' : 'cai';
    next = `${what} em ${fmtDistance(radio.route.changeInM)}`;
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
  setText(els.terrainSource, terrain.isReal ? 'relevo real · USGS' : 'relevo aproximado');
  const relief = terrain.isReal ? 'relevo real' : 'relevo aproximado';
  setText(els.radioNote, `Geometria sobre o ${relief}. Antenas presumidas (hipótese da equipe): traje ${antenna.suit} m, mastro do habitat ${antenna.habitat} m. Sem difração nem relé.`);

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
