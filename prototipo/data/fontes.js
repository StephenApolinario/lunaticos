// De onde vem cada informação do protótipo. É a lista única: o painel do tablet mostra esta lista
// e `node prototipo/tools/gerar-fontes.mjs` escreve docs/fontes.md a partir dela.
//
// Tipos:
// - medido: dado de uma sonda ou rover (MRO, Odyssey, Curiosity), com a fonte. "Missão" aqui seria ambíguo:
//   no projeto, missão é a nossa saída em Marte;
// - publicado: fato relatado em página da NASA ou em artigo científico, conferido na página de origem;
// - calculado: conta feita pela equipe sobre um dado medido;
// - estimado: curva ou proporção nossa apoiada em uma medição;
// - hipotese: escolha da equipe, sem medição por trás;
// - simulado: valor inventado para demonstrar a interface;
// - ilustrativo: só aparência.

export const KINDS = Object.freeze({
  medido: 'Dado de sonda ou rover',
  publicado: 'Fato publicado',
  calculado: 'Cálculo sobre dado real',
  estimado: 'Estimativa a partir de medição',
  hipotese: 'Hipótese da equipe',
  simulado: 'Simulado',
  ilustrativo: 'Ilustrativo',
});

const entry = (item, kind, source, url = null) => Object.freeze({ item, kind, source, url });

