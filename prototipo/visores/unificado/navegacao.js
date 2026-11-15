// Peças do Navegador (minimapa, perfil à frente, guia no chão, indicador de borda e rádio à
// frente) alimentadas pela sessão do Guardião. Aqui só mora a cola com o navegador: a análise
// da rota, os desenhos e as contas vêm de ../navegador/ e de guia.js.

import { clamp } from '../../src/geo.js';
import { fmtDistance, fmtNumber, fmtSigned } from '../../src/format.js';
import { COLORS } from '../../src/config.js';
import { analyzePlan, HABITAT } from '../navegador/analise.js';
import { antennaFrom, lineOfSight } from '../navegador/radio.js';
import { radioReading } from '../navegador/leitura.js';
import { createMinimap, ZOOM_RADII_M, DEFAULT_ZOOM } from '../navegador/minimapa.js';
import { createProfile } from '../navegador/perfil.js';
import { createWorldGuide } from '../navegador/mundo.js';
import { guideFor, radioAheadText } from './guia.js';

const PANEL_INTERVAL_S = 0.09;
const RADIO_INTERVAL_S = 0.25;
const GUIDE_LIFT_M = 2;
const NO_RADIO = Object.freeze({ visible: true, clearanceM: Infinity, blockAtM: 0, distM: 0 });

const zoomText = (radiusM) => `raio ${radiusM >= 1000 ? `${fmtNumber(radiusM / 1000, radiusM % 1000 === 0 ? 0 : 1)} km` : `${radiusM} m`}`;

/**
 * @param {{
 *   canvases: { minimap: HTMLCanvasElement, profile: HTMLCanvasElement, world: HTMLCanvasElement },
 *   edge: HTMLElement, camera: import('three').PerspectiveCamera,
 *   terrain: { heightAt: (x: number, z: number) => number },
 *   assumptions: { habitatMastM: number, suitAntennaM: number } | undefined,
 *   onProfile: (caption: string) => void,
 * }} deps `canvases` e `edge` vêm do HUD; `assumptions` de `context.safety`.
 */
export function createNavigation({ canvases, edge, camera, terrain, assumptions, onProfile }) {
  const antenna = antennaFrom(assumptions);
  const mast = Object.freeze({ ...HABITAT, antennaM: antenna.habitat });
  const minimap = createMinimap(canvases.minimap);
  const profile = createProfile(canvases.profile);
  const world = createWorldGuide({ canvas: canvases.world, camera, heightAt: terrain.heightAt, edge });
  const analyses = new WeakMap();

  let plan = null;
  let analysis = null;
  let zoomIndex = DEFAULT_ZOOM;
  let sight = NO_RADIO;
  let timeS = 0;
  let panelWaitS = 0;
  let radioWaitS = 0;

  /** A análise da rota sobre o relevo é feita uma vez por plano e guardada. */
  function setPlan(nextPlan) {
    plan = nextPlan;
    if (!analyses.has(plan)) analyses.set(plan, analyzePlan(plan, terrain, antenna));
    analysis = analyses.get(plan);
    minimap.setPlan(plan, analysis);
    profile.setPlan(plan, analysis);
    sight = NO_RADIO;
    panelWaitS = PANEL_INTERVAL_S;
    radioWaitS = RADIO_INTERVAL_S;
  }

  // A reta antena a antena dá onde está o bloqueio (o X no minimapa). Quem diz se há visada é o
  // Guardião, por `safety.commsAt`, a mesma conta do tablet.
  function readSight(pos, visible) {
    const line = lineOfSight(terrain.heightAt, { x: pos.x, z: pos.z, antennaM: antenna.suit }, mast);
    return line.visible === visible ? line : { ...line, visible, clearanceM: NaN };
  }

  /**
   * Um quadro, depois de a câmera estar no lugar (com `camera.updateMatrixWorld()` chamado).
   * @param {number} dtS
   * @param {object} session Sessão do Guardião com a leitura do quadro.
   * @param {{ headingDeg: number, lookDeg: number }} view Rumo do corpo e para onde o olhar está virado.
   * @param {{ width: number, height: number, free: object }} layout Do HUD.
   * @returns {{ guide: ReturnType<typeof guideFor>, radio: { ahead: string, soon: boolean } }}
   */
  function update(dtS, session, view, layout) {
    const { state, r, pos } = session;
    timeS += dtS;
    radioWaitS += dtS;
    if (radioWaitS >= RADIO_INTERVAL_S) {
      radioWaitS = 0;
      sight = readSight(pos, r.comms.visible);
    }
    const guide = guideFor(analysis, session);
    const reading = radioReading(analysis, state.distM, sight, r.m.speedKmh);

    world.draw({
      analysis,
      distM: state.distM,
      limitM: guide.limitM,
      onFoot: !r.m.driving,
      color: plan.mode === 'walk' ? COLORS.route : COLORS.vehicle,
      timeS,
      eye: camera.position,
      maneuver: guide.maneuver,
      feet: pos,
      rejoin: guide.rejoin,
      cssWidth: layout.width,
      cssHeight: layout.height,
    });
    const { point } = guide;
    world.pointTo(point ? { x: point.x, y: terrain.heightAt(point.x, point.z) + GUIDE_LIFT_M, z: point.z, label: point.label } : null, layout.free);

    // Minimapa e perfil são redesenhados poucas vezes por segundo, e só se algo mudou.
    panelWaitS += dtS;
    if (panelWaitS >= PANEL_INTERVAL_S) {
      panelWaitS = 0;
      minimap.draw({
        x: pos.x, z: pos.z, headingDeg: view.headingDeg, lookDeg: view.lookDeg, distM: state.distM,
        radiusM: ZOOM_RADII_M[zoomIndex], targetId: r.target.stopId ?? '', rejoin: guide.rejoin, radio: sight,
      });
      const ahead = profile.draw(state.distM);
      onProfile(`Perfil à frente · relevo real · ${fmtDistance(ahead.aheadM)} · ${fmtSigned(ahead.gainM)} m · máx. ${fmtSigned(ahead.peakDeg)}°`);
    }
    return { guide, radio: { ahead: radioAheadText(reading), soon: reading.lossSoon } };
  }

  /** Muda o zoom do minimapa: -1 aproxima, +1 afasta. */
  function zoom(delta) {
    zoomIndex = clamp(zoomIndex + delta, 0, ZOOM_RADII_M.length - 1);
    panelWaitS = PANEL_INTERVAL_S;
  }

  return Object.freeze({
    setPlan,
    update,
    zoom,
    zoomState: () => ({ text: zoomText(ZOOM_RADII_M[zoomIndex]), canIn: zoomIndex > 0, canOut: zoomIndex < ZOOM_RADII_M.length - 1 }),
  });
}
