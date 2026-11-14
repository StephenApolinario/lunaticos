// Mosaico HiRISE do local do Curiosity servido pelo NASA Mars Trek, no nível 16: 64 cm por pixel.
//
// Fonte: NASA Mars Trek (JPL), camada "curiosity_hirise_mosaic" — MRO HiRISE, Curiosity Roving
// Site Mosaic. https://trek.nasa.gov/mars/
// Os ladrilhos seguem uma grade equirretangular 2:1: no nível z há 2^(z+1) colunas e 2^z linhas
// de 256 px, com a linha 0 no polo norte e a coluna 0 em 180° oeste.
//
// Só no navegador: usa canvas para ler os pixels dos ladrilhos.

const LEVEL = 16;
const TILE_PX = 256;
const TILE_URL = (row, col) => `https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/default/default028mm/${LEVEL}/${row}/${col}.png`;
const PX_PER_DEG = (2 ** LEVEL * TILE_PX) / 180;
const TREK_RADIUS_M = 3396190;
const METERS_PER_PX = (Math.PI * TREK_RADIUS_M) / (2 ** LEVEL * TILE_PX);
const MAX_CACHED_TILES = 256;

export function trekPixelAt(lat, lon) {
  return { px: (lon + 180) * PX_PER_DEG, py: (90 - lat) * PX_PER_DEG };
}

export function trekGeoAt(px, py) {
  return { lat: 90 - py / PX_PER_DEG, lon: px / PX_PER_DEG - 180 };
}

/**
 * Mesma interface de `createOrthophoto`: janelas quadradas em pixels do mosaico, sem reamostrar.
 */
export function createTrekMosaic() {
  // "linha/coluna" -> Promise<ImageBitmap>. Os pedidos não são cancelados: são pequenos e o
  // ladrilho que chega fica no cache para a próxima janela.
  const cache = new Map();
  let surface = null;

  function tile(row, col) {
    const key = `${row}/${col}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const loading = fetch(TILE_URL(row, col)).then(async (response) => {
      if (!response.ok) throw new Error(`Mars Trek: resposta ${response.status} no ladrilho ${key}.`);
      return createImageBitmap(await response.blob());
    });
    // Se falhar, sai do cache para ser pedido de novo (só se a entrada ainda for esta).
    loading.catch(() => { if (cache.get(key) === loading) cache.delete(key); });
    cache.set(key, loading);
    if (cache.size > MAX_CACHED_TILES) {
      const [oldestKey, oldest] = cache.entries().next().value;
      cache.delete(oldestKey);
      oldest.then((bitmap) => bitmap.close(), () => {});
    }
    return loading;
  }

  function surfaceOf(size) {
    if (surface?.canvas.width === size) return surface;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D indisponível para montar o detalhe do Mars Trek.');
    surface = { canvas, context };
    return surface;
  }

  async function read(px0, py0, size, signal) {
    const jobs = [];
    for (let row = Math.floor(py0 / TILE_PX); row * TILE_PX < py0 + size; row++) {
      for (let col = Math.floor(px0 / TILE_PX); col * TILE_PX < px0 + size; col++) {
        jobs.push(tile(row, col).then((bitmap) => ({ bitmap, x: col * TILE_PX - px0, y: row * TILE_PX - py0 })));
      }
    }
    // Um ladrilho que falha (borda do mosaico, oscilação da rede) fica sem dado; só se todos falharem a janela é recusada.
    const settled = await Promise.allSettled(jobs);
    if (signal?.aborted) throw new DOMException('Leitura do detalhe cancelada.', 'AbortError');
    const placed = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    if (placed.length === 0) throw settled[0].reason;

    const { context } = surfaceOf(size);
    context.clearRect(0, 0, size, size);
    for (const { bitmap, x, y } of placed) context.drawImage(bitmap, x, y);
    // Os ladrilhos são em tons de cinza; onde não há dado o ladrilho é transparente e o valor fica 0.
    const rgba = context.getImageData(0, 0, size, size).data;
    const out = new Uint8Array(size * size);
    for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
    return out;
  }

  return Object.freeze({ metersPerPixel: METERS_PER_PX, pixelAt: trekPixelAt, geoAt: trekGeoAt, read });
}
