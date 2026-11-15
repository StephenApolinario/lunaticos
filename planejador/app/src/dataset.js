// Duas versões do app, escolhidas na hora de rodar/compilar:
//   npm run dev             -> versão ampliada (NASA/JPL MMGIS + USGS)
//   npm run dev:hackathon   -> versão só com recursos listados no desafio (JPL Mars Trek + PIA23179)
const HACKATHON = import.meta.env.VITE_DATASET === 'hackathon'

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/default/default028mm/{z}/{y}/{x}.png'

export const DATASET = HACKATHON
  ? {
      id: 'hackathon',
      badge: 'Versão só com recursos do hackathon',
      base: '/hk',
      tiles: { url: TREK, crs: 'eq', minNative: 10, maxNative: 18, color: false },
      hazard: false,
      showSol: false,
      roverLabel: 'Trajeto do Curiosity no Mars Trek (até 2018)',
      demLabel: 'relevo do Mars Trek (HiRISE, Gale Crater DEM, 1 m) amostrado a 4 m',
      vehicleRule: 'De veículo, 15°.',
      profileNote: 'Altitude (m) pela distância percorrida na ida, lida do relevo do Mars Trek.',
      sources: [
        ['Imagem', 'MRO HiRISE, Curiosity Roving Site Mosaic', 'https://trek.nasa.gov/mars/', 'JPL Mars Trek'],
        ['Altitude', 'MRO HiRISE, Gale Crater DEM (1 m)', 'https://trek.nasa.gov/mars/', 'JPL Mars Trek'],
        ['Trajeto do rover', 'curiosity_path', 'https://trek.nasa.gov/mars/', 'JPL Mars Trek'],
        ['Rota e unidades geológicas', "Curiosity's Proposed Path up Mount Sharp (PIA23179)", 'https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/', 'NASA'],
      ],
    }
  : {
      id: 'ampliada',
      badge: null,
      base: '',
      tiles: { url: '/tiles/{z}/{x}/{y}.png', crs: 'mercator', minNative: 14, maxNative: 16, color: true },
      hazard: true,
      showSol: true,
      roverLabel: 'Trajeto do Curiosity',
      demLabel: 'mapa de altitude de 1 m do USGS (reamostrado para 2 m)',
      vehicleRule: 'De veículo, 15°, com preferência pelo terreno que o Curiosity já percorreu.',
      profileNote: 'Altitude (m) pela distância percorrida na ida, lida do mapa de altitude. Para comparar: o Curiosity rodou ~11 km entre o habitat e o canal de enxofre.',
      sources: [
        ['Imagem', 'HiRISE colorida (MRO), mosaico da equipe MSL', 'https://mars.nasa.gov/maps/location/?mission=MSL', 'NASA/JPL-Caltech/UArizona'],
        ['Altitude', 'MSL Gale Merged DEM 1 m (Calef & Parker)', 'https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m', 'USGS'],
        ['Trajeto', 'mapa oficial do Curiosity (MMGIS)', 'https://mars.nasa.gov/maps/location/?mission=MSL', 'NASA/JPL'],
        ['Unidades geológicas', "Curiosity's Proposed Path up Mount Sharp (PIA23179)", 'https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/', 'NASA'],
      ],
    }
