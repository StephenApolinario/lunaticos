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
import { loadElevation } from './elevation.js';
import { buildPlan } from './route.js';
import { toLocal, toGeo, ORIGIN } from './geo.js';
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

const TABLET_CAMERA = Object.freeze({ position: [-700, 4300, -5500], target: [0, 300, -250] });
const ORBIT_LIMITS = Object.freeze({ minDistanceM: 150, maxDistanceM: 16000, maxPolarRad: Math.PI * 0.47 });
const FOCUS = Object.freeze({ distanceM: 1300, durationS: 0.9 });
const MAX_FRAME_S = 0.1;
// Hora solar local em que o mapa abre, e de quanto em quanto a luz é refeita enquanto o relógio do visor anda.
const DEFAULT_HOUR_H = 10;
const SUN_STEP_H = 1 / 60;
const FOCUS_REFRESH_S = 0.15;
// Clique no mapa: até quantos pixels o ponteiro pode andar sem virar arrasto, e o passo da busca do ponto no relevo.
const PICK = Object.freeze({ clickTolerancePx: 5, stepM: 8, maxM: 40000, refineSteps: 12 });
const OUTSIDE_DATA_NOTICE = 'Escolha um ponto dentro da área fotografada do mapa.';
const RAD_TO_DEG = 180 / Math.PI;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
// Selo sobre o mapa: diz o que é real no que está na tela.
function badgeText({ imagery, relief, detail }) {
  const reliefText = relief === 'real' ? 'relevo real (USGS)' : 'altura do relevo aproximada';
  if (imagery === 'loading') return `Carregando imagem HiRISE… · ${reliefText}`;
  if (imagery === 'ready') {
    const base = relief === 'real' ? 'Imagem HiRISE e relevo reais (USGS)' : `Imagem HiRISE real · ${reliefText}`;
    if (detail === 'offline') return `${base} · sem rede para o detalhe fino`;
    return detail ? `${base} · detalhe de ${detail} por pixel` : base;
  }
  return `Imagem HiRISE indisponível · ${reliefText}`;
}

