// Diário da saída: amostras, chegadas, perigos e emergências, com hora da missão e posição.
// Vive só durante a saída e pode ser exportado em texto.
//
// Módulo independente do HUD: a lógica é pura e roda no Node. Só `downloadText` usa o
// navegador, e só quando é chamada.

import { fmtClock, fmtDuration, fmtNumber } from '../../src/format.js';
import { t } from '../../src/i18n.js';

export const MAX_NOTE_CHARS = 280;
export const EXPORT_FILE = t`diario-da-saida.txt`;

const ENTRY_LABELS = Object.freeze({
  saida: t('Saída', 'registro do diário'), chegada: t`Chegada`, amostra: t`Amostra`, perigo: t('Perigo', 'registro do diário'), emergencia: t`Emergência`,
});
const REVOKE_DELAY_MS = 10000;

function computeStats(entries) {
  const samples = entries.filter((entry) => entry.kind === 'amostra');
  const samplesByStop = {};
  for (const sample of samples) {
    if (sample.stopId) samplesByStop[sample.stopId] = (samplesByStop[sample.stopId] ?? 0) + 1;
  }
  return Object.freeze({
    entries: entries.length,
    samples: samples.length,
    hazardReports: entries.filter((entry) => entry.kind === 'perigo').length,
    samplesByStop: Object.freeze(samplesByStop),
    lastSample: samples.at(-1)?.text ?? '',
  });
}

/**
 * Diário em memória.
 * `record(kind, text, moment, stopId)` registra um fato no instante `moment`, que é qualquer
 * objeto com `{ elapsedH, clockH, position: { lat, lon, elevM } }` (o contexto do assistente serve).
 * `kind`: 'saida' | 'chegada' | 'amostra' | 'perigo' | 'emergencia'.
 */
export function createJournal() {
  let entries = [];
  let stats = computeStats(entries);
  const add = (entry) => {
    entries = [...entries, Object.freeze({ ...entry })];
    stats = computeStats(entries);
  };
  const record = (kind, text, moment, stopId = null) => {
    const { lat, lon, elevM } = moment.position;
    add({ kind, text, stopId, elapsedH: moment.elapsedH, clockH: moment.clockH, position: { lat, lon, elevM } });
  };
  // Observação vazia vira "Sem observação."; devolve a observação limpa, para quem chama comentar.
  const recordSample = (note, moment, stopId = null) => {
    const text = String(note ?? '').trim().slice(0, MAX_NOTE_CHARS);
    record('amostra', text || t`Sem observação.`, moment, stopId);
    return text;
  };
  return Object.freeze({ add, record, recordSample, entries: () => entries, stats: () => stats });
}

export const entryLabel = (kind) => ENTRY_LABELS[kind] ?? t`Registro`;
export const fmtPosition = ({ lat, lon, elevM }) => `lat ${fmtNumber(lat, 5)}, lon ${fmtNumber(lon, 5)}, alt ${fmtNumber(elevM)} m`;
export const fmtStamp = ({ elapsedH, clockH }) => `${fmtDuration(elapsedH)} · ${fmtClock(clockH)}`;

function entryLine(entry) {
  const kind = entryLabel(entry.kind).toUpperCase();
  const what = entry.stopId ? t`${kind} · parada ${entry.stopId}` : kind;
  return `[${fmtStamp(entry)}] ${what} · ${fmtPosition(entry.position)} · ${entry.text}`;
}

/**
 * Texto do diário para exportar.
 * @param {string} planLabel Descrição do plano, por exemplo "a pé, 3 paradas".
 * @param {ReadonlyArray<object>} entries `journal.entries()`.
 * @param {ReadonlyArray<string>} [hazardLines] Uma linha por perigo relatado guardado (opcional).
 */
export function journalToText(planLabel, entries, hazardLines = []) {
  return [
    t`DIÁRIO DA SAÍDA · cratera Gale, Marte (protótipo)`,
    t`Plano: ${planLabel}`,
    t`Posições e altitudes: rotas calculadas sobre o MSL Gale Merged DEM (USGS Astrogeology / JPL-Caltech / NASA).`,
    t`Hora local: calculada (algoritmo Mars24 da NASA) a partir da hora de partida escolhida. Taxa de radiação: média medida pelo RAD do Curiosity.`,
    t`Temperatura: estimada entre os extremos medidos pelo REMS. Telemetria do traje e emergências: SIMULADAS.`,
    '',
    t`REGISTROS [tempo de saída · hora local]`,
    ...(entries.length ? entries.map(entryLine) : [t`(nenhum registro)`]),
    '',
    t`PERIGOS RELATADOS GUARDADOS NESTE NAVEGADOR (${hazardLines.length})`,
    ...(hazardLines.length ? hazardLines.map((line) => `- ${line}`) : [t`(nenhum)`]),
    '',
  ].join('\n');
}

/** Baixa um texto como arquivo. Só no navegador. */
export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // Fora do documento o clique não baixa em todos os navegadores.
  document.body.append(link);
  link.click();
  link.remove();
  // O navegador ainda está lendo o blob quando o clique retorna.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
