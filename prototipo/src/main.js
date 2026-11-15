// Ponto de entrada: monta a cena, liga o painel do tablet e o visor, e roda o laço de quadros.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { createTerrain } from './terrain.js';
import { createScenery } from './scenery.js';
import { createStage } from './stage.js';
import { createOverlays } from './overlays.js';
import { createTabletPanel } from './tablet.js';
import { VISORS, DEFAULT_VISOR, visorIdFromUrl, loadVisor } from '../visores/registry.js';
import { loadImagery } from './imagery.js';
import { createDetailImagery } from './detalhe.js';
import { loadFinePhoto } from './foto-fina.js';
import { loadSurroundings } from './entorno.js';
import { loadElevation } from './elevation.js';
import { buildPlan } from './route.js';
import { toLocal, toGeo, ORIGIN, DATA_BOUNDS } from './geo.js';
import { sunAt, solarLongitudeDeg, julianDateTT } from './luz.js';
import { loadSeasonWeather, loadRecentDose, loadNightThermal, loadRoverPosition } from './nasa.js';
import { CURIOSITY } from '../data/medicoes.js';
import { createVehicle } from './veiculo3d.js';
import { decodeSand, loadSandBits } from './areia.js';
import { useMeasuredRanges } from './clima.js';
import { createAgent, engineLabel, offlineMessage } from './ia/agente.js';
import { createTabletTools, TABLET_PROMPT } from './ia/ferramentas-tablet.js';
import { mosaicCoverage } from './tiles.js';
import { createRouter } from './pathfind.js';
import { createSafety, ASSUMPTIONS } from './safety.js';
import { createPlanner, MAX_WAYPOINTS } from './planner.js';
import { PROTOCOLS, SHELTER_KINDS, protocolFor } from '../data/protocolos.js';
import { byId } from './dom.js';
import { fmtClock } from './format.js';
import { DEFAULT_QUALITY, QUALITY } from './config.js';
import { applyStaticTexts, LANG, LANGS, setLang, t } from './i18n.js';

const TABLET_CAMERA = Object.freeze({ position: [-700, 4300, -5500], target: [0, 300, -250] });
const ORBIT_LIMITS = Object.freeze({ minDistanceM: 150, maxDistanceM: 16000, maxPolarRad: Math.PI * 0.47 });
const FOCUS = Object.freeze({ distanceM: 1300, durationS: 0.9 });
// Passagem entre o planeta e a área mapeada. Afastar o zoom além de `backAtShare` da distância máxima
// do mapa local volta ao planeta, que reabre `backOffFactor` vezes mais longe que a distância de
// entrada. `minPolarRad`: inclinação mínima da câmera local, para o rumo não se perder olhando reto
// para baixo. `durationS`: descida até a vista de planejamento quando a entrada foi pelo botão.
const PLANET_HANDOFF = Object.freeze({ durationS: 1.6, backAtShare: 0.985, backOffFactor: 1.05, minPolarRad: 0.001 });
const AREA_LABEL = t('Cratera Gale · Monte Sharp');
const MAX_FRAME_S = 0.1;
// Hora solar local em que o mapa abre, e de quanto em quanto a luz é refeita enquanto o relógio do visor anda.
const DEFAULT_HOUR_H = 10;
const SUN_STEP_H = 1 / 60;
const FOCUS_REFRESH_S = 0.15;
// No tablet parado, a cena é redesenhada só de vez em quando, como garantia (ver `requestRender`).
const IDLE_RENDER_S = 0.5;
const RENDER_BURST_FRAMES = 3;
// Clique no mapa: até quantos pixels o ponteiro pode andar sem virar arrasto, e o passo da busca do ponto no relevo.
const PICK = Object.freeze({ clickTolerancePx: 5, stepM: 8, maxM: 40000, refineSteps: 12 });
const OUTSIDE_DATA_NOTICE = t('Escolha um ponto dentro da área fotografada do mapa.');
const RAD_TO_DEG = 180 / Math.PI;
// A qualidade escolhida fica guardada neste navegador.
const QUALITY_STORAGE_KEY = 'lunaticos:qualidade';
function storedQuality() {
  try {
    const saved = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    return saved in QUALITY ? saved : DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY; // sem armazenamento (modo privado), vale o padrão
  }
}
function storeQuality(id) {
  try {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, id);
  } catch {
    // A escolha só não persiste; continua valendo nesta visita.
  }
}
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
// Selo sobre o mapa: diz o que é real no que está na tela.
function badgeText({ imagery, relief, detail, fine }) {
  const reliefText = relief === 'real' ? t('relevo real (USGS)') : t('altura do relevo aproximada');
  if (imagery === 'loading') return `${t('Carregando imagem HiRISE…')} · ${reliefText}`;
  if (imagery === 'ready') {
    const base = relief === 'real' ? t('Imagem HiRISE e relevo reais (USGS)') : `${t('Imagem HiRISE real')} · ${reliefText}`;
    if (detail === 'offline') return `${base} · ${t('sem rede para o detalhe fino')}`;
    if (detail) return `${base} · ${t`detalhe de ${detail} por pixel`}`;
    return fine ? `${base} · ${t('foto de 0,7 m por pixel')}` : base;
  }
  return `${t('Imagem HiRISE indisponível')} · ${reliefText}`;
}

