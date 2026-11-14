// Imagem orbital real e mapa de declive real, publicados com o artifact original.
// - Imagem: HiRISE colorida (MRO), mosaico da equipe MSL · NASA/JPL-Caltech/UArizona.
// - Declive: classes calculadas sobre o MSL Gale Merged DEM de 1 m (USGS).
//
// Os 60 ladrilhos são colados em um canvas só, que vira a textura do terreno.
// A camada de declive é desenhada por cima no mesmo canvas, na resolução original.

import * as THREE from 'three';
import { MOSAIC, MOSAIC_CANVAS, mosaicPixel, tileList } from './tiles.js';

const TILE_URL = (tile) => `./assets/hirise/${MOSAIC.zoom}/${tile.x}/${tile.y}.png`;
const ANISOTROPY = 8;
const MEAN_SAMPLE_PX = 8;

// Limites geográficos do mapa de declive (os mesmos do artifact original).
// O PNG já vem translúcido; duas passadas deixam as classes legíveis sobre a foto.
const SLOPE_MAP = Object.freeze({
  url: './assets/slope.png',
  south: -4.8199921235718195,
  west: 137.36999652481478,
  north: -4.719983177972913,
  east: 137.418010266241,
  passes: 2,
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Falha ao carregar ${url}`));
    image.src = url;
  });
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível para montar a imagem orbital.');
  return { canvas, context };
}

// Cor média da imagem, usada na margem e para casar o tom do terreno fora da foto.
function meanColorOf(source) {
  const { context } = createCanvas(MEAN_SAMPLE_PX, MEAN_SAMPLE_PX);
  context.drawImage(source, 0, 0, MEAN_SAMPLE_PX, MEAN_SAMPLE_PX);
  const { data } = context.getImageData(0, 0, MEAN_SAMPLE_PX, MEAN_SAMPLE_PX);
  const sums = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    sums[0] += data[i];
    sums[1] += data[i + 1];
    sums[2] += data[i + 2];
  }
  const pixels = data.length / 4;
  return `rgb(${sums.map((sum) => Math.round(sum / pixels)).join(',')})`;
}

function slopeRect() {
  const topLeft = mosaicPixel(SLOPE_MAP.north, SLOPE_MAP.west);
  const bottomRight = mosaicPixel(SLOPE_MAP.south, SLOPE_MAP.east);
  return {
    x: topLeft.px + MOSAIC.marginPx,
    y: topLeft.py + MOSAIC.marginPx,
    width: bottomRight.px - topLeft.px,
    height: bottomRight.py - topLeft.py,
  };
}

/**
 * Carrega a imagem e o mapa de declive. Rejeita se algum arquivo faltar.
 * @returns {Promise<{ texture: THREE.CanvasTexture, meanLinear: number[], setSlopeOverlay: (show: boolean) => void }>}
 */
export async function loadImagery() {
  const tiles = tileList();
  const [slopeImage, ...tileImages] = await Promise.all([
    loadImage(SLOPE_MAP.url),
    ...tiles.map((tile) => loadImage(TILE_URL(tile))),
  ]);

  const photo = createCanvas(MOSAIC.cols * MOSAIC.tilePx, MOSAIC.rows * MOSAIC.tilePx);
  tiles.forEach((tile, i) => photo.context.drawImage(tileImages[i], tile.col * MOSAIC.tilePx, tile.row * MOSAIC.tilePx));
  const meanCss = meanColorOf(photo.canvas);

  const display = createCanvas(MOSAIC_CANVAS.width, MOSAIC_CANVAS.height);
  const texture = new THREE.CanvasTexture(display.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = ANISOTROPY;

  let slopeShown = false;
  function compose() {
    const { context } = display;
    context.fillStyle = meanCss;
    context.fillRect(0, 0, MOSAIC_CANVAS.width, MOSAIC_CANVAS.height);
    context.drawImage(photo.canvas, MOSAIC.marginPx, MOSAIC.marginPx);
    if (slopeShown) {
      const rect = slopeRect();
      for (let pass = 0; pass < SLOPE_MAP.passes; pass++) {
        context.drawImage(slopeImage, rect.x, rect.y, rect.width, rect.height);
      }
    }
    texture.needsUpdate = true;
  }
  compose();

  return Object.freeze({
    texture,
    meanLinear: new THREE.Color(meanCss).toArray(),
    setSlopeOverlay(show) {
      if (show === slopeShown) return;
      slopeShown = show;
      compose();
    },
  });
}
