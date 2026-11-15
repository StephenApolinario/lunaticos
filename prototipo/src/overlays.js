// Tudo o que vai por cima do terreno: trajeto do Curiosity, rotas, zona de risco,
// pinos das paradas e os feixes de luz que marcam as paradas no modo visor.

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TRACK, STOPS, HAZARD } from '../data/travessia.js';
import { toLocal, lerp } from './geo.js';
import { COLORS } from './config.js';
import { h } from './dom.js';
import { fmtDuration } from './format.js';

const DRAPE_STEP_M = 4;
const LINE_LIFT_M = 0.3;
const HAZARD_RING_SEGMENTS = 96;
const BEACON = Object.freeze({ radiusM: 0.9, heightM: 130, opacity: 0.3 });
const PIN_LIFT_M = Object.freeze({ tablet: 0, visor: 9 });
const TWO_PI = Math.PI * 2;

// Espessura em pixels no tablet e em metros no visor (a linha vira uma faixa no chão,
// mais translúcida, para parecer projetada e não pintada).
const LINE_STYLES = Object.freeze({
  track: { px: 2, meters: 0.12, opacity: 0.7, visorOpacity: 0.5, dash: [14, 22] },
  leg: { px: 4.5, meters: 0.32, opacity: 0.95, visorOpacity: 0.62, dash: null },
  returnLeg: { px: 2.5, meters: 0.22, opacity: 0.85, visorOpacity: 0.55, dash: [26, 34] },
  hazard: { px: 2, meters: 0.3, opacity: 0.9, visorOpacity: 0.8, dash: [18, 14] },
});

// Acompanha o relevo: reamostra a polilinha em passos curtos e lê a altura em cada ponto.
function drape(terrain, points) {
  const positions = [];
  points.forEach((point, i) => {
    if (i > 0) {
      const prev = points[i - 1];
      const steps = Math.ceil(Math.hypot(point.x - prev.x, point.z - prev.z) / DRAPE_STEP_M);
      for (let step = 1; step < steps; step++) {
        const x = lerp(prev.x, point.x, step / steps);
        const z = lerp(prev.z, point.z, step / steps);
        positions.push(x, terrain.heightAt(x, z) + LINE_LIFT_M, z);
      }
    }
    positions.push(point.x, terrain.heightAt(point.x, point.z) + LINE_LIFT_M, point.z);
  });
  return positions;
}

function createLine(positions, color, style) {
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color,
    linewidth: style.px,
    transparent: true,
    opacity: style.opacity,
    dashed: Boolean(style.dash),
    dashSize: style.dash?.[0] ?? 1,
    gapSize: style.dash?.[1] ?? 0,
  });
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.userData.style = style;
  return line;
}

function applyLineView(line, view) {
  const { style } = line.userData;
  const isVisor = view === 'visor';
  line.material.worldUnits = isVisor;
  line.material.linewidth = isVisor ? style.meters : style.px;
  line.material.opacity = isVisor ? style.visorOpacity : style.opacity;
  line.material.needsUpdate = true;
}

function disposeLine(line) {
  line.geometry.dispose();
  line.material.dispose();
}

function hazardRingPoints() {
  const center = toLocal(HAZARD.lat, HAZARD.lon);
  const radiusM = HAZARD.radiusKm * 1000;
  return Array.from({ length: HAZARD_RING_SEGMENTS + 1 }, (_, i) => {
    const angle = (i / HAZARD_RING_SEGMENTS) * TWO_PI;
    return { x: center.x + Math.cos(angle) * radiusM, z: center.z + Math.sin(angle) * radiusM };
  });
}

