// Globo de Marte: a tela de abertura do tablet. O planeta inteiro aparece escurecido, menos a área
// mapeada; aproximar sobre ela (ou clicar no marcador, ou dar duplo clique perto) leva ao modelo local.
// A fonte da imagem está em globo-camadas.js. O marcador e o brilho da borda são ilustrativos.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLORS } from './config.js';
import { MARS_RADIUS_M, angleDeltaDeg, clamp, lerp } from './geo.js';
import {
  DEG, sphereFromGeo, geoFromSphere, areaCenter, angleBetween, levelForView, groundAngle,
  dot, poseFromView, projectPoint, surfaceUnder,
} from './globo-geo.js';
import { GLOBE_SOURCE, createImagery } from './globo-camadas.js';
import { createGlobePainter } from './globo-desenho.js';
import { createMarker } from './globo-marcador.js';

export { GLOBE_SOURCE };

/**
 * Vista geográfica, a mesma para o globo e para o modelo local.
 * @typedef {{
 *   lat: number, lon: number,   // ponto da superfície para onde a câmera olha, em graus
 *   distanceM: number,          // da câmera até esse ponto, em metros
 *   headingDeg: number,         // 0 = norte para cima na tela, sentido horário
 *   tiltDeg: number,            // 0 = olhando reto para baixo
 * }} GlobeView
 */

/**
 * Distância da câmera ao ponto olhado em que a aproximação sobre a área mapeada vira entrada no
 * modelo local. É também o mais perto que a câmera do globo chega, e onde o voo termina.
 */
export const ENTER_DISTANCE_M = 16000;

// O mesmo campo de visão do mapa do tablet, para a passagem ao modelo local não mudar a perspectiva.
const FOV_DEG = 40;
const TAN_HALF_FOV = Math.tan((FOV_DEG * DEG) / 2);
// Sombra de 75%: tudo fora da área mapeada aparece com um quarto do brilho.
const OUTSIDE_BRIGHTNESS = 0.25;
const DEFAULT_QUALITY = 'media';
const VIEW = Object.freeze({
  // Folga para reconhecer que a câmera encostou na distância de entrada (os controles param nela).
  enterToleranceM: 0.001,
  // A entrada vale com o centro da área até esta fração do caminho entre o meio e a borda da tela.
  enterScreenShare: 0.85,
  // Distância em que o globo reabre na volta do modelo local quando ninguém diz a vista.
  returnDistanceM: 900000,
  // Na abertura o planeta ocupa esta fração da tela, e dá para afastar até este múltiplo da distância de abertura.
  fitFill: 0.8,
  zoomOutFactor: 1.25,
  // Rumo e inclinação trazidos por `setView` somem até a câmera se afastar este múltiplo da distância em que chegaram.
  levelOutFactor: 6,
  maxTiltDeg: 89,
  // Só na área mapeada dá para descer até o chão. Em volta dela a câmera para a esta altura por
  // metro de chão que falta até a área: com 3,5 a área ainda aparece na tela quando a câmera
  // encosta no limite.
  floorPerMeterAway: 3.5,
  // No resto do planeta o zoom para aqui: mais perto, a imagem de 232 m por pixel vira borrão.
  farFloorM: 250000,
});
// A vista de abertura olha um pouco ao lado da área, para o marcador não nascer no meio da tela.
const HOME = Object.freeze({ latOffsetDeg: 12, lonOffsetDeg: -16 });
// Voo até a área: primeiro gira, depois desce. Num trajeto longo a câmera sobe um pouco no meio.
const FLIGHT = Object.freeze({ durationS: 3.2, turnShare: 0.55, hopPerRad: 0.5, fullAngleRad: 1, fullZoomLog: 3, minShare: 0.25 });
const CONTROLS = Object.freeze({ zoomSpeed: 5, maxRotateSpeed: 0.45, damping: 0.08 });
const LEVEL = Object.freeze({ headingDeg: 0, tiltDeg: 0, fromDistanceM: ENTER_DISTANCE_M });
// Movimento da câmera menor que esta fração da altitude (cerca de um décimo de pixel) não pede quadro novo.
const MOVE_EPS = 5e-5;
// De quanto em quanto tempo, com a câmera parada, confere se há imagem a pedir de novo.
const IMAGERY_CHECK_MS = 1000;
// O ponto sob o cursor é reposto em duas passadas: o norte para cima desvia um pouco a primeira.
const ANCHOR_PASSES = 2;
const DOUBLE_CLICK_RADIUS_PX = 96;
// Folga do anel do marcador em volta da área, e o tamanho dela na tela a partir do qual o marcador sai.
const RING_FILL = 1.6;
const MARKER_MAX_AREA_PX = 140;
const TOUCH_EVENTS = Object.freeze(['pointerdown', 'pointermove', 'pointerup', 'pointercancel']);
const GESTURE_FIRST = Object.freeze({ capture: true, passive: true });
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

