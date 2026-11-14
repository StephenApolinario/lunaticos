// Geometria do mosaico da imagem orbital (ladrilhos Web Mercator, zoom 15).
// Só matemática, sem dependências: converte lat/lon em posição dentro do mosaico.

import { MARS_RADIUS_M, ORIGIN, clamp } from './geo.js';

const DEG = Math.PI / 180;

// Faixa de ladrilhos publicada no artifact original para o zoom 15.
export const MOSAIC = Object.freeze({ zoom: 15, xMin: 28887, yMin: 16814, cols: 6, rows: 10, tilePx: 256, marginPx: 8 });

const IMAGE_WIDTH_PX = MOSAIC.cols * MOSAIC.tilePx;
const IMAGE_HEIGHT_PX = MOSAIC.rows * MOSAIC.tilePx;

// O canvas tem uma margem em volta da imagem, preenchida com a cor média.
// Assim, fora da área fotografada a textura devolve um tom liso em vez de borrões da borda.
export const MOSAIC_CANVAS = Object.freeze({
  width: IMAGE_WIDTH_PX + 2 * MOSAIC.marginPx,
  height: IMAGE_HEIGHT_PX + 2 * MOSAIC.marginPx,
});

const TILES_AT_ZOOM = 2 ** MOSAIC.zoom;
// Tamanho de um pixel da imagem no chão, na latitude da área de estudo (cerca de 2,5 m).
export const MOSAIC_METERS_PER_PX = (2 * Math.PI * MARS_RADIUS_M * Math.cos(ORIGIN.lat * DEG)) / (TILES_AT_ZOOM * MOSAIC.tilePx);

const tileX = (lon) => ((lon + 180) / 360) * TILES_AT_ZOOM;
const tileY = (lat) => ((1 - Math.asinh(Math.tan(lat * DEG)) / Math.PI) / 2) * TILES_AT_ZOOM;

// Posição em pixels dentro da imagem (sem a margem), com origem no canto noroeste.
export function mosaicPixel(lat, lon) {
  return {
    px: (tileX(lon) - MOSAIC.xMin) * MOSAIC.tilePx,
    py: (tileY(lat) - MOSAIC.yMin) * MOSAIC.tilePx,
  };
}

// Coordenada de textura (origem embaixo à esquerda, como o Three.js espera para um canvas).
export function mosaicUv(lat, lon) {
  const { px, py } = mosaicPixel(lat, lon);
  return {
    u: (px + MOSAIC.marginPx) / MOSAIC_CANVAS.width,
    v: 1 - (py + MOSAIC.marginPx) / MOSAIC_CANVAS.height,
  };
}

// 1 dentro da área fotografada, caindo até 0 ao longo de `fadeM` metros para fora dela.
export function mosaicCoverage(lat, lon, fadeM) {
  const { px, py } = mosaicPixel(lat, lon);
  const outsidePx = Math.max(-px, px - IMAGE_WIDTH_PX, -py, py - IMAGE_HEIGHT_PX);
  return clamp(1 - (outsidePx * MOSAIC_METERS_PER_PX) / fadeM, 0, 1);
}

export function tileList() {
  const tiles = [];
  for (let col = 0; col < MOSAIC.cols; col++) {
    for (let row = 0; row < MOSAIC.rows; row++) {
      tiles.push({ col, row, x: MOSAIC.xMin + col, y: MOSAIC.yMin + row });
    }
  }
  return tiles;
}