export const SOURCE_GROUPS = Object.freeze([
  Object.freeze({
    title: 'Mapa e terreno',
    entries: Object.freeze([
      entry('Relevo e altitude', 'medido', 'Modelo de elevação MSL Gale Merged DEM 1 m v3, feito com pares estéreo da câmera HiRISE (sonda MRO), de Calef & Parker, USGS. A equipe reamostrou para uma grade de 8 m.', 'https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m'),
      entry('Imagem colorida do mapa (2,5 m por pixel)', 'medido', 'Mosaico colorido da HiRISE (MRO) usado pela equipe do Curiosity, NASA/JPL-Caltech/UArizona. Os ladrilhos vieram do artifact original da equipe; o identificador do produto de origem não foi registrado.'),
      entry('Detalhe de 64 cm por pixel', 'medido', 'NASA Mars Trek, camada curiosity_hirise_mosaic (HiRISE, MRO). Lido da rede ao aproximar.', 'https://trek.nasa.gov/mars/'),
      entry('Detalhe de 25 cm por pixel', 'medido', 'MSL Gale Merged Orthophoto Mosaic 25 cm v3 (HiRISE, MRO), de Calef & Parker, USGS. Lido da rede ao aproximar.', 'https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm'),
      entry('Declividade', 'calculado', 'Classes de declive sobre o DEM de 1 m do USGS. A imagem veio pronta do artifact original; o programa que a gerou não está no repositório.'),
      entry('Térmico (noite)', 'medido', 'Infravermelho térmico noturno do THEMIS (sonda Mars Odyssey), mosaico de 100 m servido pelo NASA Mars Trek. É brilho relativo da imagem, não temperatura em graus.', 'https://trek.nasa.gov/mars/'),
      entry('Unidade geológica', 'medido', 'Mapa geológico global de Marte, USGS SIM 3292 (Tanaka et al. 2014), 1:20.000.000: a área inteira é a unidade Htu. Consultado em 14/11/2026.', 'https://doi.org/10.3133/sim3292'),
      entry('Trajeto do Curiosity', 'medido', 'Mapa oficial da missão (MMGIS, NASA/JPL), sols 2300 a 4893. Os pontos vieram do artifact original; a data da cópia não foi registrada.', 'https://mars.nasa.gov/maps/location/?mission=MSL'),
      entry('Sombras do relevo', 'calculado', 'Sombra projetada pelo relevo do DEM para a posição calculada do Sol.'),
    ]),
  }),
  Object.freeze({
    title: 'Sol, clima e radiação',
    entries: Object.freeze([
      entry('Posição do Sol, nascer e pôr', 'calculado', 'Algoritmo Mars24 (Allison & McEwen 2000), do NASA GISS, para a estação de hoje em Marte. Não conta poeira nem refração.', 'https://www.giss.nasa.gov/tools/mars24/help/algorithm.html'),
      entry('Luz do dia que sobra para a saída', 'calculado', 'Hora do pôr do Sol (Mars24) menos a duração do plano.'),
      entry('Temperatura e pressão da estação', 'medido', 'REMS (Curiosity): média dos sols medidos na mesma estação do ano, lida do feed público da NASA. Sem rede, vale o sol típico de 2012 (JPL).', 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json'),
      entry('Temperatura por hora', 'estimado', 'Curva nossa entre a mínima (nascer do Sol) e a máxima (começo da tarde) medidas pelo REMS.'),
      entry('Radiação agora', 'medido', 'RAD (Curiosity): dose absorvida, média dos últimos 30 dias, lida da série msl_rad_dosimetry do NASA CCMC iSWA.', 'https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/info?id=msl_rad_dosimetry'),
      entry('Taxa de radiação do visor e do mapa', 'medido', 'RAD (Curiosity): 0,67 mSv por dia de dose equivalente, média de agosto de 2012 a junho de 2013 (cerca de 27,9 µSv/h).', 'https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/'),
      entry('Radiação menor onde o relevo protege', 'estimado', 'Céu tapado pelo relevo (calculado no DEM) na proporção medida pelo RAD em Murray Buttes: 4% a menos com 19% do céu tapado (Ehresmann et al. 2021). Acima de 19% é extrapolação em linha reta.', 'https://doi.org/10.1029/2021JE006851'),
      entry('Evento solar (cenário)', 'simulado', 'O disparo é um botão de cenário. No evento de 11/09/2017 o RAD mediu mais que o dobro de qualquer valor anterior; aplicar 2 vezes sobre a média é simplificação da equipe.', 'https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/'),
      entry('Vento', 'simulado', '5 m/s no normal e 28 m/s no cenário, sem fonte. O sensor de vento do REMS parou no sol 1491.'),
      entry('Tempestade de poeira e frio extremo (cenários)', 'simulado', 'Frente de poeira em 40 min, visibilidade de 30 m e 45 °C a menos: valores sem fonte, só para exercitar os protocolos.'),
    ]),
  }),
  Object.freeze({
    title: 'Rotas e segurança',
    entries: Object.freeze([
      entry('Distância, subida e declive das rotas', 'calculado', 'Caminho de menor custo sobre o DEM do USGS. A travessia do Monte Sharp veio pré-calculada do artifact original (DEM reamostrado a 2 m; o programa não está no repositório). A rota livre é calculada na hora, na grade de 8 m.'),
      entry('Velocidade e tempo', 'hipotese', '2,5 km/h a pé e 4,5 km/h de veículo em terreno plano, 45 min por parada. Na rota livre, o efeito do declive usa a função de caminhada de Tobler (1993), feita para a Terra.'),
      entry('Limite de declive', 'hipotese', '20° a pé e 15° de veículo.'),
      entry('Volta a pé até o habitat', 'calculado', 'Tempo de caminhada sobre o DEM, com a velocidade de hipótese.'),
      entry('Rádio', 'calculado', 'Linha de visada até o habitat sobre o DEM, com a curvatura de Marte. As alturas das antenas (10 m e 2 m) são hipótese.'),
      entry('Abrigo de relevo', 'calculado', 'Fração do céu tapada pelo relevo em volta, estimada sobre o DEM.'),
      entry('Zona de rochas cortantes', 'hipotese', 'O ponto é a posição oficial do Curiosity no sol 3420, onde a missão viu as rochas “gator-back” à frente e deu meia-volta. É a borda do terreno, não o centro, e não há contorno publicado: o círculo de 250 m é da equipe e cobre, a leste, chão por onde o rover passou sem problema.', 'https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reroutes-away-from-gator-back-rocks/'),
      entry('Oxigênio, bateria, pressão e integridade do traje', 'simulado', 'Não existe traje real: consumo de 12,5% por hora a pé e 4% na cabine, bateria de 9% e 5% por hora, reserva de 10%.'),
      entry('Limites dos alertas', 'hipotese', 'Dose de 1.000 µSv por saída, traje até −60 °C, vento de 15 e 25 m/s, 10 min sem rádio.'),
      entry('Protocolos de emergência', 'hipotese', 'Proposta da equipe. Cada protocolo cita a evidência de missões reais reunida em docs/pesquisa.md.'),
    ]),
  }),
  Object.freeze({
    title: 'Ciência e visor',
    entries: Object.freeze([
      entry('Posição e altitude das paradas', 'medido', 'Pontos do trajeto do Curiosity (MMGIS, NASA/JPL).', 'https://mars.nasa.gov/maps/location/?mission=MSL'),
      entry('Textos científicos das paradas', 'publicado', 'Conferidos em 14/11/2026 contra páginas da NASA e do JPL e artigos científicos; a fonte de cada parada aparece no cartão. A parada 2 fica no furo Sequoia, a cerca de 300 m da crista de Gediz Vallis.'),
      entry('Perguntas e tarefas das paradas', 'hipotese', 'Roteiro escrito pela equipe.'),
      entry('Fotos nas paradas', 'medido', 'Navcam do Curiosity no sol da parada, do acervo de imagens brutas da missão (NASA/JPL-Caltech).', 'https://mars.nasa.gov/msl/multimedia/raw-images/'),
      entry('Coletas que deram trabalho ao rover', 'publicado', 'Relatos da missão Curiosity, conferidos em 14/11/2026; o link de cada caso está no cartão. Em quatro dos sete casos a missão conseguiu amostra depois, ali perto.'),
      entry('Objetivo da missão e local do habitat', 'hipotese', 'Proposta da equipe. O objetivo científico e o local seguem como decisões em aberto no README.'),
      entry('Assistente do visor', 'simulado', 'Motor de regras local. Não é IA e não consulta nenhum dado externo.'),
      entry('Céu, chão além da área com dados e modelo do habitat', 'ilustrativo', 'Só aparência. Rochas soltas e montanhas desenhadas foram retiradas.'),
    ]),
  }),
]);

// Como cada recurso da aba Resources do desafio entra no protótipo (página conferida em 14/11/2026).
export const CHALLENGE_RESOURCES = Object.freeze([
  Object.freeze({ name: 'JPL Mars Trek', url: 'https://trek.nasa.gov/mars/', use: 'Usado como dado: detalhe HiRISE de 64 cm e camada térmica THEMIS, lidos dos ladrilhos do Trek.' }),
  Object.freeze({ name: 'USGS-NASA Planetary Geologic Mapping', url: 'https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars', use: 'Usado como dado: unidade geológica da área (SIM 3292). Do mesmo USGS Astrogeology vêm o relevo e a ortofoto de 25 cm.' }),
  Object.freeze({ name: 'Curiosity’s Proposed Path up Mount Sharp', url: 'https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/', use: 'Usado como referência do roteiro (argilas, pediment, Gediz Vallis, sulfatos). Não é fonte de número.' }),
  Object.freeze({ name: 'NASA Worldview', url: 'https://worldview.earthdata.nasa.gov/', use: 'Usado só como referência de interface em camadas. Os dados são da Terra e não se aplicam a Marte.' }),
  Object.freeze({ name: 'Mars Perseverance Raw Images', url: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/', use: 'Não usado como dado: o Perseverance está na cratera Jezero, não em Gale. Para Gale usamos o acervo equivalente do Curiosity, do mesmo serviço de imagens brutas da NASA.' }),
]);

// Endereços dos dados que o protótipo lê ou copiou, além das páginas de cada fonte (conferidos em 14/11/2026).
export const DATA_ENDPOINTS = Object.freeze([
  Object.freeze({ label: 'DEM de 1 m de Gale (arquivo GeoTIFF de 3,6 GB, USGS)', url: 'https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif' }),
  Object.freeze({ label: 'Ortofoto de 25 cm de Gale (arquivo GeoTIFF de 24 GB, USGS)', url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif' }),
  Object.freeze({ label: 'Mars Trek: catálogo da camada HiRISE do Curiosity (WMTS)', url: 'https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/WMTSCapabilities.xml' }),
  Object.freeze({ label: 'Mars Trek: catálogo da camada THEMIS noturna (WMTS)', url: 'https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml' }),
  Object.freeze({ label: 'RAD: série de dose do Curiosity (dados em CSV, NASA CCMC)', url: 'https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/data?id=msl_rad_dosimetry&format=csv' }),
]);
