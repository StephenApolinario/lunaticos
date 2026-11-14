// Leitura sob demanda da ortofoto HiRISE de 25 cm por pixel da cratera Gale.
//
// Fonte: MSL Gale Merged Orthophoto Mosaic 25 cm v3 (Calef & Parker, USGS Astrogeology /
// JPL-Caltech / NASA), imagens HiRISE (MRO).
// https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm
// O arquivo é um BigTIFF de 24 GB, em ladrilhos de 128 px comprimidos com PackBits. Aqui só
// se baixa o que a janela pedida precisa: as linhas da tabela de ladrilhos e os ladrilhos em si.
//
// Sem dependências: roda no navegador e no Node (os dois têm `fetch`).

// Endereço do armazenamento do USGS para onde planetarymaps.usgs.gov redireciona. Ele aceita
// leitura por faixas a partir de outra origem; o endereço de redirecionamento não foi testado para isso.
const SOURCE_URL = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif';

// Georreferência do mosaico: equirretangular sobre uma esfera de 3.396.190 m (x = R·lon, y = R·lat),
// com o canto noroeste em (originXM, originYM). Conferida contra o arquivo na primeira leitura.
const GRID = Object.freeze({ metersPerPixel: 0.25, originXM: 8126248, originYM: -241164, radiusM: 3396190 });
const M_PER_DEG = (GRID.radiusM * Math.PI) / 180;
const GEOREF_TOLERANCE_M = 0.001;

const TAG = Object.freeze({
  width: 256, height: 257, compression: 259, tileWidth: 322, tileHeight: 323,
  tileOffsets: 324, tileByteCounts: 325, pixelScale: 33550, tiepoint: 33922,
});
const TYPE_BYTES = Object.freeze({ 1: 1, 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 });
const BIGTIFF_MAGIC = 43;
const LITTLE_ENDIAN_MARK = 0x4949;
const PACKBITS = 32773;
const HEADER_BYTES = 16;
const IFD_READ_BYTES = 4096;
const ENTRY_BYTES = 20;
// Cada ladrilho ocupa 16 KB na memória; 1600 guardam cerca de seis janelas de 2048 px.
const MAX_CACHED_TILES = 1600;

/** Posição (em pixels do mosaico, origem no canto noroeste) de uma coordenada geográfica. */
export function orthoPixelAt(lat, lon) {
  return {
    px: (lon * M_PER_DEG - GRID.originXM) / GRID.metersPerPixel,
    py: (GRID.originYM - lat * M_PER_DEG) / GRID.metersPerPixel,
  };
}

/** Coordenada geográfica de uma posição em pixels do mosaico. */
export function orthoGeoAt(px, py) {
  return {
    lat: (GRID.originYM - py * GRID.metersPerPixel) / M_PER_DEG,
    lon: (GRID.originXM + px * GRID.metersPerPixel) / M_PER_DEG,
  };
}

async function fetchRange(url, offset, length, signal) {
  const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal });
  if (response.status !== 206) throw new Error(`Ortofoto: resposta ${response.status} ao pedir um trecho do arquivo.`);
  return new DataView(await response.arrayBuffer());
}

const readU64 = (view, offset) => Number(view.getBigUint64(offset, true));

function readValue(view, offset, type) {
  if (type === 3) return view.getUint16(offset, true);
  if (type === 4) return view.getUint32(offset, true);
  if (type === 12) return view.getFloat64(offset, true);
  if (type === 16) return readU64(view, offset);
  throw new Error(`Ortofoto: tipo de campo TIFF não tratado (${type}).`);
}

