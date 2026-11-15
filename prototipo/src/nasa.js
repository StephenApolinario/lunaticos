// Dados de missão lidos da rede, direto dos serviços públicos da NASA, quando o protótipo abre.
// Cada função devolve a medição e a fonte; se a rede falhar, rejeita e quem chamou mostra o
// valor de reserva de data/medicoes.js, dizendo que é de reserva. Só no navegador.

import { toGeo } from './geo.js';

const DAY_MS = 86400000;
const num = (value) => { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : null; };
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Resposta ${response.status} de ${new URL(url).hostname}.`);
  return response;
}

// ---------- REMS: temperatura e pressão por sol, medidas pelo Curiosity em Gale ----------
const REMS_FEED = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json';
const SEASON_WINDOW_DEG = 10;
const MIN_SEASON_SOLS = 20;
const lsDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Médias dos sols medidos pelo REMS na mesma estação do ano (Ls a até 10° do pedido), em todos os anos da missão.
 * @returns {Promise<{ air: { minC: number, maxC: number }, ground: { minC: number, maxC: number }, pressurePa: number,
 *   sols: number, lastSol: number, windowDeg: number, source: { label: string, url: string } }>}
 */
export async function loadSeasonWeather(lsDeg) {
  const { soles } = await (await fetchOk(REMS_FEED)).json();
  const season = soles.filter((sol) => num(sol.ls) !== null && lsDistance(num(sol.ls), lsDeg) <= SEASON_WINDOW_DEG);
  const column = (key) => season.map((sol) => num(sol[key])).filter((value) => value !== null);
  const columns = ['min_temp', 'max_temp', 'min_gts_temp', 'max_gts_temp', 'pressure'].map(column);
  if (columns.some((values) => values.length < MIN_SEASON_SOLS)) throw new Error('REMS: poucos sols medidos nesta estação.');
  const [airMin, airMax, groundMin, groundMax, pressure] = columns.map(mean);
  return Object.freeze({
    air: Object.freeze({ minC: airMin, maxC: airMax }),
    ground: Object.freeze({ minC: groundMin, maxC: groundMax }),
    pressurePa: pressure,
    sols: season.length,
    lastSol: Math.max(...soles.map((sol) => num(sol.sol) ?? 0)),
    windowDeg: SEASON_WINDOW_DEG,
    source: Object.freeze({ label: 'REMS/Curiosity · NASA/JPL-Caltech/CAB', url: REMS_FEED }),
  });
}

// ---------- RAD: dose absorvida medida pelo Curiosity, série do NASA CCMC ----------
const RAD_HAPI = 'https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/data?id=msl_rad_dosimetry&format=csv';
const RAD_WINDOW_DAYS = 30;
const DOSE_E_COLUMN = 3;

/**
 * Média da dose absorvida (detector de plástico equivalente a tecido) nos últimos 30 dias.
 * @returns {Promise<{ ugyPerDay: number, samples: number, until: Date, days: number, source: { label: string, url: string } }>}
 */
export async function loadRecentDose(now = new Date()) {
  const iso = (date) => `${date.toISOString().slice(0, 19)}Z`;
  const url = `${RAD_HAPI}&time.min=${iso(new Date(now.getTime() - RAD_WINDOW_DAYS * DAY_MS))}&time.max=${iso(now)}`;
  const rows = (await (await fetchOk(url)).text()).trim().split('\n').map((line) => line.split(','));
  const valid = rows.filter((row) => num(row[DOSE_E_COLUMN]) > 0);
  if (valid.length === 0) throw new Error('RAD: sem medições no período.');
  return Object.freeze({
    ugyPerDay: mean(valid.map((row) => num(row[DOSE_E_COLUMN]))),
    samples: valid.length,
    until: new Date(valid[valid.length - 1][0]),
    days: RAD_WINDOW_DAYS,
    source: Object.freeze({ label: 'RAD/Curiosity · NASA CCMC iSWA', url: 'https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/info?id=msl_rad_dosimetry' }),
  });
}

// ---------- THEMIS: infravermelho térmico noturno (Mars Odyssey), servido pelo NASA Mars Trek ----------
// No nível 9 da grade do Trek, um ladrilho só (linha 269, coluna 902) cobre a área de estudo, a cerca de 81 m por pixel.
const THEMIS = Object.freeze({ level: 9, row: 269, col: 902, tilePx: 256 });
const THEMIS_URL = `https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/${THEMIS.level}/${THEMIS.row}/${THEMIS.col}.png`;

/**
 * @returns {Promise<(x: number, z: number) => number>} Brilho (0 a 255) do infravermelho noturno em um
 *   ponto local, ou NaN onde não há dado. É brilho relativo, não temperatura.
 */
export async function loadNightThermal() {
  const bitmap = await createImageBitmap(await (await fetchOk(THEMIS_URL)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = THEMIS.tilePx;
  canvas.height = THEMIS.tilePx;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível para ler a imagem térmica.');
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, THEMIS.tilePx, THEMIS.tilePx);
  const degPerPx = 180 / 2 ** THEMIS.level / THEMIS.tilePx;
  const west = THEMIS.col * degPerPx * THEMIS.tilePx - 180;
  const north = 90 - THEMIS.row * degPerPx * THEMIS.tilePx;
  const at = (col, row) => { const i = (row * THEMIS.tilePx + col) * 4; return data[i + 3] === 0 ? NaN : data[i]; };
  return (x, z) => {
    const { lat, lon } = toGeo(x, z);
    const px = (lon - west) / degPerPx - 0.5;
    const py = (north - lat) / degPerPx - 0.5;
    const col = Math.floor(px);
    const row = Math.floor(py);
    if (col < 0 || row < 0 || col >= THEMIS.tilePx - 1 || row >= THEMIS.tilePx - 1) return NaN;
    const tx = px - col;
    const top = at(col, row) * (1 - tx) + at(col + 1, row) * tx;
    const bottom = at(col, row + 1) * (1 - tx) + at(col + 1, row + 1) * tx;
    return top * (1 - (py - row)) + bottom * (py - row);
  };
}

// ---------- Posição atual do rover Curiosity ----------
const ROVER_POSITION = 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints_current.json';

/**
 * @returns {Promise<{ lat: number, lon: number, elevM: number, sol: number, totalKm: number, live: true }>}
 *   Onde o Curiosity está, do arquivo que alimenta o mapa "Where is Curiosity?" da NASA.
 */
export async function loadRoverPosition() {
  const { features } = await (await fetchOk(ROVER_POSITION)).json();
  const { lat, lon, elev_geoid: elevM, sol, dist_total_m: totalM } = features[0].properties;
  if (![lat, lon, elevM, sol, totalM].every(Number.isFinite)) throw new Error('Posição do rover fora do formato esperado.');
  return Object.freeze({ lat, lon, elevM, sol, totalKm: totalM / 1000, live: true });
}

// ---------- Fotos brutas do Curiosity (Navcam) em um sol ----------
const RAW_IMAGES = 'https://mars.nasa.gov/api/v1/raw_image_items/';
const RAW_IMAGE_HOSTS = Object.freeze(['mars.nasa.gov']);

/**
 * @returns {Promise<Array<{ url: string, sol: number, takenAt: string }>>} Até `limit` fotos da Navcam esquerda no sol dado.
 */
export async function loadSurfaceImages(sol, limit = 4) {
  const query = `?order=sol+desc%2Cdate_taken+desc&per_page=${limit}&page=0&condition_1=msl%3Amission`
    + `&condition_2=${sol}%3Asol%3Agte&condition_3=${sol}%3Asol%3Alte&search=NAV_LEFT_B&extended=thumbnail%3A%3Asample_type%3A%3Anoteq`;
  const { items } = await (await fetchOk(RAW_IMAGES + query)).json();
  return items
    // Itens antigos vêm com o endereço antigo do JPL, que redireciona para mars.nasa.gov.
    .map((item) => ({ url: String(item.https_url).replace('//mars.jpl.nasa.gov/', '//mars.nasa.gov/'), sol: item.sol, takenAt: item.date_taken }))
    // Só https e só o servidor da NASA: o endereço vira `href` e `src` na página.
    .filter((item) => {
      try {
        const { protocol, hostname } = new URL(item.url);
        return protocol === 'https:' && RAW_IMAGE_HOSTS.includes(hostname);
      } catch {
        return false;
      }
    });
}
