// Camadas de imagem do globo: o planeta inteiro e os retalhos mais nítidos em volta da área mapeada.
// Cada camada é um canvas, onde os ladrilhos são desenhados conforme chegam, e a textura dele.
//
// Fonte da imagem: "Mars Viking Colorized Global Mosaic 232m" (MDIM 2.1), USGS Astrogeology Science
// Center, publicado em 2009. Imagens das câmeras VIS (Visual Imaging Subsystem) dos orbitadores
// Viking 1 e 2; a cor é uma colorização feita pela NASA Ames sobre o mosaico em tons de cinza, não
// uma cor medida. https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m
// Servida em ladrilhos JPEG pelo NASA Mars Trek (JPL), níveis 0 a 7. https://trek.nasa.gov/mars/
//
// Só no navegador: usa canvas e WebGL.

import * as THREE from 'three';
import { TILE_PX, tilesInRect, tileBounds, areaCenter, angleBetween, centeredBounds } from './globo-geo.js';

/** Fonte do mosaico global, para a lista de fontes. */
export const GLOBE_SOURCE = Object.freeze({
  label: 'Mosaico global colorido do Viking (MDIM 2.1), 232 m por pixel',
  mission: 'Viking Orbiter 1 e 2',
  instrument: 'VIS (Visual Imaging Subsystem)',
  url: 'https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m',
  served: 'NASA Mars Trek (JPL), camada Mars_Viking_MDIM21_ClrMosaic_global_232m, níveis 0 a 7: https://trek.nasa.gov/mars/',
  credit: 'USGS Astrogeology Science Center; colorização da NASA Ames; domínio público',
  note: 'A cor é uma colorização sobre o mosaico em tons de cinza, não uma cor medida. O nível 7 dos ladrilhos tem cerca de 325 m por pixel.',
});

/** Nível mais fundo que o servidor tem para este mosaico (o 8 devolve 404). */
export const MAX_LEVEL = 7;
const TILE_URL = (level, row, col) => `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${level}/${row}/${col}.jpg`;
// O servidor fala HTTP/1.1: o navegador abre no máximo seis conexões com ele.
const MAX_PARALLEL = 6;
// Mandar o canvas para a placa de vídeo custa pelo tamanho dele: os ladrilhos que chegam nesse
// intervalo sobem juntos.
const UPLOAD_MS_PER_MEGAPIXEL = 75;
const RETRY_MS = 20000;
const WHOLE_PLANET = Object.freeze({ south: -90, north: 90, west: -180, east: 180 });
// Cor lisa da esfera enquanto a imagem não chega. Não é dado.
const PLACEHOLDER_COLOR = '#2b2622';
const PREVIEW_LEVEL = 1;
// Retalhos em volta da área mapeada, do mais largo ao mais nítido.
const PATCH_LEVELS = Object.freeze([MAX_LEVEL - 2, MAX_LEVEL - 1, MAX_LEVEL]);
// Nível da imagem do planeta inteiro (2 = 2048 × 1024 px, 3 = 4096 × 2048 px) e quantos ladrilhos de
// lado tem cada retalho.
const QUALITY = Object.freeze({
  minima: Object.freeze({ baseLevel: 2, patchTiles: 3 }),
  media: Object.freeze({ baseLevel: 3, patchTiles: 4 }),
  alta: Object.freeze({ baseLevel: 3, patchTiles: 6 }),
});

/**
 * Fila de pedidos de ladrilho, com poucos ao mesmo tempo. Os urgentes passam na frente.
 * @returns {{ load(level: number, row: number, col: number, urgent?: boolean): Promise<ImageBitmap>, cancel(): void }}
 */