function boot(elevation, visor, sandBits, globeModule) {
  const app = byId('app');
  app.dataset.visor = visor.id;
  const stageElement = byId('stage');
  const north = byId('north');
  const badge = byId('map-badge');

  const terrain = createTerrain(elevation);
  const scenery = createScenery(terrain);
  const stage = createStage(stageElement, scenery);
  stage.scene.add(terrain.mesh, scenery.props);

  const controls = new MapControls(stage.camera, stage.renderer.domElement);
  controls.enableDamping = true;
  controls.zoomToCursor = true;
  controls.minDistance = ORBIT_LIMITS.minDistanceM;
  controls.maxDistance = ORBIT_LIMITS.maxDistanceM;
  controls.maxPolarAngle = ORBIT_LIMITS.maxPolarRad;
  // Arrastar gira a cena (o gesto mais natural em 3D); botão direito ou Shift + arrastar move.
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  stage.camera.position.set(...TABLET_CAMERA.position);
  controls.target.set(...TABLET_CAMERA.target);
  // Com ?debug na URL, expõe a câmera para testes automatizados posicionarem a vista.
  if (new URLSearchParams(window.location.search).has('debug')) window.lunaticos = { camera: stage.camera, controls, renderer: stage.renderer };

  // Rotas e segurança calculadas sobre o mesmo campo de altitude do terreno.
  // A areia escura estimada só vale sobre o relevo real, que é a grade em que ela foi calculada.
  const sand = terrain.isReal ? decodeSand(sandBits, terrain.field.heights.length) : null;
  const router = createRouter(terrain.field, { sand });
  // Camada pintada no terreno dentro do visor: a IA de bordo liga uma a pedido do astronauta.
  let visorLayer = 'none';
  const safety = createSafety(terrain.field, router);
  const planner = createPlanner(terrain.field, router, safety);
  terrain.setLayerSource('walkback', (x, z) => safety.walkBackAt(x, z));
  terrain.setLayerSource('comms', (x, z) => safety.commsCoverageAt(x, z));
  terrain.setLayerSource('radiation', (x, z) => safety.radiationAt(x, z));
  terrain.setLayerSource('sand', (x, z) => (router.sandAt(x, z) ? 1 : NaN));
  // O plano leva a avaliação de segurança e a hora solar local em que a saída começa.
  const withSafety = (base, hourH) => Object.freeze({ ...base, safety: safety.assessPlan(base), startClockH: hourH });

  // Plano para um estado: rota livre pelos pontos escolhidos (calculada na hora) ou a travessia pré-calculada.
  function planFor(next) {
    if (next.waypoints.length === 0) return { plan: withSafety(buildPlan(next.mode, next.includeExtension), next.hourH), reason: null };
    const result = planner.planThrough(next.waypoints, next.mode);
    return result.plan ? { plan: withSafety(result.plan, next.hourH), reason: null } : { plan: null, reason: result.reason };
  }

  // Ida e volta do habitat a um ponto, sem tocar no plano da tela: para a IA dizer se dá para ir até o rover.
  function tripTo(point, mode) {
    const profile = planner.profileFor(mode);
    const out = router.findPath(safety.habitat, point, profile);
    if (!out.reachable) return null;
    const back = router.findPath(out.points[out.points.length - 1], safety.habitat, profile);
    return back.reachable ? { km: (out.lengthM + back.lengthM) / 1000, travelH: out.hours + back.hours } : null;
  }

  let state = Object.freeze({
    mode: 'walk', includeExtension: false, layer: 'none', view: 'tablet',
    imagery: 'loading', relief: terrain.isReal ? 'real' : 'approx',
    waypoints: Object.freeze([]), notice: null, detail: '', hourH: DEFAULT_HOUR_H,
    quality: storedQuality(),
    // A foto fina pronta (0,69 m) está em cena? Só nas qualidades que a usam, depois de carregada.
    fine: false,
    // Medições lidas da NASA: undefined enquanto carregam, null se a rede falhar.
    weather: undefined, dose: undefined,
  });
  let { plan } = planFor(state);
  let tween = null;
  let savedPose = null;

  // Estação de hoje em Marte (longitude solar), que define o caminho do Sol no céu.
  const lsDeg = solarLongitudeDeg(julianDateTT(new Date()));
  // Barra de estado do tablet de missão: a estação de hoje em Marte (calculada) e a hora de partida escolhida.
  byId('device-season').textContent = t`Ls ${Math.round(lsDeg)}° · estação de hoje`;
  const deviceClock = byId('device-clock');
  const showDeviceClock = () => { deviceClock.textContent = t`Partida ${fmtClock(state.hourH)} · hora solar local`; };
  showDeviceClock();
  let sunHourH = null;
  // Põe o Sol na posição da hora dada. No visor é chamado a cada quadro, então só refaz a luz a cada minuto.
  function applySun(hourH, force = false) {
    if (!force && sunHourH !== null && Math.abs(hourH - sunHourH) < SUN_STEP_H) return;
    sunHourH = hourH;
    stage.setSun(sunAt(ORIGIN.lat, lsDeg, hourH));
  }

  // Leva a câmera do tablet até uma parada, mantendo o ângulo atual.
  function focusOn(stop) {
    focusOnPoint(toLocal(stop.lat, stop.lon));
  }

  function focusOnPoint({ x, z }) {
    if (state.view !== 'tablet') return;
    const toTarget = new THREE.Vector3(x, terrain.heightAt(x, z), z);
    const direction = stage.camera.position.clone().sub(controls.target).normalize();
    tween = Object.freeze({
      fromTarget: controls.target.clone(),
      toTarget,
      fromPosition: stage.camera.position.clone(),
      toPosition: toTarget.clone().addScaledVector(direction, FOCUS.distanceM),
      elapsedS: 0,
    });
  }

  function stepTween(dtS) {
    if (!tween) return;
    const elapsedS = tween.elapsedS + dtS;
    const durationS = tween.durationS ?? FOCUS.durationS;
    const eased = easeOutCubic(Math.min(1, elapsedS / durationS));
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
    stage.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    tween = elapsedS >= durationS ? null : Object.freeze({ ...tween, elapsedS });
  }

  const overlays = createOverlays(stage.scene, terrain, { onStopClick: focusOn });
  // Rover Curiosity: começa na última posição guardada e troca pela publicada pela NASA quando a rede responde.
  let rover = CURIOSITY;
  overlays.setRover(rover);
  const activeVisor = visor.create({
    mount: byId('visor-mount'),
    stageElement,
    camera: stage.camera,
    terrain,
    overlays,
    // Sair pelo minimapa do visor abre o mapa já centrado em onde o astronauta está.
    onExit: (options) => {
      setState({ view: 'tablet' });
      const outing = options?.focusAstronaut ? activeVisor.outing?.() : null;
      if (outing) focusOnPoint(outing);
    },
    // O visor informa a hora local do relógio da saída, e a luz acompanha.
    onLocalHour: (hourH) => applySun(hourH),
    // Medições do Curiosity lidas da NASA (ou null sem rede) e a estação de hoje, para a IA de bordo.
    live: () => ({ weather: state.weather ?? null, dose: state.dose ?? null, lsDeg, rover }),
    // A IA de bordo pinta uma camada do mapa sobre o terreno do visor (térmico, declive, rádio, areia…).
    onLayer: (layer) => {
      visorLayer = layer;
      if (state.view === 'visor') terrain.paint({ layer, dimOutsideData: false });
    },
    // Modelo 3D do veículo, que o visor move junto com o astronauta nas saídas de veículo.
    vehicle: createVehicle(stage.scene, terrain),
    // O mesmo plano em outro modo (a pé ou de veículo), para a IA simular sem mudar nada.
    planIn: (mode) => planFor({ ...state, mode }).plan,
      tripTo,
    // Segurança calculada sobre o relevo real, para as variantes de visor consumirem.
    safety: Object.freeze({
      walkBackAt: safety.walkBackAt,
      commsAt: safety.commsAt,
      radiationAt: safety.radiationAt,
      sandAt: safety.sandAt,
      nearestShelter: safety.nearestShelter,
      assessPlan: safety.assessPlan,
      assumptions: ASSUMPTIONS,
      protocols: PROTOCOLS,
      protocolFor,
      shelterKinds: SHELTER_KINDS,
    }),
  });
  const panel = createTabletPanel(byId('panel'), {
    onModeChange: (mode) => setState({ mode }),
    onAskAssistant: (question) => askPlanner(question),
    onHourChange: (hourH) => setState({ hourH }),
    onQualityChange: (quality) => setState({ quality }),
    onExtensionChange: (includeExtension) => setState({ includeExtension }),
    onLayerChange: (layer) => setState({ layer }),
    onStopFocus: focusOn,
    onEnterVisor: () => setState({ view: 'visor' }),
    // A variante é carregada na abertura da página, então trocar recarrega com ?visor=<id>.
    onClearDestination: () => setState({ waypoints: Object.freeze([]) }),
    onRemoveWaypoint: (index) => setState({ waypoints: Object.freeze(state.waypoints.filter((_, i) => i !== index)) }),
    onPlanTo: ({ lat, lon }) => addWaypoint(toLocal(lat, lon)),
    onVisorChange: (id) => {
      const url = new URL(window.location.href);
      url.searchParams.set('visor', id);
      window.location.assign(url);
    },
  }, { realRelief: terrain.isReal, visors: VISORS, visorId: visor.id, lsDeg, quality: state.quality });

  function applyView() {
    const isVisor = state.view === 'visor';
    app.dataset.view = state.view;
    stage.setView(state.view);
    overlays.setView(state.view);
    // Entrar no visor a partir do planeta passa antes pela área mapeada, sem a descida animada.
    if (isVisor && scope === 'planeta') setScope('local');
    controls.enabled = !isVisor && scope === 'local';
    if (isVisor) {
      savedPose = { position: stage.camera.position.clone(), target: controls.target.clone() };
      tween = null;
      activeVisor.start(plan);
    } else {
      activeVisor.stop();
      if (savedPose) {
        stage.camera.position.copy(savedPose.position);
        controls.target.copy(savedPose.target);
      }
      controls.update();
      applySun(state.hourH, true);
    }
    syncAstronaut();
    stage.resize();
  }

  // No mapa do tablet, um pino marca onde o astronauta está na saída em andamento. Mudar o plano
  // tira o pino: a próxima entrada no visor começa outra saída.
  function syncAstronaut() {
    const outing = state.view === 'tablet' ? activeVisor.outing?.() : null;
    overlays.setAstronaut(outing?.plan === plan ? outing : null);
  }

  // Qualidade de renderização: sombras e pixels na cena, e quantos níveis de imagem fina entram.
  function applyQuality() {
    stage.setQuality(QUALITY[state.quality]);
    globe?.setQuality(state.quality);
    applyImageryQuality();
  }

  // Imagem conforme a qualidade: a foto fina pronta (carregada só na primeira vez em que uma
  // qualidade que a usa é escolhida) e os níveis lidos da rede.
  let finePhoto = null;
  let isFinePhotoRequested = false;
  function applyImageryQuality() {
    if (!detail) return;
    const quality = QUALITY[state.quality];
    detail.setLiveLevels(quality.liveDetail);
    detail.setFinePhoto(quality.finePhoto ? finePhoto : null);
    const fine = quality.finePhoto && finePhoto !== null;
    state = Object.freeze({ ...state, fine, detail: quality.liveDetail.length === 0 ? '' : state.detail });
    badge.textContent = badgeText(state);
    requestRender();
    if (!quality.finePhoto || isFinePhotoRequested) return;
    isFinePhotoRequested = true;
    loadFinePhoto()
      .then((photo) => { finePhoto = photo; applyImageryQuality(); })
      .catch((error) => console.warn('Foto fina indisponível; fica a foto de 2,5 m.', error));
  }

  // No tablet a cena só é redesenhada quando algo muda (câmera, plano, camada, hora, imagem que
  // chegou): parado, o mapa não gasta placa de vídeo. Cada pedido vale por alguns quadros, para
  // cobrir o que termina de assentar no quadro seguinte.
  let renderFrames = RENDER_BURST_FRAMES;
  function requestRender() { renderFrames = RENDER_BURST_FRAMES; }

  // ---------- Marte inteiro (globo) e a área mapeada (modelo local) ----------
  // O tablet abre no planeta. Aproximar sobre a área mapeada entra no modelo local; afastar o zoom
  // do modelo local até o limite volta ao planeta. A câmera passa de um para o outro no mesmo
  // enquadramento (ponto olhado, distância, rumo e inclinação), para a aproximação parecer uma só.
  // Sem o módulo do globo, fica só o local.
  let globe = null;
  let globeEnterM = ORBIT_LIMITS.maxDistanceM;
  // A página chega marcada como planeta (demo.html), para o mapa local não aparecer enquanto carrega.
  let scope = 'local';
  // O botão "Entrar na área mapeada" foi usado? Aí, depois da chegada, a câmera desce sozinha até a vista de planejamento.
  let isFlyingIn = false;
  const planetChrome = byId('planet-chrome');
  app.dataset.scope = scope;

  /**
   * @param {'planeta'|'local'} next
   * @param {{ view?: object | null, settle?: boolean }} [options] `view`: a vista do globo na entrada
   *   (ver GlobeView em globo.js); `settle`: desce até a vista de planejamento depois de entrar.
   */
  function setScope(next, { view = null, settle = false } = {}) {
    if (next === scope || (next === 'planeta' && !globe)) return;
    const cameFromLocal = scope === 'local' && next === 'planeta' && state.view === 'tablet';
    scope = next;
    app.dataset.scope = scope;
    const isPlanet = scope === 'planeta';
    planetChrome.hidden = !isPlanet;
    controls.enabled = !isPlanet && state.view === 'tablet';
    tween = null;
    if (isPlanet) {
      // Vindo do mapa local, o planeta reabre no mesmo enquadramento; na abertura do tablet, na vista dele.
      if (cameFromLocal && canInheritLocalView) globe.setView(globeViewFromCamera());
      canInheritLocalView = true;
      globe.show();
    } else {
      globe.hide();
      if (view) placeCameraAt(view);
      if (settle) settleOnArea();
    }
    requestRender();
  }
  // Na abertura do tablet a câmera local ainda está na vista de planejamento, que não é de onde o
  // usuário vem: só depois da primeira troca o planeta passa a herdar o enquadramento do mapa local.
  let canInheritLocalView = false;

  // Vista do globo -> câmera local equivalente.
  function placeCameraAt(view) {
    const { x, z } = toLocal(view.lat, view.lon);
    const target = new THREE.Vector3(x, terrain.heightAt(x, z), z);
    const polarRad = Math.max(view.tiltDeg / RAD_TO_DEG, PLANET_HANDOFF.minPolarRad);
    const distanceM = Math.min(view.distanceM, ORBIT_LIMITS.maxDistanceM);
    controls.target.copy(target);
    stage.camera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(distanceM, polarRad, -view.headingDeg / RAD_TO_DEG));
    controls.update();
  }

  // Câmera local -> vista do globo, um pouco além da distância de entrada para a aproximação valer de novo.
  function globeViewFromCamera() {
    const { lat, lon } = toGeo(controls.target.x, controls.target.z);
    return {
      lat, lon,
      distanceM: Math.max(stage.camera.position.distanceTo(controls.target), globeEnterM) * PLANET_HANDOFF.backOffFactor,
      headingDeg: -controls.getAzimuthalAngle() * RAD_TO_DEG,
      tiltDeg: controls.getPolarAngle() * RAD_TO_DEG,
    };
  }

  // Depois de entrar pelo botão, a câmera desce de onde chegou até a vista de planejamento.
  function settleOnArea() {
    tween = Object.freeze({
      fromTarget: controls.target.clone(), toTarget: new THREE.Vector3(...TABLET_CAMERA.target),
      fromPosition: stage.camera.position.clone(), toPosition: new THREE.Vector3(...TABLET_CAMERA.position),
      elapsedS: 0, durationS: PLANET_HANDOFF.durationS,
    });
  }

  // Afastar o zoom além do limite do modelo local devolve ao planeta.
  stage.renderer.domElement.addEventListener('wheel', (event) => {
    if (!globe || scope !== 'local' || state.view !== 'tablet' || tween || event.deltaY <= 0) return;
    if (stage.camera.position.distanceTo(controls.target) >= ORBIT_LIMITS.maxDistanceM * PLANET_HANDOFF.backAtShare) setScope('planeta');
  }, { passive: true });
  byId('planet-enter').addEventListener('click', () => {
    isFlyingIn = true;
    globe?.flyToArea();
  });

  // O módulo do globo chega junto com o relevo (ver `start`), o globo é criado com a cena local e o
  // tablet muda para o planeta antes do primeiro quadro (ver o fim de `boot`): assim a página nunca
  // mostra o mapa de planejamento por um instante antes do planeta. Se o módulo não carregar ou o
  // globo falhar ao ser criado, o tablet abre direto na área mapeada.
  // Com ?local na URL o tablet abre na área mapeada mesmo com o globo disponível.
  function openOnPlanet() {
    if (!globeModule) return;
    const { createGlobe, GLOBE_SOURCE, ENTER_DISTANCE_M } = globeModule;
    try {
      globeEnterM = ENTER_DISTANCE_M;
      globe = createGlobe({
        renderer: stage.renderer, container: stageElement, area: DATA_BOUNDS, label: AREA_LABEL, quality: state.quality,
        onEnter: (view) => {
          setScope('local', { view, settle: isFlyingIn });
          isFlyingIn = false;
        },
      });
    } catch (error) {
      globe = null;
      console.warn('Globo de Marte indisponível: o tablet abre direto na área mapeada.', error);
      return;
    }
    // "Mosaico Viking" sozinho não diz nada a quem não conhece a missão: o crédito na tela explica o que é.
    byId('planet-source').textContent = t`Imagem do planeta: fotos das sondas ${GLOBE_SOURCE.mission} (NASA, anos 1970), reunidas pelo USGS num mosaico de 232 m por pixel e lidas do NASA Mars Trek.`;
    const opensLocal = new URLSearchParams(window.location.search).has('local');
    if (state.view === 'tablet' && !opensLocal) setScope('planeta');
    else canInheritLocalView = true;
  }

  const PLAN_KEYS = ['mode', 'includeExtension', 'waypoints'];
  // Só o que de fato muda o plano: na rota livre a extensão não conta.
  const planKey = (s) => (s.waypoints.length > 0
    ? `livre|${s.waypoints.map((point) => `${point.x},${point.z}`).join(';')}|${s.mode}`
    : `travessia|${s.mode}|${s.includeExtension}`);

  // Acrescenta um ponto ao fim da rota livre (A, B, C…).
  function addWaypoint(point) {
    if (state.waypoints.length >= MAX_WAYPOINTS) {
      setState({ notice: t`A rota livre aceita até ${MAX_WAYPOINTS} pontos. Remova um para escolher outro.` });
      return;
    }
    setState({ waypoints: Object.freeze([...state.waypoints, point]) });
  }

  function setState(changes) {
    const previous = state;
    // O aviso some na próxima ação do usuário, mas não quando a imagem termina de carregar.
    const notice = 'imagery' in changes ? state.notice : null;
    state = Object.freeze({ ...state, notice, ...changes });
    if (planKey(state) !== planKey(previous)) {
      const next = planFor(state);
      if (next.plan) {
        plan = next.plan;
        overlays.setPlan(plan);
      } else {
        // Sem rota para o pedido: mantém o plano anterior e explica o motivo.
        const kept = Object.fromEntries(PLAN_KEYS.map((key) => [key, previous[key]]));
        state = Object.freeze({ ...state, ...kept, notice: next.reason });
      }
    }
    if (state.hourH !== previous.hourH) {
      showDeviceClock();
      if (plan.startClockH !== state.hourH) plan = Object.freeze({ ...plan, startClockH: state.hourH });
      applySun(state.hourH, true);
    }
    if (state.layer !== previous.layer || state.view !== previous.view) {
      const isTablet = state.view === 'tablet';
      // A camada do visor é dele: uma saída nova a zera (onLayer), uma saída retomada a mantém.
      terrain.paint({ layer: isTablet ? state.layer : visorLayer, dimOutsideData: isTablet });
    }
    if (state.quality !== previous.quality) {
      storeQuality(state.quality);
      applyQuality();
    }
    if (state.view !== previous.view) {
      applyView();
      // Na volta ao tablet o foco retorna ao botão de entrada; no visor, cada variante cuida do próprio foco.
      if (state.view === 'tablet') document.querySelector('.panel .cta')?.focus();
    }
    // Qualquer mudança que troque o plano (rota, modo, hora de partida) tira o pino do astronauta.
    syncAstronaut();
    badge.textContent = badgeText(state);
    panel.update(plan, state);
    requestRender();
  }

  // Clique (sem arrastar) no mapa acrescenta um ponto à rota livre.
  const canvas = stage.renderer.domElement;
  const raycaster = new THREE.Raycaster();
  // Vale qualquer ponto dentro da imagem orbital (a parte clara do mapa).
  const insideData = ({ x, z }) => {
    const { lat, lon } = toGeo(x, z);
    return mosaicCoverage(lat, lon, 1) >= 1;
  };

  // Acha onde um raio da câmera encontra o relevo: anda em passos e refina por bisseção.
  // (ndcX, ndcY) vão de -1 a 1 na tela, com (0, 0) no centro.
  const pointer = new THREE.Vector2();
  function groundUnder(ndcX, ndcY) {
    raycaster.setFromCamera(pointer.set(ndcX, ndcY), stage.camera);
    const { origin, direction } = raycaster.ray;
    const { halfWidth, halfDepth } = terrain.field;
    const below = (t) => {
      const x = origin.x + direction.x * t;
      const z = origin.z + direction.z * t;
      if (Math.abs(x) > halfWidth || Math.abs(z) > halfDepth) return false;
      return origin.y + direction.y * t <= terrain.heightAt(x, z);
    };
    for (let t = PICK.stepM; t < PICK.maxM; t += PICK.stepM) {
      if (!below(t)) continue;
      let lo = t - PICK.stepM;
      let hi = t;
      for (let i = 0; i < PICK.refineSteps; i++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid;
        else lo = mid;
      }
      return { x: origin.x + direction.x * hi, z: origin.z + direction.z * hi };
    }
    return null;
  }

  function pickTerrain(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return groundUnder(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  // Onde o detalhe fino da imagem deve ficar: no visor, em volta do astronauta; no tablet, no chão do centro da tela.
  // O ponto do chão no centro da tela é procurado poucas vezes por segundo: a busca anda o raio inteiro quando ele não acha o relevo.
  let detail = null;
  let tabletFocus = null;
  let focusAgeS = Infinity;
  /** @returns {boolean} Se a imagem lida da rede mudou neste quadro (ver `detail.update`). */
  function updateDetail(dtS) {
    if (!detail) return false;
    // O grão do chão de perto só faz sentido na altura dos olhos, e só nas qualidades que o incluem.
    detail.setGrain(state.view === 'visor' && QUALITY[state.quality].grain);
    const eye = stage.camera.position;
    if (state.view === 'visor') return detail.update(eye, 0, dtS);
    focusAgeS += dtS;
    if (!tabletFocus || focusAgeS >= FOCUS_REFRESH_S) {
      tabletFocus = groundUnder(0, 0) ?? { x: controls.target.x, z: controls.target.z };
      focusAgeS = 0;
    }
    const { x, z } = tabletFocus;
    return detail.update(tabletFocus, Math.hypot(eye.x - x, eye.y - terrain.heightAt(x, z), eye.z - z), dtS);
  }
  // Atualiza só o selo: o painel não depende do detalhe e não precisa ser refeito.
  function setDetailStatus(status) {
    state = Object.freeze({ ...state, detail: status });
    badge.textContent = badgeText(state);
  }

  // Só o ponteiro primário conta como clique: um segundo dedo (pinça, giro) cancela.
  let press = null;
  canvas.addEventListener('pointerdown', (event) => {
    press = event.isPrimary && event.button === 0 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  });
  canvas.addEventListener('pointercancel', () => { press = null; });
  canvas.addEventListener('pointerup', (event) => {
    const start = press;
    press = null;
    if (!start || start.id !== event.pointerId || state.view !== 'tablet' || scope !== 'local') return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > PICK.clickTolerancePx) return;
    const hit = pickTerrain(event.clientX, event.clientY);
    if (!hit) return;
    if (insideData(hit)) addWaypoint(hit);
    else setState({ notice: OUTSIDE_DATA_NOTICE });
  });

  overlays.setPlan(plan);
  applyQuality();
  applySun(state.hourH, true);
  terrain.paint({ layer: state.layer, dimOutsideData: true });
  applyView();
  badge.textContent = badgeText(state);
  panel.update(plan, state);

  // A foto real chega depois; até lá (ou se faltar algum arquivo) o solo fica procedural.
  loadImagery()
    .then((imagery) => {
      terrain.attachImagery(imagery);
      detail = createDetailImagery({ onStatus: setDetailStatus });
      terrain.attachDetail(detail);
      applyImageryQuality();
      setState({ imagery: 'ready' });
    })
    .catch((error) => {
      console.warn(error);
      setState({ imagery: 'failed' });
    });

  // Chão em volta da área mapeada: a imagem real da região chega da rede; sem ela fica o chão liso.
  loadSurroundings()
    .then((surroundings) => {
      if (surroundings.loaded > 0) scenery.setSurroundings(surroundings);
      requestRender();
    })
    .catch((error) => console.warn('Imagem da região em volta indisponível; fica o chão liso.', error));

  // IA de planejamento do tablet (modelo de linguagem, na nuvem ou local). As ações dela passam pelas mesmas
  // funções dos botões do painel, então valem as mesmas regras (limite de pontos, área com dados).
  const planningAgent = createAgent({
    ...createTabletTools({
      getState: () => state,
      getPlan: () => plan,
      safety,
      terrain,
      lsDeg,
      isInsideData: insideData,
      rover: () => rover,
      planIn: (mode) => planFor({ ...state, mode }).plan,
      tripTo,
      actions: {
        setHour: (hourH) => setState({ hourH }),
        setMode: (mode) => setState({ mode }),
        addWaypoint,
        removeWaypoint: (index) => setState({ waypoints: Object.freeze(state.waypoints.filter((_, i) => i !== index)) }),
        clearRoute: () => setState({ waypoints: Object.freeze([]) }),
        setLayer: (layer) => setState({ layer }),
        focusStop: focusOn,
      },
    }),
    systemPrompt: TABLET_PROMPT,
    onStatus: (text) => panel.setAssistantBusy(text),
  });
  const showPlannerHealth = (health) => panel.setAssistantNote(health.ok ? engineLabel(health) : t('fora do ar'));
  async function askPlanner(question) {
    try {
      const reply = await planningAgent.ask(question);
      showPlannerHealth({ ok: true, where: planningAgent.where, model: planningAgent.model });
      return reply.text;
    } catch (error) {
      console.warn(error);
      const health = await planningAgent.health();
      showPlannerHealth({ ...health, ok: false });
      return offlineMessage();
    }
  }
  planningAgent.health().then(showPlannerHealth);

  // Medições do Curiosity lidas dos serviços da NASA. O painel é refeito quando cada uma chega;
  // sem rede, ele mostra o valor de reserva e avisa.
  const setLive = (changes) => {
    state = Object.freeze({ ...state, ...changes });
    panel.update(plan, state);
  };
  // O aviso de "sem rede" só vale para a leitura que falhou: erro ao mostrar o dado não cai aqui.
  const orNull = (key) => (error) => { console.warn(error); setLive({ [key]: null }); };
  loadSeasonWeather(lsDeg).then((weather) => { useMeasuredRanges(weather); setLive({ weather }); }, orNull('weather'));
  loadRecentDose().then((dose) => setLive({ dose }), orNull('dose'));
  // Sem rede, o rover fica na última posição guardada no repositório.
  loadRoverPosition().then((position) => { rover = position; overlays.setRover(rover); }, (error) => console.warn(error));
  loadNightThermal()
    .then((valueAt) => {
      terrain.setLayerSource('thermal', valueAt);
      if (state.layer === 'thermal' && state.view === 'tablet') terrain.paint({ layer: 'thermal', dimOutsideData: true });
    })
    .catch((error) => console.warn(error));

  new ResizeObserver(() => { stage.resize(); globe?.resize(); requestRender(); }).observe(stageElement);
  controls.addEventListener('change', requestRender);

  let lastMs = performance.now();
  let idleS = 0;
  function frame(nowMs) {
    const dtS = Math.min((nowMs - lastMs) / 1000, MAX_FRAME_S);
    lastMs = nowMs;
    if (state.view === 'tablet' && scope === 'planeta') {
      // O globo tem cena e câmera próprias e só redesenha quando algo muda.
      globe.render(dtS);
      requestAnimationFrame(frame);
      return;
    }
    if (state.view === 'visor') {
      activeVisor.frame(dtS);
    } else {
      stepTween(dtS);
      controls.update();
      north.style.transform = `rotate(${controls.getAzimuthalAngle() * RAD_TO_DEG}deg)`;
    }
    // A imagem lida da rede (qualidade alta) pede quadros só enquanto chega ou entra em cena.
    if (updateDetail(dtS)) requestRender();
    // O visor anda o tempo todo. Fora isso, desenha quando pedido e, parado, um quadro de garantia
    // a cada IDLE_RENDER_S.
    idleS += dtS;
    const isLive = state.view === 'visor' || tween !== null;
    if (isLive || renderFrames > 0 || idleS >= IDLE_RENDER_S) {
      stage.render();
      renderFrames = Math.max(0, renderFrames - 1);
      idleS = 0;
    }
    requestAnimationFrame(frame);
  }
  openOnPlanet();
  requestAnimationFrame(frame);
}

