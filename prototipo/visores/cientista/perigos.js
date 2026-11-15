// Relato de perigos pelo astronauta, no estilo Waze: marca onde está, guarda para as
// próximas saídas e avisa ao se aproximar de um perigo já relatado.
//
// Módulo independente do HUD: lógica pura, roda no Node. O armazenamento entra por
// parâmetro (qualquer objeto com getItem/setItem; por padrão, o localStorage).

import { toLocal, headingDeg, angleDeltaDeg } from '../../src/geo.js';
import { fmtDistance, fmtNumber } from '../../src/format.js';

export const HAZARD_TYPES = Object.freeze({
  rocha: 'Rocha cortante',
  areia: 'Areia fofa',
  declive: 'Declive',
  outro: 'Outro perigo',
});
export const HAZARD_STORAGE_KEY = 'lunaticos.cientista.perigos.v1';
export const MAX_HAZARD_NOTE_CHARS = 280;
export const HAZARD_WARNING = Object.freeze({ minM: 8, warnM: 150 });

const MAX_HAZARDS = 200;
const MAX_LISTED = 12;
const AHEAD_CONE_DEG = 30;
const BEHIND_CONE_DEG = 150;
const FRONT_HALF_DEG = 100;
const LAT_LIMIT = 90;
const LON_LIMIT = 360;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const shortText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Navegação privada ou política do navegador podem negar o acesso.
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// O conteúdo do armazenamento é dado de fora: só entra o que tem o formato esperado.
function sanitizeHazard(raw) {
  if (!raw || typeof raw !== 'object' || !Object.hasOwn(HAZARD_TYPES, raw.type)) return null;
  if (![raw.lat, raw.lon, raw.elevM].every(isNumber)) return null;
  if (Math.abs(raw.lat) > LAT_LIMIT || Math.abs(raw.lon) > LON_LIMIT) return null;
  return Object.freeze({
    id: shortText(raw.id, 40) || newId(),
    type: raw.type,
    lat: raw.lat,
    lon: raw.lon,
    elevM: raw.elevM,
    ...toLocal(raw.lat, raw.lon),
    note: shortText(raw.note, MAX_HAZARD_NOTE_CHARS).trim(),
    outing: shortText(raw.outing, 40),
    missionH: isNumber(raw.missionH) ? raw.missionH : 0,
    createdAt: shortText(raw.createdAt, 30),
  });
}

function load(storage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(HAZARD_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.map(sanitizeHazard).filter(Boolean).slice(-MAX_HAZARDS) : [];
  } catch {
    // Dado corrompido: começa vazio em vez de derrubar o visor.
    return [];
  }
}

function save(storage, hazards) {
  if (!storage) return false;
  try {
    // x e z são derivados de lat/lon na leitura, então não vão para o disco.
    storage.setItem(HAZARD_STORAGE_KEY, JSON.stringify(hazards.map(({ x, z, ...rest }) => rest)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Perigos relatados, com persistência.
 * @param {{ getItem: (key: string) => string|null, setItem: (key: string, value: string) => void } | null} [storage]
 */
export function createHazardStore(storage = defaultStorage()) {
  let hazards = load(storage);
  return Object.freeze({
    list: () => hazards,
    /** Relê do armazenamento (início de uma saída nova). */
    reload() {
      hazards = load(storage);
      return hazards;
    },
    /**
     * Relata um perigo em `position`.
     * @param {{ type: string, note?: string, position: { lat: number, lon: number, elevM: number }, outing: string, missionH: number }} report
     * @returns {{ hazard: object|null, saved: boolean }} `hazard` nulo se o tipo ou a posição forem inválidos;
     *   `saved` falso se não deu para gravar (quem chama avisa o astronauta).
     */
    report({ type, note = '', position, outing, missionH }) {
      const hazard = sanitizeHazard({
        id: newId(), type, note: String(note ?? ''), outing, missionH,
        lat: position.lat, lon: position.lon, elevM: position.elevM,
        createdAt: new Date().toISOString(),
      });
      if (!hazard) return { hazard: null, saved: false };
      hazards = [...hazards, hazard].slice(-MAX_HAZARDS);
      return { hazard, saved: save(storage, hazards) };
    },
    /** @returns {boolean} Se a lista sem o item foi gravada. */
    remove(id) {
      hazards = hazards.filter((hazard) => hazard.id !== id);
      return save(storage, hazards);
    },
  });
}

/** Uma linha de texto por perigo: tipo, posição, nota e data do relato. */
export function describeHazard(hazard) {
  const note = hazard.note ? ` · nota: ${hazard.note}` : '';
  const date = hazard.createdAt ? ` · relatado em ${hazard.createdAt.slice(0, 10)}` : '';
  return `${HAZARD_TYPES[hazard.type]} · lat ${fmtNumber(hazard.lat, 5)}, lon ${fmtNumber(hazard.lon, 5)}, alt ${fmtNumber(hazard.elevM)} m${note}${date}`;
}

function sideOf(relativeDeg) {
  if (Math.abs(relativeDeg) < AHEAD_CONE_DEG) return 'à frente';
  if (Math.abs(relativeDeg) > BEHIND_CONE_DEG) return 'atrás';
  return relativeDeg > 0 ? 'à direita' : 'à esquerda';
}

/**
 * Perigos do mais próximo ao mais distante, com distância e lado em relação ao rumo.
 * @param {ReadonlyArray<object>} hazards Lista de `createHazardStore().list()`.
 * @param {{ x: number, z: number }} here Posição local, em metros.
 * @param {number} heading Rumo em graus (0 = norte, sentido horário).
 * @param {string} outingId Saída atual, para marcar o que veio de saídas anteriores.
 */
export function locateHazards(hazards, here, heading, outingId) {
  return hazards
    .map((hazard) => {
      const dx = hazard.x - here.x;
      const dz = hazard.z - here.z;
      const distM = Math.hypot(dx, dz);
      const relativeDeg = distM > 1 ? angleDeltaDeg(heading, headingDeg(dx, dz)) : 0;
      return {
        id: hazard.id, type: hazard.type, label: HAZARD_TYPES[hazard.type], note: hazard.note, x: hazard.x, z: hazard.z,
        distM, side: sideOf(relativeDeg), ahead: Math.abs(relativeDeg) < FRONT_HALF_DEG, previous: hazard.outing !== outingId,
      };
    })
    .sort((a, b) => a.distM - b.distM)
    .slice(0, MAX_LISTED);
}

/**
 * Aviso de aproximação: o perigo relatado mais próximo que está à frente e dentro do raio.
 * @param {ReadonlyArray<object>} located Saída de `locateHazards`.
 * @returns {{ kind: string, key: string, level: 'atencao', text: string, action: string } | null}
 */
export function hazardWarning(located, { minM, warnM } = HAZARD_WARNING) {
  const hazard = located.find((candidate) => candidate.ahead && candidate.distM >= minM && candidate.distM <= warnM);
  if (!hazard) return null;
  const origin = hazard.previous ? 'Relato de uma saída anterior' : 'Relato desta saída';
  const note = hazard.note ? `: “${hazard.note}”` : '';
  return {
    kind: 'perigo-relatado',
    // Cada perigo é um aviso próprio: o segundo é anunciado mesmo com o primeiro ainda na tela.
    key: `perigo-relatado:${hazard.id}`,
    level: 'atencao',
    text: `Perigo relatado: ${hazard.label.toLowerCase()} a ${fmtDistance(hazard.distM)} ${hazard.side}`,
    action: `${origin}${note}. Passe com cuidado e confirme se o perigo continua lá.`,
  };
}