function checkOptions({ renderer, container, area, label, onEnter }) {
  if (!renderer?.isWebGLRenderer) throw new Error('Globo: falta o renderizador WebGL.');
  if (!(container instanceof HTMLElement)) throw new Error('Globo: falta o elemento que contém o canvas.');
  const sides = [area?.south, area?.north, area?.west, area?.east];
  if (!sides.every(Number.isFinite) || area.south >= area.north || area.west >= area.east) {
    throw new Error('Globo: a área mapeada precisa de sul < norte e oeste < leste, em graus.');
  }
  if (typeof label !== 'string' || typeof onEnter !== 'function') throw new Error('Globo: faltam o nome da área e a função de entrada.');
}

/**
 * Globo de Marte com a área mapeada em destaque. Tem câmera e controles próprios e desenha no
 * renderizador recebido sem mudar a configuração dele.
 * @param {{
 *   renderer: THREE.WebGLRenderer,
 *   container: HTMLElement,          // tamanho da tela e onde entra o marcador; os gestos são ouvidos no canvas
 *   area: { south: number, north: number, west: number, east: number },
 *   label: string,
 *   onEnter: (view: GlobeView) => void,  // o usuário entrou na área mapeada; a vista é a do instante da entrada
 *   quality?: 'minima' | 'media' | 'alta',
 *   onStatus?: (status: 'loading' | 'ready' | 'partial' | 'failed') => void,  // imagem do planeta inteiro
 * }} options
 * @returns {{
 *   show(): void, hide(): void, isActive(): boolean,
 *   render(dtS: number): void, resize(): void, flyToArea(): void,
 *   setQuality(quality: 'minima' | 'media' | 'alta'): void, dispose(): void,
 *   getView(): GlobeView, setView(view: GlobeView): void,
 *   invalidate(): void,              // força o próximo quadro a ser desenhado
 * }}
 */
