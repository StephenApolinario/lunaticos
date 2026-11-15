// Extrai do modelo de elevação real do Gale a janela usada pelo protótipo.
//
// Fonte: MSL Gale Merged DEM 1 m, versão 3 (Calef & Parker, USGS Astrogeology / JPL-Caltech / NASA).
//   https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m
// O arquivo tem 3,6 GB, mas é lido por faixas: só as linhas da janela são baixadas.
//
// Uso (dentro de prototipo/tools):  npm install && npm run extrair-dem
// Saída: ../assets/elevation/monte-sharp.u16 (altitudes) e monte-sharp.json (como interpretar).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fromUrl, getDecoder } from 'geotiff';
import { toGeo } from '../src/geo.js';

const SOURCE_URL = 'https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif';
const OUTPUT_DIR = new URL('../assets/elevation/', import.meta.url);
// Linhas já baixadas ficam guardadas aqui, para uma nova execução continuar de onde parou.
const CACHE_DIR = new URL('./.cache/', import.meta.url);

// Mesma janela do terreno do protótipo (metros em torno da origem local), em células de 8 m.
const GRID = Object.freeze({ halfWidth: 3200, halfDepth: 4200, cellM: 8 });
// Cada célula é a média de duas linhas do DEM (a 2 m do centro) por 8 colunas: suaviza sem baixar tudo.
const ROW_OFFSETS = Object.freeze([-2, 2]);
const COLUMN_SPAN = 8;
const CONCURRENCY = 16;
const MAX_ATTEMPTS = 6;
const RETRY_BASE_MS = 500;
const UINT16_MAX = 65535;
const DEG = Math.PI / 180;

const cols = (GRID.halfWidth * 2) / GRID.cellM + 1;
const rows = (GRID.halfDepth * 2) / GRID.cellM + 1;

async function openDem() {
  // O endereço público redireciona para o armazenamento do USGS; resolve uma vez só.
  const head = await fetch(SOURCE_URL, { method: 'HEAD' });
  if (!head.ok) throw new Error(`Fonte indisponível: HTTP ${head.status}`);
  const tiff = await fromUrl(head.url);
  const image = await tiff.getImage();
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  const radius = image.getGeoKeys().GeogSemiMajorAxisGeoKey;
  const directory = image.fileDirectory;
  if (directory.RowsPerStrip !== 1) throw new Error('Formato inesperado: o DEM deveria ter uma linha por faixa.');
  return {
    url: head.url,
    directory,
    decoder: await getDecoder(directory),
    width: image.getWidth(),
    noData: image.getGDALNoData(),
    // Projeção equirretangular com meridiano central 0: x = R·lon, y = R·lat.
    colOf: (lon) => (lon * DEG * radius - originX) / resX,
    rowOf: (lat) => (lat * DEG * radius - originY) / resY,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Baixa um trecho do arquivo, tentando de novo com espera crescente se a rede falhar.
async function fetchRange(url, offset, length) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (response.status !== 206) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== length) throw new Error(`recebidos ${buffer.byteLength} de ${length} bytes`);
      return buffer;
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw new Error(`Trecho em ${offset} falhou após ${attempt} tentativas: ${error.message}`);
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
}

// Uma linha do DEM já reduzida às colunas da grade (média de COLUMN_SPAN pixels por célula).
// Cada linha é uma faixa comprimida do arquivo: baixa só ela e descomprime.
async function readRow(dem, demRow, columnStarts) {
  const cacheFile = new URL(`linha-${demRow}.f32`, CACHE_DIR);
  try {
    const cached = await readFile(cacheFile);
    if (cached.byteLength === columnStarts.length * 4) return new Float32Array(cached.buffer, cached.byteOffset, columnStarts.length).slice();
  } catch {
    // Sem cache para esta linha: baixa normalmente.
  }
  const reduced = await downloadRow(dem, demRow, columnStarts);
  await writeFile(cacheFile, Buffer.from(reduced.buffer));
  return reduced;
}