function boot(elevation, visor, sandBits) {
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
  if (new URLSearchParams(window.location.search).has('debug')) window.lunaticos = { camera: stage.camera, controls };

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
    // Medições lidas da NASA: undefined enquanto carregam, null se a rede falhar.
    weather: undefined, dose: undefined,
  });
  let { plan } = planFor(state);
  let tween = null;
  let savedPose = null;

  // Estação de hoje em Marte (longitude solar), que define o caminho do Sol no céu.
  const lsDeg = solarLongitudeDeg(julianDateTT(new Date()));
  let sunHourH = null;
  // Põe o Sol na posição da hora dada. No visor é chamado a cada quadro, então só refaz a luz a cada minuto.
  function applySun(hourH, force = false) {
    if (!force && sunHourH !== null && Math.abs(hourH - sunHourH) < SUN_STEP_H) return;
    sunHourH = hourH;
    stage.setSun(sunAt(ORIGIN.lat, lsDeg, hourH));
  }

  // Leva a câmera do tablet até uma parada, mantendo o ângulo atual.
  function focusOn(stop) {
    if (state.view !== 'tablet') return;
    const { x, z } = toLocal(stop.lat, stop.lon);
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
    const eased = easeOutCubic(Math.min(1, elapsedS / FOCUS.durationS));
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
    stage.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    tween = elapsedS >= FOCUS.durationS ? null : Object.freeze({ ...tween, elapsedS });
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
    onExit: () => setState({ view: 'tablet' }),
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
  }, { realRelief: terrain.isReal, visors: VISORS, visorId: visor.id, lsDeg });

  function applyView() {
    const isVisor = state.view === 'visor';
    app.dataset.view = state.view;
    stage.setView(state.view);
    overlays.setView(state.view);
    controls.enabled = !isVisor;
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
    stage.resize();
  }

  const PLAN_KEYS = ['mode', 'includeExtension', 'waypoints'];
  // Só o que de fato muda o plano: na rota livre a extensão não conta.
  const planKey = (s) => (s.waypoints.length > 0
    ? `livre|${s.waypoints.map((point) => `${point.x},${point.z}`).join(';')}|${s.mode}`
    : `travessia|${s.mode}|${s.includeExtension}`);

  // Acrescenta um ponto ao fim da rota livre (A, B, C…).
  function addWaypoint(point) {
    if (state.waypoints.length >= MAX_WAYPOINTS) {
      setState({ notice: `A rota livre aceita até ${MAX_WAYPOINTS} pontos. Remova um para escolher outro.` });
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
      if (plan.startClockH !== state.hourH) plan = Object.freeze({ ...plan, startClockH: state.hourH });
      applySun(state.hourH, true);
    }
    if (state.layer !== previous.layer || state.view !== previous.view) {
      const isTablet = state.view === 'tablet';
      // A camada do visor é dele: uma saída nova a zera (onLayer), uma saída retomada a mantém.
      terrain.paint({ layer: isTablet ? state.layer : visorLayer, dimOutsideData: isTablet });
    }
    if (state.view !== previous.view) {
      applyView();
      // Na volta ao tablet o foco retorna ao botão de entrada; no visor, cada variante cuida do próprio foco.
      if (state.view === 'tablet') document.querySelector('.cta')?.focus();
    }
    badge.textContent = badgeText(state);
    panel.update(plan, state);
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
  function updateDetail(dtS) {
    if (!detail) return;
    // O grão do chão de perto só faz sentido na altura dos olhos.
    detail.setGrain(state.view === 'visor');
    const eye = stage.camera.position;
    if (state.view === 'visor') {
      detail.update(eye, 0, dtS);
      return;
    }
    focusAgeS += dtS;
    if (!tabletFocus || focusAgeS >= FOCUS_REFRESH_S) {
      tabletFocus = groundUnder(0, 0) ?? { x: controls.target.x, z: controls.target.z };
      focusAgeS = 0;
    }
    const { x, z } = tabletFocus;
    detail.update(tabletFocus, Math.hypot(eye.x - x, eye.y - terrain.heightAt(x, z), eye.z - z), dtS);
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
    if (!start || start.id !== event.pointerId || state.view !== 'tablet') return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > PICK.clickTolerancePx) return;
    const hit = pickTerrain(event.clientX, event.clientY);
    if (!hit) return;
    if (insideData(hit)) addWaypoint(hit);
    else setState({ notice: OUTSIDE_DATA_NOTICE });
  });

  overlays.setPlan(plan);
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
      setState({ imagery: 'ready' });
    })
    .catch((error) => {
      console.warn(error);
      setState({ imagery: 'failed' });
    });

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
  const showPlannerHealth = (health) => panel.setAssistantNote(health.ok ? engineLabel(health) : 'fora do ar');
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

  new ResizeObserver(() => stage.resize()).observe(stageElement);

  let lastMs = performance.now();
  function frame(nowMs) {
    const dtS = Math.min((nowMs - lastMs) / 1000, MAX_FRAME_S);
    lastMs = nowMs;
    if (state.view === 'visor') {
      activeVisor.frame(dtS);
    } else {
      stepTween(dtS);
      controls.update();
      north.style.transform = `rotate(${controls.getAzimuthalAngle() * RAD_TO_DEG}deg)`;
    }
    updateDetail(dtS);
    stage.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function showFatal(loading, error) {
  const reason = error instanceof Error ? error.message : 'erro desconhecido';
  loading.hidden = false;
  loading.dataset.state = 'error';
  loading.textContent = `Não foi possível iniciar o mapa 3D: ${reason}`;
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

// Inicia sem esperar timer nem quadro: em aba em segundo plano o navegador segura os dois.
// Se a grade de altitude real não carregar, o protótipo abre com o relevo aproximado.
async function start() {
  const loading = byId('loading');
  try {
    const elevation = await loadElevation().catch((error) => {
      console.warn(error);
      return null;
    });
    // Sem o arquivo da areia, o protótipo segue sem essa camada e sem esse desvio.
    const sandBits = await loadSandBits().catch((error) => { console.warn(error); return null; });
    boot(elevation, await resolveVisor(), sandBits);
    loading.hidden = true;
  } catch (error) {
    showFatal(loading, error);
  }
}

start();