function createBeacon() {
  const geometry = new THREE.CylinderGeometry(BEACON.radiusM, BEACON.radiusM, BEACON.heightM, 12, 1, true);
  geometry.translate(0, BEACON.heightM / 2, 0);
  const material = new THREE.MeshBasicMaterial({
    color: COLORS.route,
    transparent: true,
    opacity: BEACON.opacity,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  return new THREE.Mesh(geometry, material);
}

function createStopMarker(terrain, stop, onStopClick) {
  const { x, z } = toLocal(stop.lat, stop.lon);
  const groundY = terrain.heightAt(x, z);
  const kinds = { habitat: stop.id === 'H', destination: Boolean(stop.custom), extension: Boolean(stop.ext) };
  const kind = Object.keys(kinds).find((key) => kinds[key]) ?? 'stop';
  const element = h('button', { class: 'pin', type: 'button', title: stop.name, 'aria-label': stop.name, dataset: { kind }, onclick: () => onStopClick(stop) },
    h('span', { class: 'pin-id' }, stop.id),
    h('span', { class: 'pin-label' }),
  );
  const pin = new CSS2DObject(element);
  pin.position.set(x, groundY, z);
  const beacon = createBeacon();
  beacon.position.set(x, groundY, z);
  return { stop, element, pin, beacon, groundY, active: true };
}

function createHazardMarker(terrain) {
  const { x, z } = toLocal(HAZARD.lat, HAZARD.lon);
  const element = h('div', { class: 'pin', role: 'img', title: HAZARD.name, 'aria-label': HAZARD.name, dataset: { kind: 'hazard' } }, h('span', { class: 'pin-id' }, '!'));
  const pin = new CSS2DObject(element);
  pin.position.set(x, terrain.heightAt(x, z), z);
  return pin;
}

/**
 * @param {THREE.Scene} scene
 * @param {{ heightAt: (x: number, z: number) => number }} terrain
 * @param {{ onStopClick: (stop: object) => void }} handlers
 */
export function createOverlays(scene, terrain, handlers) {
  const group = new THREE.Group();
  scene.add(group);

  const trackPoints = TRACK.map(([lat, lon]) => toLocal(lat, lon));
  const fixedLines = [
    createLine(drape(terrain, trackPoints), COLORS.rover, LINE_STYLES.track),
    createLine(drape(terrain, hazardRingPoints()), COLORS.hazard, LINE_STYLES.hazard),
  ];
  const markers = STOPS.map((stop) => createStopMarker(terrain, stop, handlers.onStopClick));
  group.add(...fixedLines, createHazardMarker(terrain), ...markers.flatMap((marker) => [marker.pin, marker.beacon]));

  let routeLines = [];
  let view = 'tablet';
  let waypointMarkers = [];
  let roverPin = null;

  /** Marca no mapa onde o rover Curiosity está, pela posição publicada pela NASA. */
  function setRover({ lat, lon, sol }) {
    const { x, z } = toLocal(lat, lon);
    if (!roverPin) {
      const element = h('div', { class: 'pin', role: 'img', dataset: { kind: 'rover' } }, h('span', { class: 'pin-id' }, 'R'), h('span', { class: 'pin-label' }, 'Curiosity'));
      roverPin = new CSS2DObject(element);
      group.add(roverPin);
    }
    const title = `Rover Curiosity · posição publicada pela NASA (sol ${sol})`;
    roverPin.element.title = title;
    roverPin.element.setAttribute('aria-label', title);
    roverPin.position.set(x, terrain.heightAt(x, z), z);
  }

  let astronautPin = null;
  /**
   * Marca no mapa do tablet onde o astronauta está na saída em andamento, ou tira a marca (null).
   * A posição é simulada (ele anda sobre a rota no visor), e o rótulo diz isso.
   * @param {{ x: number, z: number, elapsedH: number } | null} spot
   */
  function setAstronaut(spot) {
    if (!spot) {
      if (astronautPin) astronautPin.visible = false;
      return;
    }
    if (!astronautPin) {
      const element = h('div', { class: 'pin', role: 'img', dataset: { kind: 'astronaut' } }, h('span', { class: 'pin-label' }));
      astronautPin = new CSS2DObject(element);
      group.add(astronautPin);
    }
    const title = `Astronauta · ${fmtDuration(spot.elapsedH)} de saída · posição simulada`;
    astronautPin.element.title = title;
    astronautPin.element.setAttribute('aria-label', title);
    astronautPin.element.querySelector('.pin-label').textContent = title;
    astronautPin.position.set(spot.x, terrain.heightAt(spot.x, spot.z), spot.z);
    astronautPin.visible = true;
  }

  // Cada ponto da rota livre (A, B, C…) ganha um pino próprio, refeito a cada mudança da rota.
  function syncWaypointMarkers(plan) {
    for (const marker of waypointMarkers) {
      group.remove(marker.pin, marker.beacon);
      marker.beacon.geometry.dispose();
      marker.beacon.material.dispose();
      marker.element.remove();
      markers.splice(markers.indexOf(marker), 1);
    }
    waypointMarkers = plan.isCustom ? plan.stops.map(({ stop }) => createStopMarker(terrain, stop, handlers.onStopClick)) : [];
    markers.push(...waypointMarkers);
    if (waypointMarkers.length > 0) group.add(...waypointMarkers.flatMap((marker) => [marker.pin, marker.beacon]));
  }

  function setPlan(plan) {
    routeLines.forEach((line) => { group.remove(line); disposeLine(line); });
    const modeColor = plan.mode === 'walk' ? COLORS.route : COLORS.vehicle;
    const toPoints = (leg) => leg.coords.map(([lat, lon]) => toLocal(lat, lon));
    routeLines = [
      ...plan.legs.map((leg) => createLine(drape(terrain, toPoints(leg)), leg.blocked ? COLORS.hazard : modeColor, LINE_STYLES.leg)),
      createLine(drape(terrain, toPoints(plan.returnLeg)), modeColor, LINE_STYLES.returnLeg),
    ];
    routeLines.forEach((line) => { applyLineView(line, view); group.add(line); });
    syncWaypointMarkers(plan);

    const activeIds = new Set(['H', ...plan.stops.map((entry) => entry.stop.id)]);
    for (const marker of markers) {
      marker.active = activeIds.has(marker.stop.id);
      marker.element.dataset.off = String(!marker.active);
      marker.element.dataset.mode = plan.mode;
      marker.beacon.material.color.set(modeColor);
    }
    applyMarkerView();
  }

  function applyMarkerView() {
    for (const marker of markers) {
      marker.pin.position.y = marker.groundY + PIN_LIFT_M[view];
      // No visor os pinos são só indicadores: não clicam, então saem da ordem de tabulação.
      marker.element.tabIndex = view === 'tablet' ? 0 : -1;
      marker.beacon.visible = view === 'visor' && marker.active && marker.stop.id !== 'H';
    }
  }

  /** @param {'tablet'|'visor'} nextView */
  function setView(nextView) {
    view = nextView;
    [...fixedLines, ...routeLines].forEach((line) => applyLineView(line, view));
    applyMarkerView();
    if (view === 'tablet') setNextStop(null, '');
  }

  // No visor, só a próxima parada mostra rótulo com a distância.
  function setNextStop(stopId, labelText) {
    for (const marker of markers) {
      const isNext = marker.stop.id === stopId;
      marker.element.dataset.next = String(isNext);
      const label = marker.element.querySelector('.pin-label');
      const text = isNext ? labelText : '';
      if (label && label.textContent !== text) label.textContent = text;
    }
  }

  return Object.freeze({ setPlan, setView, setNextStop, setRover, setAstronaut });
}
