// Foto fina pronta: o mesmo mosaico colorido HiRISE da foto de 2,5 m, a cerca de 0,69 m por pixel,
// gravado em três faixas de norte a sul (assets/hirise-fina/; a fonte está em faixas.json).
// É carregada uma vez e fica na placa de vídeo: o terreno fica nítido de longe e de perto sem
// buscar nada na rede enquanto a câmera anda. A ideia veio do planejador de travessia da equipe.

import * as THREE from 'three';
import { toLocal } from './geo.js';

const DIR = './assets/hirise-fina/';
const ANISOTROPY = 8;
export const FINE_BANDS = 3;

/**
 * @returns {Promise<{ textures: THREE.Texture[], rects: THREE.Vector4[], bounds: THREE.Vector4, metersPerPixel: number }>}
 *   `rects` (uma por faixa) e `bounds` (a área toda): canto noroeste (x, z) e o inverso do tamanho, em metros locais.
 */
export async function loadFinePhoto() {
  const response = await fetch(`${DIR}faixas.json`);
  if (!response.ok) throw new Error(`Foto fina indisponível (${response.status}).`);
  const meta = await response.json();
  if (meta.bands.length !== FINE_BANDS) throw new Error(`A foto fina precisa de ${FINE_BANDS} faixas.`);
  const { south, north, west, east } = meta.bounds;
  const loader = new THREE.TextureLoader();
  const textures = await Promise.all(meta.bands.map((band) => loader.loadAsync(`${DIR}${band.file}`)));
  for (const texture of textures) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = ANISOTROPY;
  }
  // Retângulo entre duas frações da área (0 = norte, 1 = sul), em metros locais.
  const rectBetween = (northFrac, southFrac) => {
    const northWest = toLocal(north + (south - north) * northFrac, west);
    const southEast = toLocal(north + (south - north) * southFrac, east);
    return new THREE.Vector4(northWest.x, northWest.z, 1 / (southEast.x - northWest.x), 1 / (southEast.z - northWest.z));
  };
  return {
    textures,
    rects: meta.bands.map((band) => rectBetween(band.northFrac, band.southFrac)),
    bounds: rectBetween(0, 1),
    metersPerPixel: meta.metersPerPixel,
  };
}