async function downloadRow(dem, demRow, columnStarts) {
  const compressed = await fetchRange(dem.url, dem.directory.StripOffsets[demRow], dem.directory.StripByteCounts[demRow]);
  // Algumas faixas não trazem o marcador de fim e descomprimem com um valor sobrando: só os primeiros contam.
  const values = new Float32Array(await dem.decoder.decode(dem.directory, compressed));
  if (values.length < dem.width) throw new Error(`Linha ${demRow} veio com ${values.length} valores, esperava ${dem.width}.`);
  return Float32Array.from(columnStarts, (start) => {
    let sum = 0;
    let count = 0;
    for (let c = start; c < start + COLUMN_SPAN; c++) {
      const value = values[c];
      if (value !== dem.noData && Number.isFinite(value)) { sum += value; count += 1; }
    }
    return count > 0 ? sum / count : NaN;
  });
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
      done += 1;
      if (done % 200 === 0) process.stdout.write(`  ${done}/${items.length} linhas\n`);
    }
  }
  await Promise.all(Array.from({ length: limit }, run));
  return results;
}

await mkdir(CACHE_DIR, { recursive: true });
const dem = await openDem();
const columnStarts = Array.from({ length: cols }, (_, i) => {
  const { lon } = toGeo(-GRID.halfWidth + i * GRID.cellM, 0);
  return Math.round(dem.colOf(lon)) - COLUMN_SPAN / 2;
});
const centerRows = Array.from({ length: rows }, (_, j) => {
  const { lat } = toGeo(0, -GRID.halfDepth + j * GRID.cellM);
  return Math.round(dem.rowOf(lat));
});
const demRows = [...new Set(centerRows.flatMap((row) => ROW_OFFSETS.map((offset) => row + offset)))];
process.stdout.write(`Lendo ${demRows.length} linhas do DEM (colunas ${columnStarts[0]} a ${columnStarts[cols - 1] + COLUMN_SPAN})\n`);

const reduced = new Map();
const rowValues = await mapPool(demRows, CONCURRENCY, (demRow) => readRow(dem, demRow, columnStarts));
demRows.forEach((demRow, i) => reduced.set(demRow, rowValues[i]));

const elevations = new Float32Array(cols * rows);
let missing = 0;
for (let j = 0; j < rows; j++) {
  const sources = ROW_OFFSETS.map((offset) => reduced.get(centerRows[j] + offset));
  for (let i = 0; i < cols; i++) {
    const valid = sources.map((source) => source[i]).filter(Number.isFinite);
    if (valid.length === 0) missing += 1;
    elevations[j * cols + i] = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : NaN;
  }
}
if (missing > 0) throw new Error(`${missing} células sem dado na janela: revise os limites antes de usar.`);

let min = Infinity;
let max = -Infinity;
for (const value of elevations) { min = Math.min(min, value); max = Math.max(max, value); }
const stepM = (max - min) / UINT16_MAX;
const packed = Uint16Array.from(elevations, (value) => Math.round((value - min) / stepM));

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(new URL('monte-sharp.u16', OUTPUT_DIR), Buffer.from(packed.buffer));
await writeFile(new URL('monte-sharp.json', OUTPUT_DIR), `${JSON.stringify({
  source: 'MSL Gale Merged DEM 1 m v3 (Calef & Parker, USGS Astrogeology / JPL-Caltech / NASA)',
  sourceUrl: 'https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m',
  file: 'monte-sharp.u16',
  encoding: 'uint16 little-endian; altitude = elevMinM + valor * elevStepM',
  cols,
  rows,
  cellM: GRID.cellM,
  halfWidthM: GRID.halfWidth,
  halfDepthM: GRID.halfDepth,
  elevMinM: min,
  elevStepM: stepM,
}, null, 2)}\n`);
process.stdout.write(`ok: ${cols} x ${rows} células de ${GRID.cellM} m, altitude de ${min.toFixed(1)} a ${max.toFixed(1)} m\n`);
