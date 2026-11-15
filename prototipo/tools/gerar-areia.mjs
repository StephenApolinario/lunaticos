// Estima onde há areia escura (fofa) na área do mapa, a partir da cor da imagem HiRISE e do relevo.
//   cd prototipo/tools && node gerar-areia.mjs [arquivo-de-prévia.png]
//
// Na imagem colorida realçada do HiRISE, a areia basáltica aparece escura e azulada. Uma célula da
// grade do relevo (8 m) é marcada como areia quando a imagem ali é escura, mais azul que vermelha e o
// chão é pouco inclinado (sombra de escarpa também é escura, mas fica em declive). Manchas pequenas
// são descartadas. É uma ESTIMATIVA da equipe, não um mapa de areia da NASA: serve para a rota
// preferir outro caminho e para avisar o planejador, e não substitui a leitura do terreno.
//
// Saída: assets/areia/areia.bits (1 bit por célula, na ordem da grade do relevo) e areia.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { fieldFromElevation } from '../src/heightfield.js';
import { toGeo } from '../src/geo.js';
import { MOSAIC, mosaicPixel, tileList } from '../src/tiles.js';

export const SAND_RULE = Object.freeze({
  // Brilho máximo (0 a 255) e quanto o azul passa do vermelho para a célula contar como areia escura.
  maxLuminance: 92,
  minBlueOverRed: 2,
  maxSlopeDeg: 12,
  // Manchas menores que isto (em células de 8 m) são ruído ou sombra solta.
  minPatchCells: 60,
});

const assets = new URL('../assets/', import.meta.url);
const meta = JSON.parse(await readFile(new URL('elevation/monte-sharp.json', assets), 'utf8'));
const packed = await readFile(new URL(`elevation/${meta.file}`, assets));
const field = fieldFromElevation(meta, new Uint16Array(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength)));
const { stride, cellM, halfWidth, halfDepth, gradX, gradZ } = field;
const count = field.heights.length;
const rows = count / stride;

// ---------- imagem colorida inteira ----------
const width = MOSAIC.cols * MOSAIC.tilePx;
const height = MOSAIC.rows * MOSAIC.tilePx;
const rgb = new Uint8Array(width * height * 3);
for (const tile of tileList()) {
  const png = PNG.sync.read(await readFile(new URL(`hirise/${MOSAIC.zoom}/${tile.x}/${tile.y}.png`, assets)));
  for (let y = 0; y < MOSAIC.tilePx; y++) {
    for (let x = 0; x < MOSAIC.tilePx; x++) {
      const from = (y * png.width + x) * 4;
      const to = ((tile.row * MOSAIC.tilePx + y) * width + tile.col * MOSAIC.tilePx + x) * 3;
      rgb[to] = png.data[from];
      rgb[to + 1] = png.data[from + 1];
      rgb[to + 2] = png.data[from + 2];
    }
  }
}

// Cor média da imagem em volta de um ponto (3 x 3 pixels, perto do tamanho de uma célula do relevo).
function colorAt(px, py) {
  const cx = Math.round(px);
  const cy = Math.round(py);
  if (cx < 1 || cy < 1 || cx >= width - 1 || cy >= height - 1) return null;
  const sum = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const at = ((cy + dy) * width + cx + dx) * 3;
      sum[0] += rgb[at];
      sum[1] += rgb[at + 1];
      sum[2] += rgb[at + 2];
    }
  }
  return sum.map((value) => value / 9);
}

// ---------- classificação por célula ----------
const luminance = new Float32Array(count);
let sand = new Uint8Array(count);
for (let i = 0; i < count; i++) {
  const row = (i / stride) | 0;
  const { lat, lon } = toGeo(-halfWidth + (i - row * stride) * cellM, -halfDepth + row * cellM);
  const { px, py } = mosaicPixel(lat, lon);
  const color = colorAt(px, py);
  if (!color) continue;
  const [red, green, blue] = color;
  luminance[i] = 0.299 * red + 0.587 * green + 0.114 * blue;
  const slopeDeg = Math.atan(Math.hypot(gradX[i], gradZ[i])) * (180 / Math.PI);
  if (luminance[i] < SAND_RULE.maxLuminance && blue - red > SAND_RULE.minBlueOverRed && slopeDeg < SAND_RULE.maxSlopeDeg) sand[i] = 1;
}

// Maioria na vizinhança de 3 x 3: tira pontos soltos e fecha furos de uma célula.
function majority(mask) {
  const out = new Uint8Array(count);
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < stride - 1; col++) {
      let votes = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) votes += mask[(row + dy) * stride + col + dx];
      out[row * stride + col] = votes >= 5 ? 1 : 0;
    }
  }
  return out;
}
sand = majority(majority(sand));

// Descarta manchas pequenas (células ligadas pelos quatro lados).
const seen = new Uint8Array(count);
let patches = 0;
for (let start = 0; start < count; start++) {
  if (!sand[start] || seen[start]) continue;
  const patch = [start];
  seen[start] = 1;
  for (let head = 0; head < patch.length; head++) {
    const i = patch[head];
    const col = i % stride;
    for (const next of [col > 0 ? i - 1 : -1, col < stride - 1 ? i + 1 : -1, i - stride, i + stride]) {
      if (next >= 0 && next < count && sand[next] && !seen[next]) { seen[next] = 1; patch.push(next); }
    }
  }
  if (patch.length < SAND_RULE.minPatchCells) for (const i of patch) sand[i] = 0;
  else patches += 1;
}

// ---------- saída ----------
const bits = new Uint8Array(Math.ceil(count / 8));
let cells = 0;
for (let i = 0; i < count; i++) if (sand[i]) { bits[i >> 3] |= 1 << (i & 7); cells += 1; }
await mkdir(new URL('areia/', assets), { recursive: true });
await writeFile(new URL('areia/areia.bits', assets), bits);
await writeFile(new URL('areia/areia.json', assets), `${JSON.stringify({
  file: 'areia.bits',
  encoding: '1 bit por célula da grade do relevo, na mesma ordem; bit menos significativo primeiro',
  cols: stride, rows, cellM, cells,
  source: 'Estimativa da equipe: cor da imagem HiRISE (escura e azulada) e declive do DEM do USGS. Não é mapa de areia da NASA.',
  rule: SAND_RULE,
}, null, 2)}\n`);
console.log(`areia: ${cells} células (${(cells * cellM * cellM / 1e6).toFixed(2)} km², ${(100 * cells / count).toFixed(1)}% da grade) em ${patches} manchas`);

// Prévia opcional para conferir no olho: brilho da imagem em cinza, areia em magenta.
const previewPath = process.argv[2];
if (previewPath) {
  const png = new PNG({ width: stride, height: rows });
  for (let i = 0; i < count; i++) {
    const gray = Math.min(255, luminance[i] * 1.6);
    png.data.set(sand[i] ? [255, 0, 220, 255] : [gray, gray, gray, 255], i * 4);
  }
  await writeFile(previewPath, PNG.sync.write(png));
  console.log(`prévia: ${previewPath}`);
}