// Lê o diretório do BigTIFF: valores curtos vêm inline; vetores longos ficam só com o endereço.
async function readDirectory(url) {
  const header = await fetchRange(url, 0, HEADER_BYTES);
  if (header.getUint16(0, true) !== LITTLE_ENDIAN_MARK || header.getUint16(2, true) !== BIGTIFF_MAGIC) {
    throw new Error('Ortofoto: o arquivo não é o BigTIFF esperado.');
  }
  const ifd = await fetchRange(url, readU64(header, 8), IFD_READ_BYTES);
  const entryCount = readU64(ifd, 0);
  const tags = new Map();
  for (let i = 0; i < entryCount; i++) {
    const at = 8 + i * ENTRY_BYTES;
    if (at + ENTRY_BYTES > ifd.byteLength) break;
    const type = ifd.getUint16(at + 2, true);
    const bytes = (TYPE_BYTES[type] ?? 0) * readU64(ifd, at + 4);
    tags.set(ifd.getUint16(at, true), { type, inline: bytes > 0 && bytes <= 8, valueOffset: at + 12, pointer: readU64(ifd, at + 12) });
  }
  const inline = (tag) => {
    const entry = tags.get(tag);
    if (!entry?.inline) throw new Error(`Ortofoto: campo TIFF ${tag} ausente.`);
    return readValue(ifd, entry.valueOffset, entry.type);
  };
  const doubles = async (tag, howMany) => {
    const entry = tags.get(tag);
    if (!entry || entry.type !== 12) throw new Error(`Ortofoto: campo de georreferência ${tag} ausente.`);
    const view = await fetchRange(url, entry.pointer, howMany * 8);
    return Array.from({ length: howMany }, (_, i) => view.getFloat64(i * 8, true));
  };
  if (inline(TAG.compression) !== PACKBITS) throw new Error('Ortofoto: compressão diferente de PackBits.');

  const [scale, tiepoint] = await Promise.all([doubles(TAG.pixelScale, 2), doubles(TAG.tiepoint, 6)]);
  const originX = tiepoint[3] - tiepoint[0] * scale[0];
  const originY = tiepoint[4] + tiepoint[1] * scale[1];
  const matches = [scale[0] - GRID.metersPerPixel, scale[1] - GRID.metersPerPixel, originX - GRID.originXM, originY - GRID.originYM]
    .every((difference) => Math.abs(difference) < GEOREF_TOLERANCE_M);
  if (!matches) throw new Error('Ortofoto: a georreferência do arquivo mudou em relação à esperada.');

  const width = inline(TAG.width);
  const height = inline(TAG.height);
  const tileWidth = inline(TAG.tileWidth);
  const tileHeight = inline(TAG.tileHeight);
  return Object.freeze({
    tileWidth,
    tileHeight,
    tilesAcross: Math.ceil(width / tileWidth),
    tilesDown: Math.ceil(height / tileHeight),
    offsets: tags.get(TAG.tileOffsets),
    byteCounts: tags.get(TAG.tileByteCounts),
  });
}

/** PackBits: byte de controle n >= 0 copia n+1 bytes; n < 0 repete o próximo byte 1-n vezes. */
export function unpackBits(source, outLength) {
  const out = new Uint8Array(outLength);
  let i = 0;
  let o = 0;
  while (i < source.length && o < outLength) {
    const control = (source[i++] << 24) >> 24;
    if (control >= 0) {
      const length = control + 1;
      out.set(source.subarray(i, i + length), o);
      i += length;
      o += length;
    } else if (control !== -128) {
      const length = 1 - control;
      out.fill(source[i++], o, o + length);
      o += length;
    }
  }
  return out;
}

/**
 * @returns {{
 *   metersPerPixel: number,
 *   pixelAt: (lat: number, lon: number) => { px: number, py: number },
 *   geoAt: (px: number, py: number) => { lat: number, lon: number },
 *   read: (px0: number, py0: number, size: number, signal?: AbortSignal) => Promise<Uint8Array>,
 * }}
 */
