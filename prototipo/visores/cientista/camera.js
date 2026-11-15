// Câmera em primeira pessoa sobre a rota, com o olhar livre ao arrastar.
// Lógica copiada do visor base (../base/visor.js), que é somente leitura para as variantes.

import { angleDeltaDeg, clamp } from '../../src/geo.js';
import { samplePath, headingAt } from '../../src/route.js';

const DEG = Math.PI / 180;
const EYE_HEIGHT_M = Object.freeze({ walk: 1.7, car: 2.4 });
const MIN_CLEARANCE_M = 1;
const CAMERA = Object.freeze({ basePitchDeg: -5, slopePitchFactor: 0.5, baseTurnRate: 2, turnRatePerMps: 0.125, heightRate: 6 });
const LOOK = Object.freeze({ degPerPx: 0.18, maxYawDeg: 120, maxPitchDeg: 45, returnDelayS: 1.5, returnRate: 2.2 });

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

/**
 * @param {import('three').PerspectiveCamera} camera
 * @param {HTMLElement} stageElement
 * @param {() => boolean} isActive
 */
export function createCameraRig(camera, stageElement, isActive) {
  let smoothedHeading = 0;
  let cameraY = 0;
  let look = Object.freeze({ yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0, lastX: 0, lastY: 0 });

  function reset(plan, terrain) {
    look = Object.freeze({ ...look, yawDeg: 0, pitchDeg: 0, dragging: false, idleS: 0 });
    smoothedHeading = headingAt(plan.path, 0);
    const origin = samplePath(plan.path, 0);
    cameraY = terrain.probe(origin.x, origin.z).y + EYE_HEIGHT_M[plan.mode];
  }

  // Depois de um tempo sem arrastar, o olhar volta devagar para a frente.
  function settleLook(dtS) {
    if (look.dragging) return;
    const idleS = look.idleS + dtS;
    const keep = idleS > LOOK.returnDelayS ? Math.exp(-dtS * LOOK.returnRate) : 1;
    look = Object.freeze({ ...look, idleS, yawDeg: look.yawDeg * keep, pitchDeg: look.pitchDeg * keep });
  }

  /** Posiciona a câmera e devolve o rumo para onde ela olha, em graus. */
  function apply(readout, ground, state, dtS) {
    settleLook(dtS);
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
    // As matrizes ficam prontas aqui porque os marcadores de perigo são projetados antes do render.
    camera.updateMatrixWorld();
    return normalizeDeg(smoothedHeading + look.yawDeg);
  }

  stageElement.addEventListener('pointerdown', (event) => {
    // Toque em painel, botão ou campo não vira arrasto de câmera.
    if (!isActive() || event.target.closest('[data-ui]')) return;
    look = Object.freeze({ ...look, dragging: true, lastX: event.clientX, lastY: event.clientY });
    stageElement.setPointerCapture(event.pointerId);
  });
  stageElement.addEventListener('pointermove', (event) => {
    if (!isActive() || !look.dragging) return;
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

  return Object.freeze({ reset, apply });
}