export function createGlobe(options) {
  checkOptions(options);
  const { renderer, container, area, label, onEnter, quality = DEFAULT_QUALITY, onStatus = () => {} } = options;
  const center = areaCenter(area);
  const areaPoint = sphereFromGeo(center.lat, center.lon);
  const areaUp = [areaPoint.x, areaPoint.y, areaPoint.z];
  const areaPointM = areaUp.map((value) => value * MARS_RADIUS_M);
  const areaSpanM = angleBetween({ lat: area.south, lon: area.west }, { lat: area.north, lon: area.east }) * MARS_RADIUS_M;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Os gestos são ouvidos no canvas, como no mapa local: os controles capturam o ponteiro, e no
  // container isso engoliria o clique dos botões que ficam por cima do globo.
  const surface = renderer.domElement;

  // Os controles giram esta câmera em volta do centro do planeta (raio 1). Ela nunca desenha: só
  // guarda o ponto olhado e a distância até ele.
  const rig = new THREE.PerspectiveCamera();
  const painter = createGlobePainter({ area, shade: OUTSIDE_BRIGHTNESS, background: COLORS.tabletBackground, hazeTint: COLORS.haze });
  const marker = createMarker(container, {
    label,
    onActivate: () => flyToArea(),
    // A roda sobre o marcador aproxima da própria área, que é para onde ele aponta, e segue para os controles.
    onWheel: (event) => {
      anchorZoom({ x: (areaAt.x / size.width) * 2 - 1, y: 1 - (areaAt.y / size.height) * 2 });
      surface.dispatchEvent(new WheelEvent('wheel', event));
    },
  });

  let active = false;
  let dirty = true;
  let posed = false;
  // A entrada vale quando a câmera cruza o limite vindo de fora; depois dela, só recuando e voltando.
  let armed = false;
  let pendingReturn = false;
  let flight = null;
  let controls = null;
  let idleTouchAction = '';
  let size = Object.freeze({ width: 1, height: 1 });
  let aspect = 1;
  let maxDistance = Infinity;
  let carried = LEVEL;
  // Ponto da tela e ponto do chão que o zoom em andamento tem de manter juntos.
  let zoomAnchor = null;
  let imageryDueMs = 0;
  let areaAt = Object.freeze({ x: 0, y: 0, ringPx: 0, onScreen: false, inReach: false });
  let imagery = null;
  const touches = new Map();
  const areaDirection = new THREE.Vector3(...areaUp);
  const drawnPosition = new THREE.Vector3(Infinity, 0, 0);
  const turn = new THREE.Quaternion();
  const fromPoint = new THREE.Vector3();
  const toPoint = new THREE.Vector3();

  function placeRig(lat, lon, distanceM) {
    rig.position.copy(sphereFromGeo(lat, lon)).multiplyScalar(1 + distanceM / MARS_RADIUS_M);
    rig.lookAt(0, 0, 0);
  }

  /** @returns {GlobeView} */
  function getView() {
    const { lat, lon } = geoFromSphere(rig.position.x, rig.position.y, rig.position.z);
    const distanceM = (rig.position.length() - 1) * MARS_RADIUS_M;
    // Rumo e inclinação valem inteiros até a distância em que chegaram e somem conforme a câmera se afasta.
    const t = clamp((distanceM / carried.fromDistanceM - 1) / (VIEW.levelOutFactor - 1), 0, 1);
    const share = 1 - t * t * (3 - 2 * t);
    return { lat, lon, distanceM, headingDeg: carried.headingDeg * share, tiltDeg: carried.tiltDeg * share };
  }

  /** Põe a câmera do globo numa vista, por exemplo a do modelo local na hora em que o usuário se afasta dele. */
  function setView(view) {
    if (![view?.lat, view?.lon, view?.distanceM].every(Number.isFinite) || view.distanceM <= 0) {
      throw new Error('Globo: a vista precisa de lat, lon e distanceM (maior que zero).');
    }
    const distanceM = Math.max(view.distanceM, ENTER_DISTANCE_M);
    flight = null;
    placeRig(view.lat, view.lon, distanceM);
    carried = Object.freeze({
      headingDeg: angleDeltaDeg(0, view.headingDeg ?? 0),
      tiltDeg: clamp(view.tiltDeg ?? 0, 0, VIEW.maxTiltDeg),
      fromDistanceM: distanceM,
    });
    armed = distanceM > ENTER_DISTANCE_M + VIEW.enterToleranceM;
    pendingReturn = false;
    posed = true;
    dirty = true;
    if (active) connectControls();
  }

  // O que a vista pede de imagem: o nível de detalhe e até onde o chão aparece em volta do ponto sob a câmera.
  function requestImagery(nowMs, view, pose) {
    const cornerRad = Math.atan(TAN_HALF_FOV * Math.hypot(1, aspect)) + view.tiltDeg * DEG;
    imagery.request(nowMs, {
      neededLevel: levelForView(view.distanceM / MARS_RADIUS_M, FOV_DEG * DEG, renderer.domElement.height),
      separationRad: angleBetween(geoFromSphere(...pose.position), center),
      reachRad: groundAngle(Math.hypot(...pose.position) / MARS_RADIUS_M - 1, Math.min(Math.PI / 2, cornerRad)),
    });
  }

  function connectControls() {
    controls?.dispose();
    controls = new OrbitControls(rig, surface);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = CONTROLS.damping;
    controls.minDistance = 1 + ENTER_DISTANCE_M / MARS_RADIUS_M;
    controls.maxDistance = maxDistance;
  }

  // Ponto da tela, de -1 a 1 com y para cima, de uma posição do ponteiro.
  function screenPoint(clientX, clientY) {
    const rect = surface.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: 1 - ((clientY - rect.top) / rect.height) * 2 };
  }

  const groundAt = (point) => surfaceUnder(poseFromView(getView()), point.x, point.y, TAN_HALF_FOV, aspect);

  // Guarda o ponto do chão que está sob o cursor antes de o zoom acontecer. Os controles aplicam o
  // zoom dentro do próprio evento, por isso estes ouvintes entram na fase de captura, antes deles.
  function anchorZoom(point) {
    zoomAnchor ??= Object.freeze({ point, ground: groundAt(point) });
  }

  function onWheel(event) {
    anchorZoom(screenPoint(event.clientX, event.clientY));
  }

  // Na pinça, o ponto que fica parado é o meio dos dois dedos.
  function onTouch(event) {
    if (event.pointerType !== 'touch') return;
    if (event.type === 'pointerup' || event.type === 'pointercancel') touches.delete(event.pointerId);
    else if (event.type === 'pointerdown' || touches.has(event.pointerId)) touches.set(event.pointerId, event);
    if (touches.size !== 2) return;
    const [first, second] = [...touches.values()];
    anchorZoom(screenPoint((first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2));
  }

  // Zoom em direção ao cursor: gira a câmera em volta do centro do planeta até o ponto do chão que
  // estava sob o cursor voltar para baixo dele. Com o cursor fora do disco do planeta não há o que segurar.
  function holdUnderCursor(point, ground) {
    for (let pass = 0; pass < ANCHOR_PASSES; pass++) {
      const now = groundAt(point);
      if (!now) break;
      rig.position.applyQuaternion(turn.setFromUnitVectors(fromPoint.copy(now), toPoint.copy(ground)));
    }
    rig.lookAt(0, 0, 0);
  }

  // Perto do chão o mesmo gesto tem de mexer menos: o giro acompanha o chão sob o ponteiro e a
  // aproximação age sobre a altitude, não sobre a distância ao centro do planeta.
  function stepControls() {
    const distance = rig.position.length();
    // O piso do zoom acompanha a distância no chão até a área, medida do ponto sob a câmera ou do
    // ponto sob o cursor (o que estiver mais perto): mirando a área, dá para descer até ela.
    const aimedRad = zoomAnchor?.ground ? areaDirection.angleTo(toPoint.copy(zoomAnchor.ground)) : Infinity;
    const awayM = Math.min(rig.position.angleTo(areaDirection), aimedRad) * MARS_RADIUS_M;
    const floorM = clamp(awayM * VIEW.floorPerMeterAway, ENTER_DISTANCE_M, VIEW.farFloorM);
    // O piso só segura a aproximação: nunca empurra para longe a câmera que já está abaixo dele.
    controls.minDistance = Math.min(distance, 1 + floorM / MARS_RADIUS_M);
    controls.rotateSpeed = Math.min(CONTROLS.maxRotateSpeed, ((distance - 1) * TAN_HALF_FOV) / Math.PI);
    controls.zoomSpeed = (CONTROLS.zoomSpeed * (distance - 1)) / distance;
    controls.update();
    if (zoomAnchor?.ground) holdUnderCursor(zoomAnchor.point, zoomAnchor.ground);
    zoomAnchor = null;
  }

  function enter(view) {
    armed = false;
    pendingReturn = true;
    onEnter(view);
  }

  function flyToArea() {
    if (!active || flight) return;
    const from = getView();
    const angleRad = angleBetween(from, center);
    const effort = Math.max(angleRad / FLIGHT.fullAngleRad, Math.abs(Math.log(from.distanceM / ENTER_DISTANCE_M)) / FLIGHT.fullZoomLog);
    flight = Object.freeze({
      from, angleRad,
      deltaLon: angleDeltaDeg(from.lon, center.lon),
      // Com movimento reduzido a câmera vai direto, sem animação.
      durationS: reducedMotion.matches ? 0 : FLIGHT.durationS * clamp(effort, FLIGHT.minShare, 1),
      elapsedS: 0,
    });
    controls.enabled = false;
  }

  function stepFlight(dtS) {
    const { from } = flight;
    const elapsedS = flight.elapsedS + dtS;
    const t = flight.durationS > 0 ? Math.min(1, elapsedS / flight.durationS) : 1;
    const turned = easeInOutCubic(Math.min(1, t / FLIGHT.turnShare));
    const descentM = Math.exp(lerp(Math.log(from.distanceM), Math.log(ENTER_DISTANCE_M), easeInOutCubic(t)));
    const hopM = FLIGHT.hopPerRad * flight.angleRad * Math.sin(Math.PI * turned) * MARS_RADIUS_M;
    placeRig(lerp(from.lat, center.lat, turned), from.lon + flight.deltaLon * turned, Math.min(descentM + hopM, (maxDistance - 1) * MARS_RADIUS_M));
    // A vista chega nivelada: norte para cima, olhando reto para baixo.
    carried = Object.freeze({ headingDeg: from.headingDeg * (1 - turned), tiltDeg: from.tiltDeg * (1 - turned), fromDistanceM: Infinity });
    if (t < 1) {
      flight = Object.freeze({ ...flight, elapsedS });
      return;
    }
    flight = null;
    carried = LEVEL;
    // Controles novos: recomeçam da pose final, sem a inércia do gesto anterior ao voo.
    connectControls();
    enter(getView());
  }

  // Aproximação manual: a câmera chega à distância de entrada, vinda de fora, com a área na tela.
  function checkApproach(view) {
    if (view.distanceM > ENTER_DISTANCE_M + VIEW.enterToleranceM) armed = true;
    else if (armed && areaAt.inReach) enter(view);
  }

  function updateMarker(view, pose) {
    const spot = projectPoint(pose, areaPointM, TAN_HALF_FOV, aspect);
    // À vista: aquém do horizonte, à frente da câmera e dentro da tela.
    const offCenter = dot(areaUp, pose.position) > MARS_RADIUS_M && spot.inFront ? Math.max(Math.abs(spot.x), Math.abs(spot.y)) : Infinity;
    const onScreen = offCenter <= 1;
    const spanPx = (areaSpanM * size.height) / (2 * view.distanceM * TAN_HALF_FOV);
    areaAt = Object.freeze({
      x: (spot.x * 0.5 + 0.5) * size.width,
      y: (0.5 - spot.y * 0.5) * size.height,
      ringPx: RING_FILL * spanPx,
      onScreen,
      inReach: offCenter <= VIEW.enterScreenShare,
    });
    // De perto a própria área iluminada aparece: o marcador sai da frente.
    marker.place({ ...areaAt, visible: onScreen && spanPx < MARKER_MAX_AREA_PX });
  }

  function onDoubleClick(event) {
    if (!areaAt.onScreen) return;
    const rect = container.getBoundingClientRect();
    const distancePx = Math.hypot(event.clientX - rect.left - areaAt.x, event.clientY - rect.top - areaAt.y);
    if (distancePx <= Math.max(DOUBLE_CLICK_RADIUS_PX, areaAt.ringPx / 2)) flyToArea();
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    size = Object.freeze({ width, height });
    aspect = width / height;
    // Distância em que o planeta inteiro cabe na tela, na direção mais apertada.
    const tightestHalfRad = Math.min((FOV_DEG * DEG) / 2, Math.atan(TAN_HALF_FOV * aspect));
    const fitDistance = 1 / Math.sin(tightestHalfRad * VIEW.fitFill);
    maxDistance = fitDistance * VIEW.zoomOutFactor;
    if (controls) controls.maxDistance = maxDistance;
    if (!posed) {
      placeRig(center.lat + HOME.latOffsetDeg, center.lon + HOME.lonOffsetDeg, (fitDistance - 1) * MARS_RADIUS_M);
      posed = true;
    }
    dirty = true;
  }

  function show() {
    if (active) return;
    active = true;
    marker.setShown(true);
    resize();
    // Na volta do modelo local sem uma vista dada, o globo reabre afastado o bastante para a região aparecer.
    if (pendingReturn) {
      rig.position.setLength(1 + VIEW.returnDistanceM / MARS_RADIUS_M);
      carried = LEVEL;
      pendingReturn = false;
    }
    idleTouchAction = surface.style.touchAction;
    connectControls();
    surface.addEventListener('dblclick', onDoubleClick);
    surface.addEventListener('wheel', onWheel, GESTURE_FIRST);
    for (const type of TOUCH_EVENTS) surface.addEventListener(type, onTouch, GESTURE_FIRST);
    dirty = true;
  }

  function hide() {
    if (!active) return;
    active = false;
    flight = null;
    zoomAnchor = null;
    touches.clear();
    controls.dispose();
    controls = null;
    // Os controles mexem no gesto de toque do canvas ao sair; volta ao que era antes do globo.
    surface.style.touchAction = idleTouchAction;
    surface.removeEventListener('dblclick', onDoubleClick);
    surface.removeEventListener('wheel', onWheel, GESTURE_FIRST);
    for (const type of TOUCH_EVENTS) surface.removeEventListener(type, onTouch, GESTURE_FIRST);
    marker.setShown(false);
  }

  /** Chamado a cada quadro enquanto o globo está ativo. Só desenha quando algo mudou. */
  function render(dtS) {
    if (!active) return;
    // Sem tamanho na tela (container escondido) ainda não há vista para desenhar.
    if (!posed) resize();
    if (!posed) return;
    if (flight) {
      stepFlight(dtS);
      // Quem recebe a entrada pode esconder o globo na mesma hora.
      if (!active) return;
    } else {
      stepControls();
    }
    const nowMs = performance.now();
    const moved = dirty || rig.position.distanceToSquared(drawnPosition) > ((rig.position.length() - 1) * MOVE_EPS) ** 2;
    const uploaded = imagery.flush(nowMs);
    if (!moved && !uploaded && nowMs < imageryDueMs) return;
    const view = getView();
    const pose = poseFromView(view);
    requestImagery(nowMs, view, pose);
    imageryDueMs = nowMs + IMAGERY_CHECK_MS;
    if (!moved && !uploaded) return;
    painter.draw(renderer, pose, { fovDeg: FOV_DEG, aspect });
    drawnPosition.copy(rig.position);
    dirty = false;
    updateMarker(view, pose);
    if (!flight) checkApproach(view);
  }

  function setQuality(name) {
    if (imagery?.quality === name) return;
    const next = createImagery({ quality: name, focus: center, maxTextureSize: renderer.capabilities.maxTextureSize, onStatus });
    imagery?.dispose();
    imagery = next;
    painter.setLayers(imagery.layers);
    dirty = true;
  }

  function dispose() {
    hide();
    imagery.dispose();
    painter.dispose();
    marker.dispose();
  }

  setQuality(quality);
  return Object.freeze({
    show, hide, isActive: () => active, render, resize, flyToArea, setQuality, dispose, getView, setView,
    invalidate: () => { dirty = true; },
  });
}