export function createOrthophoto(url = SOURCE_URL) {
  let directoryPromise = null;
  const tiles = new Map();
  // Linha de ladrilhos -> pedaço das tabelas de endereço e tamanho que a contém.
  const tables = new Map();

  const directory = () => {
    directoryPromise ??= readDirectory(url).catch((error) => { directoryPromise = null; throw error; });
    return directoryPromise;
  };

  function remember(index, pixels) {
    tiles.set(index, pixels);
    if (tiles.size > MAX_CACHED_TILES) tiles.delete(tiles.keys().next().value);
  }

  // As tabelas são guardadas por linha inteira de ladrilhos: andar para leste ou oeste não pede nada de novo.
  async function ensureTables(dir, row0, row1, signal) {
    const missing = [];
    for (let row = row0; row <= row1; row++) if (!tables.has(row)) missing.push(row);
    if (missing.length === 0) return;
    const firstRow = missing[0];
    const lastRow = missing[missing.length - 1];
    const first = firstRow * dir.tilesAcross;
    const span = (lastRow - firstRow + 1) * dir.tilesAcross;
    const offsetBytes = TYPE_BYTES[dir.offsets.type];
    const countBytes = TYPE_BYTES[dir.byteCounts.type];
    const [offsets, counts] = await Promise.all([
      fetchRange(url, dir.offsets.pointer + first * offsetBytes, span * offsetBytes, signal),
      fetchRange(url, dir.byteCounts.pointer + first * countBytes, span * countBytes, signal),
    ]);
    const chunk = Object.freeze({ first, offsets, counts, offsetBytes, countBytes });
    for (let row = firstRow; row <= lastRow; row++) tables.set(row, chunk);
  }

  function locate(dir, index) {
    const chunk = tables.get(Math.floor(index / dir.tilesAcross));
    return {
      index,
      offset: readValue(chunk.offsets, (index - chunk.first) * chunk.offsetBytes, dir.offsets.type),
      bytes: readValue(chunk.counts, (index - chunk.first) * chunk.countBytes, dir.byteCounts.type),
    };
  }

  // Garante no cache os ladrilhos de uma janela, com um pedido por sequência de ladrilhos vizinhos no arquivo.
  async function loadTiles(dir, col0, col1, row0, row1, signal) {
    const wanted = [];
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const index = row * dir.tilesAcross + col;
        const cached = tiles.get(index);
        if (!cached) {
          wanted.push(index);
          continue;
        }
        // Reinsere para o ladrilho em uso não ser o próximo a sair do cache.
        tiles.delete(index);
        tiles.set(index, cached);
      }
    }
    if (wanted.length === 0) return;
    await ensureTables(dir, row0, row1, signal);

    const tilePixels = dir.tileWidth * dir.tileHeight;
    const runs = [];
    for (const tile of wanted.map((index) => locate(dir, index))) {
      const run = runs[runs.length - 1];
      if (tile.bytes === 0) {
        remember(tile.index, new Uint8Array(tilePixels));
      } else if (run && run.offset + run.bytes === tile.offset) {
        run.bytes += tile.bytes;
        run.tiles.push(tile);
      } else {
        runs.push({ offset: tile.offset, bytes: tile.bytes, tiles: [tile] });
      }
    }
    await Promise.all(runs.map(async (run) => {
      const view = await fetchRange(url, run.offset, run.bytes, signal);
      for (const tile of run.tiles) {
        const packed = new Uint8Array(view.buffer, view.byteOffset + (tile.offset - run.offset), tile.bytes);
        remember(tile.index, unpackBits(packed, tilePixels));
      }
    }));
  }

  /**
   * Lê uma janela quadrada de `size` pixels com o canto noroeste em (px0, py0), sem reamostrar.
   * Devolve tons de cinza (0 = sem dado), com a primeira linha ao norte.
   */
  async function read(px0, py0, size, signal) {
    const dir = await directory();
    const { tileWidth, tileHeight } = dir;
    const col0 = Math.max(0, Math.floor(px0 / tileWidth));
    const col1 = Math.min(dir.tilesAcross - 1, Math.floor((px0 + size - 1) / tileWidth));
    const row0 = Math.max(0, Math.floor(py0 / tileHeight));
    const row1 = Math.min(dir.tilesDown - 1, Math.floor((py0 + size - 1) / tileHeight));
    const out = new Uint8Array(size * size);
    if (col0 > col1 || row0 > row1) return out;
    await loadTiles(dir, col0, col1, row0, row1, signal);

    for (let row = row0; row <= row1; row++) {
      const yStart = Math.max(py0, row * tileHeight);
      const yEnd = Math.min(py0 + size, (row + 1) * tileHeight);
      for (let col = col0; col <= col1; col++) {
        const tile = tiles.get(row * dir.tilesAcross + col);
        if (!tile) continue;
        const xStart = Math.max(px0, col * tileWidth);
        const xEnd = Math.min(px0 + size, (col + 1) * tileWidth);
        for (let y = yStart; y < yEnd; y++) {
          const inTile = (y - row * tileHeight) * tileWidth - col * tileWidth;
          out.set(tile.subarray(inTile + xStart, inTile + xEnd), (y - py0) * size + (xStart - px0));
        }
      }
    }
    return out;
  }

  return Object.freeze({ metersPerPixel: GRID.metersPerPixel, pixelAt: orthoPixelAt, geoAt: orthoGeoAt, read });
}