export function createTileLoader() {
  const abort = new AbortController();
  const waiting = [];
  let running = 0;

  async function fetchTile(url) {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) throw new Error(`Mars Trek: resposta ${response.status} em ${url}.`);
    return createImageBitmap(await response.blob());
  }

  function pump() {
    while (running < MAX_PARALLEL && waiting.length > 0) {
      const job = waiting.shift();
      running += 1;
      fetchTile(job.url).then(job.resolve, job.reject).finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  function load(level, row, col, urgent = false) {
    return new Promise((resolve, reject) => {
      const job = { url: TILE_URL(level, row, col), resolve, reject };
      if (urgent) waiting.unshift(job);
      else waiting.push(job);
      pump();
    });
  }

  function cancel() {
    for (const job of waiting.splice(0)) job.reject(new DOMException('Pedido de ladrilho cancelado.', 'AbortError'));
    abort.abort();
  }

  return Object.freeze({ load, cancel });
}

/**
 * Uma camada de imagem: o canvas de um retângulo de ladrilhos e a textura dele.
 * @param {{
 *   bounds: { south: number, north: number, west: number, east: number },  // alinhado à grade do nível
 *   level: number,
 *   loader: ReturnType<typeof createTileLoader>,
 *   focus: { lat: number, lon: number },  // os ladrilhos mais próximos deste ponto vêm primeiro
 *   previewLevel?: number,         // nível raso desenhado antes, ampliado, para a imagem aparecer logo
 *   placeholder?: string,          // cor lisa enquanto não há imagem; sem ela a camada começa transparente
 *   urgent?: boolean,
 * }} options
 */
export function createLayer({ bounds, level, loader, focus, previewLevel, placeholder, urgent = false }) {
  const sorted = (tileLevel) => tilesInRect(bounds, tileLevel)
    .map((tile) => ({ ...tile, distance: angleBetween(focus, areaCenter(tileBounds(tileLevel, tile.row, tile.col))) }))
    .sort((a, b) => a.distance - b.distance);
  const own = tilesInRect(bounds, level);
  const origin = own[0];
  const last = own[own.length - 1];
  const canvas = document.createElement('canvas');
  canvas.width = (last.col - origin.col + 1) * TILE_PX;
  canvas.height = (last.row - origin.row + 1) * TILE_PX;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível para montar a imagem do globo.');
  context.imageSmoothingQuality = 'high';
  if (placeholder) {
    context.fillStyle = placeholder;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  // Sem conversão de cor: os valores do mosaico vão para a tela como estão no arquivo.
  texture.colorSpace = THREE.NoColorSpace;
  // Onde o ladrilho não chegou o canvas fica transparente e aparece a camada de baixo.
  texture.premultiplyAlpha = true;
  // A imagem do planeta inteiro emenda em 180°.
  if (bounds.east - bounds.west >= WHOLE_PLANET.east - WHOLE_PLANET.west) texture.wrapS = THREE.RepeatWrapping;

  const uploadEveryMs = ((canvas.width * canvas.height) / 1e6) * UPLOAD_MS_PER_MEGAPIXEL;
  let pending = sorted(level);
  let previewDone = previewLevel === undefined || previewLevel >= level;
  let loading = false;
  let retryAtMs = 0;
  let drawn = 0;
  let stale = false;
  let uploadedAtMs = -Infinity;
  let disposed = false;

  function draw(bitmap, tileLevel, row, col) {
    if (disposed) return;
    const scale = 2 ** (level - tileLevel);
    const size = TILE_PX * scale;
    context.drawImage(bitmap, (col * scale - origin.col) * TILE_PX, (row * scale - origin.row) * TILE_PX, size, size);
    drawn += 1;
    stale = true;
  }

  // Pede os ladrilhos e desenha cada um ao chegar. Devolve os que falharam.
  async function fetchAll(tiles, tileLevel) {
    const results = await Promise.allSettled(tiles.map(async ({ row, col }) => {
      const bitmap = await loader.load(tileLevel, row, col, urgent);
      draw(bitmap, tileLevel, row, col);
      bitmap.close();
    }));
    return tiles.filter((_, index) => results[index].status === 'rejected');
  }

  /**
   * Pede o que falta da camada, se já não houver um pedido em andamento. O que falhar fica com a
   * imagem que já estava lá e é pedido de novo mais tarde.
   * @returns {Promise<void> | null} null quando não há nada a pedir agora.
   */
  function load(nowMs) {
    if (disposed || loading || pending.length === 0 || nowMs < retryAtMs) return null;
    loading = true;
    return (async () => {
      try {
        if (!previewDone) {
          await fetchAll(sorted(previewLevel), previewLevel);
          previewDone = true;
        }
        pending = await fetchAll(pending, level);
      } finally {
        retryAtMs = performance.now() + RETRY_MS;
        loading = false;
      }
    })();
  }

  /** Manda o canvas para a placa de vídeo se houver ladrilho novo. Devolve true quando mandou. */
  function flush(nowMs) {
    if (!stale || nowMs - uploadedAtMs < uploadEveryMs) return false;
    texture.needsUpdate = true;
    stale = false;
    uploadedAtMs = nowMs;
    return true;
  }

  function dispose() {
    disposed = true;
    texture.dispose();
  }

  return Object.freeze({
    texture, level, bounds, load, flush, dispose,
    /** 'loading' enquanto chega, 'ready' com tudo, 'partial' com falhas, 'failed' sem nenhum ladrilho. */
    status: () => {
      if (loading || (pending.length > 0 && retryAtMs === 0)) return 'loading';
      if (pending.length === 0) return 'ready';
      return drawn > 0 ? 'partial' : 'failed';
    },
  });
}

/**
 * As camadas de imagem do globo numa qualidade: o planeta inteiro e os retalhos em volta de um ponto.
 * @param {{
 *   quality: 'minima' | 'media' | 'alta',
 *   focus: { lat: number, lon: number },   // centro dos retalhos; os ladrilhos perto dele chegam primeiro
 *   maxTextureSize: number,                // maior textura que a placa de vídeo aceita
 *   onStatus: (status: 'loading' | 'ready' | 'partial' | 'failed') => void,  // imagem do planeta inteiro
 * }} options
 */
export function createImagery({ quality, focus, maxTextureSize, onStatus }) {
  const settings = QUALITY[quality];
  if (!settings) throw new Error(`Qualidade desconhecida: ${quality}`);
  const loader = createTileLoader();
  // A imagem do planeta inteiro tem de caber numa textura só.
  const maxBaseLevel = Math.floor(Math.log2(maxTextureSize / (2 * TILE_PX)));
  const base = createLayer({
    loader, focus, bounds: WHOLE_PLANET, level: Math.min(settings.baseLevel, maxBaseLevel),
    previewLevel: PREVIEW_LEVEL, placeholder: PLACEHOLDER_COLOR,
  });
  const patches = PATCH_LEVELS.map((level) => {
    const bounds = centeredBounds(focus.lat, focus.lon, level, settings.patchTiles);
    const { south, north, west, east } = bounds;
    return Object.freeze({
      layer: createLayer({ loader, focus, bounds, level, urgent: true }),
      halfSpanRad: angleBetween({ lat: south, lon: west }, { lat: north, lon: east }) / 2,
    });
  });
  const layers = Object.freeze([base, ...patches.map((patch) => patch.layer)]);
  let lastStatus = null;
  let disposed = false;

  function report(status) {
    if (disposed || status === lastStatus) return;
    lastStatus = status;
    onStatus(status);
  }

  /**
   * Pede a imagem do planeta e, quando a tela passa a mostrar mais detalhe do que a camada de baixo
   * tem, os retalhos que estão à vista. O que falhar é pedido de novo mais tarde.
   * @param {{
   *   neededLevel: number,     // nível de ladrilho que a tela pede (levelForView)
   *   separationRad: number,   // ângulo entre o ponto sob a câmera e o centro dos retalhos
   *   reachRad: number,        // até onde o chão aparece, a partir do ponto sob a câmera
   * }} sight
   */
  function request(nowMs, { neededLevel, separationRad, reachRad }) {
    const job = base.load(nowMs);
    if (job) {
      if (lastStatus === null) report('loading');
      job.then(() => report(base.status()));
    }
    for (const { layer, halfSpanRad } of patches) {
      if (neededLevel >= layer.level && separationRad <= halfSpanRad + reachRad) layer.load(nowMs);
    }
  }

  return Object.freeze({
    quality, layers, request,
    /** Manda para a placa de vídeo os ladrilhos novos. Devolve true quando alguma camada mudou. */
    flush: (nowMs) => layers.reduce((any, layer) => layer.flush(nowMs) || any, false),
    dispose: () => {
      disposed = true;
      loader.cancel();
      for (const layer of layers) layer.dispose();
    },
  });
}
