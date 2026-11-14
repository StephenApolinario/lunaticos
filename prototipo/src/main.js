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
import { loadElevation } from './elevation.js';
import { buildPlan } from './route.js';
import { toLocal, toGeo } from './geo.js';
import { mosaicCoverage } from './tiles.js';
import { createRouter } from './pathfind.js';
import { createSafety, ASSUMPTIONS } from './safety.js';
import { createPlanner } from './planner.js';
import { PROTOCOLS, SHELTER_KINDS, protocolFor } from '../data/protocolos.js';
import { byId } from './dom.js';

const TABLET_CAMERA = Object.freeze({ position: [-700, 4300, -5500], target: [0, 300, -250] });
const ORBIT_LIMITS = Object.freeze({ minDistanceM: 150, maxDistanceM: 16000, maxPolarRad: Math.PI * 0.47 });
const FOCUS = Object.freeze({ distanceM: 1300, durationS: 0.9 });
const MAX_FRAME_S = 0.1;
// Clique no mapa: até quantos pixels o ponteiro pode andar sem virar arrasto, e o passo da busca do ponto no relevo.
const PICK = Object.freeze({ clickTolerancePx: 5, stepM: 8, maxM: 40000, refineSteps: 12 });
const OUTSIDE_DATA_NOTICE = 'Escolha um ponto dentro da área fotografada do mapa.';
const RAD_TO_DEG = 180 / Math.PI;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
// Selo sobre o mapa: diz o que é real no que está na tela.
function badgeText({ imagery, relief }) {
  const reliefText = relief === 'real' ? 'relevo real (USGS)' : 'altura do relevo aproximada';
  if (imagery === 'loading') return `Carregando imagem HiRISE… · ${reliefText}`;
  if (imagery === 'ready') return relief === 'real' ? 'Imagem HiRISE e relevo reais (USGS)' : `Imagem HiRISE real · ${reliefText}`;
  return `Imagem HiRISE indisponível · ${reliefText}`;
}

function boot(elevation, visor) {
  const app = byId('app');
  app.dataset.visor = visor.id;
  const stageElement = byId('stage');
  const north = byId('north');
  const badge = byId('map-badge');

  const terrain = createTerrain(elevation);
  const corridor = ['walk', 'car'].flatMap((mode) => buildPlan(mode, true).path.points);
  const scenery = createScenery(terrain, corridor);
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

  // Rotas e segurança calculadas sobre o mesmo campo de altitude do terreno.
  const router = createRouter(terrain.field);
  const safety = createSafety(terrain.field, router);
  const planner = createPlanner(terrain.field, router, safety);
  terrain.setLayerSource('walkback', (x, z) => safety.walkBackAt(x, z));
  terrain.setLayerSource('comms', (x, z) => safety.commsCoverageAt(x, z));
  const withSafety = (base) => Object.freeze({ ...base, safety: safety.assessPlan(base) });

  // Plano para um estado: destino livre (rota calculada na hora) ou a travessia pré-calculada.
  function planFor(next) {
    if (!next.destination) return { plan: withSafety(buildPlan(next.mode, next.includeExtension)), reason: null };
    const result = planner.planTo(next.destination, next.mode, next.routeOption);
    return result.plan ? { plan: withSafety(result.plan), reason: null } : { plan: null, reason: result.reason };
  }

  let state = Object.freeze({
    mode: 'walk', includeExtension: false, layer: 'none', view: 'tablet',
    imagery: 'loading', relief: terrain.isReal ? 'real' : 'approx',
    destination: null, routeOption: 'fast', notice: null,
  });
  let { plan } = planFor(state);
  let tween = null;
  let savedPose = null;

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
  const activeVisor = visor.create({
    mount: byId('visor-mount'),
    stageElement,
    camera: stage.camera,
    terrain,
    overlays,
    onExit: () => setState({ view: 'tablet' }),
    // Segurança calculada sobre o relevo real, para as variantes de visor consumirem.
    safety: Object.freeze({
      walkBackAt: safety.walkBackAt,
      commsAt: safety.commsAt,
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
    onExtensionChange: (includeExtension) => setState({ includeExtension }),
    onLayerChange: (layer) => setState({ layer }),
    onStopFocus: focusOn,
    onEnterVisor: () => setState({ view: 'visor' }),
    // A variante é carregada na abertura da página, então trocar recarrega com ?visor=<id>.
    onRouteOptionChange: (routeOption) => setState({ routeOption }),
    onClearDestination: () => setState({ destination: null }),
    onPlanTo: ({ lat, lon }) => setState({ destination: toLocal(lat, lon) }),
    onVisorChange: (id) => {
      const url = new URL(window.location.href);
      url.searchParams.set('visor', id);
      window.location.assign(url);
    },
  }, { realRelief: terrain.isReal, visors: VISORS, visorId: visor.id });

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
    }
    stage.resize();
  }

  const PLAN_KEYS = ['mode', 'includeExtension', 'destination', 'routeOption'];
  // Só o que de fato muda o plano: com destino livre a extensão não conta; sem ele, o critério da rota não conta.
  const planKey = (s) => (s.destination
    ? `destino|${s.destination.x}|${s.destination.z}|${s.mode}|${s.routeOption}`
    : `travessia|${s.mode}|${s.includeExtension}`);

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
    if (state.layer !== previous.layer || state.view !== previous.view) {
      const isTablet = state.view === 'tablet';
      terrain.paint({ layer: isTablet ? state.layer : 'none', dimOutsideData: isTablet });
    }
    if (state.view !== previous.view) {
      applyView();
      // Na volta ao tablet o foco retorna ao botão de entrada; no visor, cada variante cuida do próprio foco.
      if (state.view === 'tablet') document.querySelector('.cta')?.focus();
    }
    badge.textContent = badgeText(state);
    panel.update(plan, state);
  }

  // Clique (sem arrastar) no mapa escolhe o destino livre.
  const canvas = stage.renderer.domElement;
  const raycaster = new THREE.Raycaster();
  // Vale qualquer ponto dentro da imagem orbital (a parte clara do mapa).
  const insideData = ({ x, z }) => {
    const { lat, lon } = toGeo(x, z);
    return mosaicCoverage(lat, lon, 1) >= 1;
  };

  // Acha onde o raio do clique encontra o relevo: anda em passos e refina por bisseção.
  function pickTerrain(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, stage.camera);
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
    setState(insideData(hit) ? { destination: hit } : { notice: OUTSIDE_DATA_NOTICE });
  });

  overlays.setPlan(plan);
  terrain.paint({ layer: state.layer, dimOutsideData: true });
  applyView();
  badge.textContent = badgeText(state);
  panel.update(plan, state);

  // A foto real chega depois; até lá (ou se faltar algum arquivo) o solo fica procedural.
  loadImagery()
    .then((imagery) => {
      terrain.attachImagery(imagery);
      setState({ imagery: 'ready' });
    })
    .catch((error) => {
      console.warn(error);
      setState({ imagery: 'failed' });
    });

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
    boot(elevation, await resolveVisor());
    loading.hidden = true;
  } catch (error) {
    showFatal(loading, error);
  }
}

start();
