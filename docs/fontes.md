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

10. **Posição do Sol, nascer e pôr** — Cálculo sobre dado real. Algoritmo Mars24 (Allison & McEwen 2000), do NASA GISS, para a estação de hoje em Marte. Não conta poeira nem refração. [fonte](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html)
11. **Luz do dia que sobra para a saída** — Cálculo sobre dado real. Hora do pôr do Sol (Mars24) menos a duração do plano.
12. **Temperatura e pressão da estação** — Medição de missão. REMS (Curiosity): média dos sols medidos na mesma estação do ano, lida do feed público da NASA. Sem rede, vale o sol típico de 2012 (JPL). [fonte](https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json)
13. **Temperatura por hora** — Estimativa a partir de medição. Curva nossa entre a mínima (nascer do Sol) e a máxima (começo da tarde) medidas pelo REMS.
14. **Radiação agora** — Medição de missão. RAD (Curiosity): dose absorvida, média dos últimos 30 dias, lida da série msl_rad_dosimetry do NASA CCMC iSWA. [fonte](https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/info?id=msl_rad_dosimetry)
15. **Taxa de radiação do visor e do mapa** — Medição de missão. RAD (Curiosity): 0,67 mSv por dia de dose equivalente, média de agosto de 2012 a junho de 2013 (cerca de 27,9 µSv/h). [fonte](https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/)
16. **Radiação menor onde o relevo protege** — Estimativa a partir de medição. Céu tapado pelo relevo (calculado no DEM) na proporção medida pelo RAD em Murray Buttes: 4% a menos com 19% do céu tapado (Ehresmann et al. 2021). Acima de 19% é extrapolação em linha reta. [fonte](https://doi.org/10.1029/2021JE006851)
17. **Evento solar (cenário)** — Simulado. O disparo é um botão de cenário. No evento de 11/09/2017 o RAD mediu mais que o dobro de qualquer valor anterior; aplicar 2 vezes sobre a média é simplificação da equipe. [fonte](https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/)
18. **Vento** — Simulado. 5 m/s no normal e 28 m/s no cenário, sem fonte. O sensor de vento do REMS parou no sol 1491.
19. **Tempestade de poeira e frio extremo (cenários)** — Simulado. Frente de poeira em 40 min, visibilidade de 30 m e 45 °C a menos: valores sem fonte, só para exercitar os protocolos.

## Rotas e segurança

20. **Distância, subida e declive das rotas** — Cálculo sobre dado real. Caminho de menor custo sobre o DEM do USGS. A travessia do Monte Sharp veio pré-calculada do artifact original (DEM reamostrado a 2 m; o programa não está no repositório). A rota livre é calculada na hora, na grade de 8 m.
21. **Velocidade e tempo** — Hipótese da equipe. 2,5 km/h a pé e 4,5 km/h de veículo em terreno plano, 45 min por parada. Na rota livre, o efeito do declive usa a função de caminhada de Tobler (1993), feita para a Terra.
22. **Limite de declive** — Hipótese da equipe. 20° a pé e 15° de veículo.
23. **Volta a pé até o habitat** — Cálculo sobre dado real. Tempo de caminhada sobre o DEM, com a velocidade de hipótese.
24. **Rádio** — Cálculo sobre dado real. Linha de visada até o habitat sobre o DEM, com a curvatura de Marte. As alturas das antenas (10 m e 2 m) são hipótese.
25. **Abrigo de relevo** — Cálculo sobre dado real. Fração do céu tapada pelo relevo em volta, estimada sobre o DEM.
26. **Zona de rochas cortantes** — Hipótese da equipe. O ponto é a posição oficial do Curiosity no sol 3420, onde a missão viu as rochas “gator-back” à frente e deu meia-volta. É a borda do terreno, não o centro, e não há contorno publicado: o círculo de 250 m é da equipe e cobre, a leste, chão por onde o rover passou sem problema. [fonte](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reroutes-away-from-gator-back-rocks/)
27. **Oxigênio, bateria, pressão e integridade do traje** — Simulado. Não existe traje real: consumo de 12,5% por hora a pé e 4% na cabine, bateria de 9% e 5% por hora, reserva de 10%.
28. **Limites dos alertas** — Hipótese da equipe. Dose de 1.000 µSv por saída, traje até −60 °C, vento de 15 e 25 m/s, 10 min sem rádio.
29. **Protocolos de emergência** — Hipótese da equipe. Proposta da equipe. Cada protocolo cita a evidência de missões reais reunida em docs/pesquisa.md.

## Ciência e visor

30. **Posição e altitude das paradas** — Medição de missão. Pontos do trajeto do Curiosity (MMGIS, NASA/JPL). [fonte](https://mars.nasa.gov/maps/location/?mission=MSL)
31. **Textos científicos das paradas** — Fato publicado pela missão. Conferidos em 14/11/2026 contra páginas da NASA e do JPL e artigos científicos; a fonte de cada parada aparece no cartão. A parada 2 fica no furo Sequoia, a cerca de 300 m da crista de Gediz Vallis.
32. **Perguntas e tarefas das paradas** — Hipótese da equipe. Roteiro escrito pela equipe.
33. **Fotos nas paradas** — Medição de missão. Navcam do Curiosity no sol da parada, do acervo de imagens brutas da missão (NASA/JPL-Caltech). [fonte](https://mars.nasa.gov/msl/multimedia/raw-images/)
34. **Coletas que deram trabalho ao rover** — Fato publicado pela missão. Relatos da missão Curiosity, conferidos em 14/11/2026; o link de cada caso está no cartão. Em quatro dos sete casos a missão conseguiu amostra depois, ali perto.
35. **Objetivo da missão e local do habitat** — Hipótese da equipe. Proposta da equipe. O objetivo científico e o local seguem como decisões em aberto no README.
36. **Assistente do visor** — Simulado. Motor de regras local. Não é IA e não consulta nenhum dado externo.
37. **Céu, chão além da área com dados e modelo do habitat** — Ilustrativo. Só aparência. Rochas soltas e montanhas desenhadas foram retiradas.

## Recursos da aba Resources do desafio

- [JPL Mars Trek](https://trek.nasa.gov/mars/): Usado como dado: detalhe HiRISE de 64 cm e camada térmica THEMIS, lidos dos ladrilhos do Trek.
- [USGS-NASA Planetary Geologic Mapping](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars): Usado como dado: unidade geológica da área (SIM 3292). Do mesmo USGS Astrogeology vêm o relevo e a ortofoto de 25 cm.
- [Curiosity’s Proposed Path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/): Usado como referência do roteiro (argilas, pediment, Gediz Vallis, sulfatos). Não é fonte de número.
- [NASA Worldview](https://worldview.earthdata.nasa.gov/): Usado só como referência de interface em camadas. Os dados são da Terra e não se aplicam a Marte.
- [Mars Perseverance Raw Images](https://mars.nasa.gov/mars2020/multimedia/raw-images/): Não usado como dado: o Perseverance está na cratera Jezero, não em Gale. Para Gale usamos o acervo equivalente do Curiosity, do mesmo serviço de imagens brutas da NASA.

## Todos os links

Só os links, sem repetir: 86 no total, agrupados por onde são usados.

### Dados e serviços usados pelo protótipo (23)

- [Relevo e altitude](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m)
- [Detalhe de 64 cm por pixel](https://trek.nasa.gov/mars/)
- [Detalhe de 25 cm por pixel](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- [Unidade geológica](https://doi.org/10.3133/sim3292)
- [Trajeto do Curiosity](https://mars.nasa.gov/maps/location/?mission=MSL)
- [Posição do Sol, nascer e pôr](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html)
- [Temperatura e pressão da estação](https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json)
- [Radiação agora](https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/info?id=msl_rad_dosimetry)
- [Taxa de radiação do visor e do mapa](https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/)
- [Radiação menor onde o relevo protege](https://doi.org/10.1029/2021JE006851)
- [Evento solar (cenário)](https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/)
- [Zona de rochas cortantes](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reroutes-away-from-gator-back-rocks/)
- [Fotos nas paradas](https://mars.nasa.gov/msl/multimedia/raw-images/)
- [USGS-NASA Planetary Geologic Mapping](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars)
- [Curiosity’s Proposed Path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/)
- [NASA Worldview](https://worldview.earthdata.nasa.gov/)
- [Mars Perseverance Raw Images](https://mars.nasa.gov/mars2020/multimedia/raw-images/)
- [JPL, 21/08/2012 · REMS/Curiosity](https://www.jpl.nasa.gov/news/nasas-curiosity-studies-mars-surroundings-nears-drive/)
- [DEM de 1 m de Gale (arquivo GeoTIFF de 3,6 GB, USGS)](https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif)
- [Ortofoto de 25 cm de Gale (arquivo GeoTIFF de 24 GB, USGS)](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif)
- [Mars Trek: catálogo da camada HiRISE do Curiosity (WMTS)](https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/WMTSCapabilities.xml)
- [Mars Trek: catálogo da camada THEMIS noturna (WMTS)](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml)
- [RAD: série de dose do Curiosity (dados em CSV, NASA CCMC)](https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/data?id=msl_rad_dosimetry&format=csv)

### Ciência das paradas (10)

- [JPL, 2019 · argila em Glen Torridon](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-finds-a-clay-cache/)
- [Bennett et al. 2022, JGR Planets](https://doi.org/10.1029/2022JE007185)
- [JPL, 2020 · subida ao pedimento](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-takes-a-new-selfie-before-record-climb/)
- [JPL, 2023 · crista de Gediz Vallis](https://www.jpl.nasa.gov/news/nasas-curiosity-reaches-mars-ridge-where-water-left-debris-pileup/)
- [JPL, 2024 · enxofre puro](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/)
- [VanBommel et al. 2026, Science](https://doi.org/10.1126/science.adu5501)
- [NASA, 2026 · boxwork de perto](https://www.nasa.gov/missions/mars-science-laboratory/curiosity-rover/nasas-curiosity-rover-sees-martian-spiderwebs-up-close/)
- [JPL, 2024 · extensão e Wind Cave](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-takes-a-last-look-at-mysterious-sulfur/)
- [NASA, blog da missão · sols 4845–4851](https://science.nasa.gov/blog/curiosity-blog-sols-4845-4851-bye-bye-boxwork-bye-bye/)
- [JPL, 2022 · região de sulfatos](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reaches-long-awaited-salty-region/)

### Coletas do rover (7)

- [JPL, PIA23138](https://www.jpl.nasa.gov/images/pia23138-curiositys-first-clay-unit-drill-hole/)
- [Blog da missão, sols 3677–3679 (tentativa no sol 3676)](https://science.nasa.gov/blog/sols-3677-3679-lets-try-that-again-amapari/)
- [Blog da missão, sol 3721 (tentativa no sol 3718)](https://science.nasa.gov/blog/sol-3721-wrapping-up-at-the-encanto-drill-site/)
- [Blog da missão, sols 3744–3745](https://science.nasa.gov/blog/sols-3744-3745-the-one-that-got-away/)
- [Blog da missão, sols 4125–4126](https://science.nasa.gov/blog/sols-4125-4126-woohoo-were-go-for-drilling-at-mineral-king-3/)
- [Blog da missão, sols 4214–4215](https://science.nasa.gov/blog/sols-4214-4215-the-best-laid-plans/)
- [Blog da missão, sols 4879–4885](https://science.nasa.gov/blog/curiosity-blog-sols-4879-4885-struggle-at-atacama/)

### Protocolos de emergência (10)

- [Viúdez-Moreiras et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/)
- [JPL, 10/06/2024](https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/)
- [JPL](https://www.jpl.nasa.gov/news/how-nasas-curiosity-rover-is-making-mars-safer-for-astronauts/)
- [Ullán et al. 2017 (resumo)](https://cab.inta-csic.es/en/publicaciones/analysis-of-wind-induced-dynamic-pressure-fluctuations-during-one-and-a-half-martian-years-at-gale-crater/)
- [Manual do LCRU, 1971](https://apollojournals.org/alsj/HSI-481184-LCRU.pdf)
- [NASA OCHMO-TB-023](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-023-extraterrestrial-surface-transport-vehicles-rovers.pdf)
- [NASA EVA-EXP-0042 Rev. B](https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf)
- [JPL, PIA07999](https://www.jpl.nasa.gov/images/pia07999-looking-back-at-purgatory-dune/)
- [NASA, podcast On a Mission](https://www.nasa.gov/podcasts/on-a-mission/a-lifetime-on-mars-the-adventures-of-spirit-and-opportunity-s4e4/)
- [JPL, 12/11/2009](https://www.jpl.nasa.gov/news/nasa-to-begin-attempts-to-free-sand-trapped-mars-rover/)

### Pesquisa (docs/pesquisa.md) (36)

- [JPL, 25/06/2009](https://www.jpl.nasa.gov/news/mars-rover-yielding-new-clues-while-lodged-in-martian-soil/)
- [JPL, página da missão](https://www.jpl.nasa.gov/missions/mars-exploration-rover-spirit-mer-spirit/)
- [JPL Robotics](https://www-robotics.jpl.nasa.gov/news/learning-to-drive-the-mars-rovers/)
- [JPL, 21/03/2017](https://www.jpl.nasa.gov/news/breaks-observed-in-rover-wheel-treads/)
- [JPL, 2017](https://www.jpl.nasa.gov/news/an-algorithm-helps-protect-mars-curiositys-wheels/)
- [NTRS 20230005728](https://ntrs.nasa.gov/citations/20230005728)
- [JPL, 2023](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-gets-a-major-software-upgrade/)
- [ALSJ, Apollo 17 Replacement Fender](https://apollojournals.org/alsj/a17/A17NewFender.html)
- [Gaier, NASA/TM-2005-213610](https://ntrs.nasa.gov/api/citations/20050160460/downloads/20050160460.pdf)
- [Gaier, resumo no NTRS](https://ntrs.nasa.gov/citations/20050160460)
- [NASA NSSDCA](https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo_lrv.html)
- [Bellcomm B70 10028](https://apollojournals.org/alsj/19790073512_1979073512.pdf)
- [ALSJ, Apollo 17, Station 2](https://apollojournals.org/alsj/a17/a17.sta2.html)
- [ALSJ, Camelot to Station 2](https://apollojournals.org/alsj/a17/a17.trvsta2.html)
- [NTRS 20230005798](https://ntrs.nasa.gov/citations/20230005798)
- [JPL, 2018](https://jpl.nasa.gov/news/news.php?feature=7230)
- [Bennett et al. 2022, JGR Planets](https://ntrs.nasa.gov/api/citations/20230001618/downloads/JGR%20Planets%20-%202022%20-%20Bennett%20-%20The%20Curiosity%20Rover%20s%20Exploration%20of%20.pdf)
- [blog, sols 3682–3683](https://science.nasa.gov/blog/sols-3682-3683-perspective/)
- [blog, sols 4125–4126](https://science.nasa.gov/missions/mars-science-laboratory/sols-4125-4126-woohoo-were-go-for-drilling-at-mineral-king-3/)
- [blog, sols 4120–4122](https://science.nasa.gov/blog/sols-4120-4122-mars-throws-us-a-curveball/)
- [blog, sols 4127–4130](https://science.nasa.gov/blog/sols-4127-4130-backstage-quick-change/)
- [NASA Photojournal](https://science.nasa.gov/photojournal/nasas-curiosity-rover-frees-its-drill-from-a-rock/)
- [blog, sols 4900–4907](https://science.nasa.gov/blog/curiosity-blog-sols-4900-4907-pasadena-we-have-a-drill-sample/)
- [blog, sols 3759–3761](https://science.nasa.gov/blog/sols-3759-3761-more-analyses-of-the-tapo-caparo-drill-sample/)
- [JPL, 2023](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-faces-its-toughest-climb-yet-on-mars/)
- [NASA/JPL, 2020](https://www.nasa.gov/centers-and-facilities/jpl/curiosity-mars-rovers-summer-road-trip-has-begun/?site=msl)
- [blog, sols 4641–4648](https://science.nasa.gov/blog/curiosity-blog-sols-4641-4648-thinking-outside-and-inside-the-boxwork/)
- [NASA Science](https://science.nasa.gov/resource/radiation-measurements-on-mars/)
- [SwRI](https://www.swri.org/newsroom/press-releases/swri-scientists-publish-first-radiation-measurements-the-surface-of-mars)
- [Hassler et al. 2014, Science](https://doi.org/10.1126/science.1244797)
- [JPL, 2016](https://www.jpl.nasa.gov/news/second-cycle-of-martian-seasons-completing-for-curiosity-rover/)
- [JPL, 20/06/2018](https://www.jpl.nasa.gov/news/martian-dust-storm-grows-global-curiosity-captures-photos-of-thickening-haze/)
- [ICES-2026-126](https://ntrs.nasa.gov/api/citations/20260003024/downloads/Final_ICES2026_Mars_PLSS_Plan.pdf)
- [Axiom Space, 16/10/2024](https://www.axiomspace.com/release/axiom-space-prada-unveil-spacesuit-design-for-moon-return)
- [ALSJ, PLSS](https://apollojournals.org/alsj/plss.html)
- [JPL, 2020](https://jpl.nasa.gov/news/news.php?feature=7617)