function showFatal(loading, error) {
  const reason = error instanceof Error ? error.message : t('erro desconhecido');
  loading.hidden = false;
  loading.dataset.state = 'error';
  loading.textContent = t`Não foi possível iniciar o mapa 3D: ${reason}`;
  console.error(error);
}

// Carrega a variante de visor pedida na URL; se ela falhar, cai no visor base.
async function resolveVisor() {
  const id = visorIdFromUrl();
  try {
    return { id, create: await loadVisor(id) };
  } catch (error) {
    if (id === DEFAULT_VISOR) throw error;
    console.warn(error);
    return { id: DEFAULT_VISOR, create: await loadVisor(DEFAULT_VISOR) };
  }
}

// Idioma: aplica o português ao texto fixo da página (ela chega em inglês) e monta o seletor na barra
// do tablet. Trocar de idioma recarrega a página; o link do nome da equipe volta à apresentação no
// mesmo idioma.
function setupLanguage() {
  applyStaticTexts();
  byId('device-home').href = LANG === 'pt' ? './pt.html' : './';
  const holder = byId('device-lang');
  for (const lang of LANGS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = lang.short;
    button.title = lang.label;
    button.lang = lang.id;
    button.setAttribute('aria-label', lang.label);
    button.setAttribute('aria-pressed', String(lang.id === LANG));
    button.addEventListener('click', () => setLang(lang.id));
    holder.append(button);
  }
}

// Inicia sem esperar timer nem quadro: em aba em segundo plano o navegador segura os dois.
// Se a grade de altitude real não carregar, o protótipo abre com o relevo aproximado.
async function start() {
  setupLanguage();
  const loading = byId('loading');
  // O globo carrega em paralelo com o relevo. Sem ele o protótipo segue só com a área mapeada.
  const globeLoading = import('./globo.js').catch((error) => {
    console.warn('Globo de Marte indisponível: o tablet abre direto na área mapeada.', error);
    return null;
  });
  try {
    const elevation = await loadElevation().catch((error) => {
      console.warn(error);
      return null;
    });
    // Sem o arquivo da areia, o protótipo segue sem essa camada e sem esse desvio.
    const sandBits = await loadSandBits().catch((error) => { console.warn(error); return null; });
    boot(elevation, await resolveVisor(), sandBits, await globeLoading);
    loading.hidden = true;
  } catch (error) {
    showFatal(loading, error);
  }
}

start();
