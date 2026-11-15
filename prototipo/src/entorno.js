// Chão em volta da área mapeada: a imagem real da região, para o mapa não ficar solto no vazio.
//
// Fonte: mosaico global colorido do Viking (MDIM 2.1, sondas Viking Orbiter 1 e 2, câmera VIS),
// USGS Astrogeology, lido em ladrilhos do NASA Mars Trek no nível 7 (cerca de 325 m por pixel).
// https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m
// Os ladrilhos seguem a grade equirretangular 2:1 do Trek: no nível z há 2^(z+1) colunas e 2^z
// linhas de 256 px, com a linha 0 no polo norte e a coluna 0 em 180° oeste.
//
// A posição da imagem é real; o relevo não: fora do modelo de elevação o chão é um plano.

import * as THREE from 'three';
import { ORIGIN, toLocal } from './geo.js';

const LEVEL = 7;
const TILE_PX = 256;
// Ladrilhos de lado em volta do que contém a área: 3 × 83 km dá cerca de 250 km de chão.
const TILES_PER_SIDE = 3;
const DEG_PER_TILE = 180 / 2 ** LEVEL;
const TILE_URL = (row, col) => `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${LEVEL}/${row}/${col}.jpg`;
// Cor do ladrilho que não chegou: a mesma do chão liso usado antes da imagem. Não é dado.
const MISSING_TILE_COLOR = '#8a5f45';

function loadTile(row, col) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    // Sem rede (ou ladrilho ausente) o pedaço fica na cor lisa; os outros entram normalmente.
    image.onerror = () => resolve(null);
    image.src = TILE_URL(row, col);
  });
}

/**
 * Lê os ladrilhos em volta da área de estudo e devolve a imagem e onde ela fica, em metros locais.
 * @returns {Promise<{ texture: THREE.Texture, centerX: number, centerZ: number, widthM: number, depthM: number, loaded: number }>}
 *   `loaded`: quantos dos ladrilhos chegaram (0 = sem rede).
 */
export async function loadSurroundings() {
  const firstRow = Math.floor((90 - ORIGIN.lat) / DEG_PER_TILE) - (TILES_PER_SIDE - 1) / 2;
  const firstCol = Math.floor((ORIGIN.lon + 180) / DEG_PER_TILE) - (TILES_PER_SIDE - 1) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = TILES_PER_SIDE * TILE_PX;
  canvas.height = TILES_PER_SIDE * TILE_PX;
  const context = canvas.getContext('2d');
  context.fillStyle = MISSING_TILE_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const cells = Array.from({ length: TILES_PER_SIDE ** 2 }, (_, i) => ({ row: Math.floor(i / TILES_PER_SIDE), col: i % TILES_PER_SIDE }));
  const images = await Promise.all(cells.map(({ row, col }) => loadTile(firstRow + row, firstCol + col)));
  images.forEach((image, i) => { if (image) context.drawImage(image, cells[i].col * TILE_PX, cells[i].row * TILE_PX); });

  const north = 90 - firstRow * DEG_PER_TILE;
  const west = firstCol * DEG_PER_TILE - 180;
  const northWest = toLocal(north, west);
  const southEast = toLocal(north - TILES_PER_SIDE * DEG_PER_TILE, west + TILES_PER_SIDE * DEG_PER_TILE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return {
    texture,
    centerX: (northWest.x + southEast.x) / 2,
    centerZ: (northWest.z + southEast.z) / 2,
    widthM: southEast.x - northWest.x,
    depthM: southEast.z - northWest.z,
    loaded: images.filter(Boolean).length,
  };
}
