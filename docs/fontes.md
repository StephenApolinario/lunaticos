# De onde vem cada informação

Gerado por `node prototipo/tools/gerar-fontes.mjs` a partir de `prototipo/data/fontes.js`. Para corrigir, edite aquele arquivo e gere de novo.

Cada item diz o tipo: medição de missão, cálculo sobre dado real, estimativa a partir de medição, hipótese da equipe, simulado ou ilustrativo.

Resumo: 12 medição de missão · 2 fato publicado pela missão · 8 cálculo sobre dado real · 2 estimativa a partir de medição · 7 hipótese da equipe · 5 simulado · 1 ilustrativo.

## Mapa e terreno

1. **Relevo e altitude** — Medição de missão. Modelo de elevação MSL Gale Merged DEM 1 m v3, feito com pares estéreo da câmera HiRISE (sonda MRO), de Calef & Parker, USGS. A equipe reamostrou para uma grade de 8 m. [fonte](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m)
2. **Imagem colorida do mapa (2,5 m por pixel)** — Medição de missão. Mosaico colorido da HiRISE (MRO) usado pela equipe do Curiosity, NASA/JPL-Caltech/UArizona. Os ladrilhos vieram do artifact original da equipe; o identificador do produto de origem não foi registrado.
3. **Detalhe de 64 cm por pixel** — Medição de missão. NASA Mars Trek, camada curiosity_hirise_mosaic (HiRISE, MRO). Lido da rede ao aproximar. [fonte](https://trek.nasa.gov/mars/)
4. **Detalhe de 25 cm por pixel** — Medição de missão. MSL Gale Merged Orthophoto Mosaic 25 cm v3 (HiRISE, MRO), de Calef & Parker, USGS. Lido da rede ao aproximar. [fonte](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
5. **Declividade** — Cálculo sobre dado real. Classes de declive sobre o DEM de 1 m do USGS. A imagem veio pronta do artifact original; o programa que a gerou não está no repositório.
6. **Térmico (noite)** — Medição de missão. Infravermelho térmico noturno do THEMIS (sonda Mars Odyssey), mosaico de 100 m servido pelo NASA Mars Trek. É brilho relativo da imagem, não temperatura em graus. [fonte](https://trek.nasa.gov/mars/)
7. **Unidade geológica** — Medição de missão. Mapa geológico global de Marte, USGS SIM 3292 (Tanaka et al. 2014), 1:20.000.000: a área inteira é a unidade Htu. Consultado em 14/11/2026. [fonte](https://doi.org/10.3133/sim3292)
8. **Trajeto do Curiosity** — Medição de missão. Mapa oficial da missão (MMGIS, NASA/JPL), sols 2300 a 4893. Os pontos vieram do artifact original; a data da cópia não foi registrada. [fonte](https://mars.nasa.gov/maps/location/?mission=MSL)
9. **Sombras do relevo** — Cálculo sobre dado real. Sombra projetada pelo relevo do DEM para a posição calculada do Sol.

## Sol, clima e radiação

1. **Posição do Sol, nascer e pôr** — Cálculo sobre dado real. Algoritmo Mars24 (Allison & McEwen 2000), do NASA GISS, para a estação de hoje em Marte. Não conta poeira nem refração. [fonte](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html)
2. **Luz do dia que sobra para a saída** — Cálculo sobre dado real. Hora do pôr do Sol (Mars24) menos a duração do plano.
3. **Temperatura e pressão da estação** — Medição de missão. REMS (Curiosity): média dos sols medidos na mesma estação do ano, lida do feed público da NASA. Sem rede, vale o sol típico de 2012 (JPL). [fonte](https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json)
4. **Temperatura por hora** — Estimativa a partir de medição. Curva nossa entre a mínima (nascer do Sol) e a máxima (começo da tarde) medidas pelo REMS.
5. **Radiação agora** — Medição de missão. RAD (Curiosity): dose absorvida, média dos últimos 30 dias, lida da série msl_rad_dosimetry do NASA CCMC iSWA. [fonte](https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/info?id=msl_rad_dosimetry)
6. **Taxa de radiação do visor e do mapa** — Medição de missão. RAD (Curiosity): 0,67 mSv por dia de dose equivalente, média de agosto de 2012 a junho de 2013 (cerca de 27,9 µSv/h). [fonte](https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/)
7. **Radiação menor onde o relevo protege** — Estimativa a partir de medição. Céu tapado pelo relevo (calculado no DEM) na proporção medida pelo RAD em Murray Buttes: 4% a menos com 19% do céu tapado (Ehresmann et al. 2021). Acima de 19% é extrapolação em linha reta. [fonte](https://doi.org/10.1029/2021JE006851)
8. **Evento solar (cenário)** — Simulado. O disparo é um botão de cenário. No evento de 11/09/2017 o RAD mediu mais que o dobro de qualquer valor anterior; aplicar 2 vezes sobre a média é simplificação da equipe. [fonte](https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/)
9. **Vento** — Simulado. 5 m/s no normal e 28 m/s no cenário, sem fonte. O sensor de vento do REMS parou no sol 1491.
10. **Tempestade de poeira e frio extremo (cenários)** — Simulado. Frente de poeira em 40 min, visibilidade de 30 m e 45 °C a menos: valores sem fonte, só para exercitar os protocolos.

## Rotas e segurança

1. **Distância, subida e declive das rotas** — Cálculo sobre dado real. Caminho de menor custo sobre o DEM do USGS. A travessia do Monte Sharp veio pré-calculada do artifact original (DEM reamostrado a 2 m; o programa não está no repositório). A rota livre é calculada na hora, na grade de 8 m.
2. **Velocidade e tempo** — Hipótese da equipe. 2,5 km/h a pé e 4,5 km/h de veículo em terreno plano, 45 min por parada. Na rota livre, o efeito do declive usa a função de caminhada de Tobler (1993), feita para a Terra.
3. **Limite de declive** — Hipótese da equipe. 20° a pé e 15° de veículo.
4. **Volta a pé até o habitat** — Cálculo sobre dado real. Tempo de caminhada sobre o DEM, com a velocidade de hipótese.
5. **Rádio** — Cálculo sobre dado real. Linha de visada até o habitat sobre o DEM, com a curvatura de Marte. As alturas das antenas (10 m e 2 m) são hipótese.
6. **Abrigo de relevo** — Cálculo sobre dado real. Fração do céu tapada pelo relevo em volta, estimada sobre o DEM.
7. **Zona de rochas cortantes** — Hipótese da equipe. O ponto é a posição oficial do Curiosity no sol 3420, onde a missão viu as rochas “gator-back” à frente e deu meia-volta. É a borda do terreno, não o centro, e não há contorno publicado: o círculo de 250 m é da equipe e cobre, a leste, chão por onde o rover passou sem problema. [fonte](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reroutes-away-from-gator-back-rocks/)
8. **Oxigênio, bateria, pressão e integridade do traje** — Simulado. Não existe traje real: consumo de 12,5% por hora a pé e 4% na cabine, bateria de 9% e 5% por hora, reserva de 10%.
9. **Limites dos alertas** — Hipótese da equipe. Dose de 1.000 µSv por saída, traje até −60 °C, vento de 15 e 25 m/s, 10 min sem rádio.
10. **Protocolos de emergência** — Hipótese da equipe. Proposta da equipe. Cada protocolo cita a evidência de missões reais reunida em docs/pesquisa.md.

## Ciência e visor

1. **Posição e altitude das paradas** — Medição de missão. Pontos do trajeto do Curiosity (MMGIS, NASA/JPL). [fonte](https://mars.nasa.gov/maps/location/?mission=MSL)
2. **Textos científicos das paradas** — Fato publicado pela missão. Conferidos em 14/11/2026 contra páginas da NASA e do JPL e artigos científicos; a fonte de cada parada aparece no cartão. A parada 2 fica no furo Sequoia, a cerca de 300 m da crista de Gediz Vallis.
3. **Perguntas e tarefas das paradas** — Hipótese da equipe. Roteiro escrito pela equipe.
4. **Fotos nas paradas** — Medição de missão. Navcam do Curiosity no sol da parada, do acervo de imagens brutas da missão (NASA/JPL-Caltech). [fonte](https://mars.nasa.gov/msl/multimedia/raw-images/)
5. **Coletas que deram trabalho ao rover** — Fato publicado pela missão. Relatos da missão Curiosity, conferidos em 14/11/2026; o link de cada caso está no cartão. Em quatro dos sete casos a missão conseguiu amostra depois, ali perto.
6. **Objetivo da missão e local do habitat** — Hipótese da equipe. Proposta da equipe. O objetivo científico e o local seguem como decisões em aberto no README.
7. **Assistente do visor** — Simulado. Motor de regras local. Não é IA e não consulta nenhum dado externo.
8. **Céu, chão além da área com dados e modelo do habitat** — Ilustrativo. Só aparência. Rochas soltas e montanhas desenhadas foram retiradas.

## Recursos da aba Resources do desafio

- [JPL Mars Trek](https://trek.nasa.gov/mars/): Usado como dado: detalhe HiRISE de 64 cm e camada térmica THEMIS, lidos dos ladrilhos do Trek.
- [USGS-NASA Planetary Geologic Mapping](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars): Usado como dado: unidade geológica da área (SIM 3292). Do mesmo USGS Astrogeology vêm o relevo e a ortofoto de 25 cm.
- [Curiosity’s Proposed Path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/): Usado como referência do roteiro (argilas, pediment, Gediz Vallis, sulfatos). Não é fonte de número.
- [NASA Worldview](https://worldview.earthdata.nasa.gov/): Usado só como referência de interface em camadas. Os dados são da Terra e não se aplicam a Marte.
- [Mars Perseverance Raw Images](https://mars.nasa.gov/mars2020/multimedia/raw-images/): Não usado como dado: o Perseverance está na cratera Jezero, não em Gale. Para Gale usamos o acervo equivalente do Curiosity, do mesmo serviço de imagens brutas da NASA.
