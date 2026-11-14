# lunaticos

Projeto da equipe para o **NASA Space Apps Challenge 2026**, desafio
[Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/).

- Dificuldade: intermediária
- Temas: Human Exploration, Mars, Planets & Moons, Software, Space Exploration
- Página consultada em 14/11/2026. A NASA avisa que pode adicionar recursos antes do hackathon, então vale reconferir a aba Resources.

## O desafio

Criar uma visão **integrada e em camadas** de um local ou de uma rota na superfície de Marte, juntando dados de várias missões científicas da NASA, para ajudar um explorador humano a planejar e executar uma caminhada em Marte ("Marswalk") com segurança, fazendo ciência nova pelo caminho.

O problema de fundo: os dados de Marte existem, mas não estão combinados do jeito que uma missão humana específica precisa. Ferramentas como o Mars Trek e o mapeamento geológico USGS-NASA são feitas para visões regionais e globais, não para a área hiperlocal de uma única saída de superfície. É nesse recorte hiperlocal que a nossa entrega tem que funcionar.

## O que a entrega precisa cobrir

- Um mapa, ferramenta ou interface que um astronauta usaria durante uma missão de exploração de superfície, feito com dados e ferramentas da NASA.
- Um **objetivo científico** e um **local** que combinem. Exemplo da própria NASA: estudar formações "boxwork" na região do Monte Sharp, que o Curiosity observou em 2025.
- **Pelo menos três tipos de dado** em camadas ou combinados: óptico, térmico, espectral, topográfico, geofísico, atmosférico, radiação, químico.
- **Segurança do astronauta em primeiro lugar.** O ambiente de radiação de Marte é diferente do da Terra, da órbita e da Lua, então dados de clima espacial contam.
- **Mobilidade real.** O astronauta está de traje e carregando equipamento. Se possível, um mapa de rota que cumpra os objetivos científicos desviando de obstáculos grandes, como formações rochosas.

O local pode ser um já bem explorado por rovers (mais dados e imagens) ou um pouco estudado (mais difícil).

## Considerações opcionais

- Formato: tela no habitat ou na nave para planejar a rota, app de tablet levado na saída, HUD no visor do capacete, ou outro.
- Tipo de produto: retrato estático, produto interativo, ou sistema que gera mapas de locais e dados diferentes.
- Recorte de tempo: dados de um período passado, previsão para um período futuro, ou nenhum (para dados estáveis como topografia e geologia).
- Imagens em ponto de vista das missões de superfície, para o astronauta saber o que esperar ao chegar.
- Apoio de rovers ou robôs no transporte, ou astronautas trabalhando em dupla.
- Inspiração em mapas de outras missões da NASA (Terra, Lua, outros planetas, exoplanetas).

## Recursos da NASA

| Recurso | Para que serve |
|---|---|
| [JPL Mars Trek](https://trek.nasa.gov/mars/) | Portal web com dados da NASA em vários locais de pouso |
| [USGS-NASA Planetary Geologic Mapping](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars) | Mapa geológico padronizado de Marte |
| [Rota proposta do Curiosity no Monte Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) | Exemplo visual de mapa de rota |
| [Galeria de imagens brutas do Perseverance](https://mars.nasa.gov/mars2020/multimedia/raw-images/) | Mais de 1 milhão de imagens da superfície |
| [NASA Worldview](https://worldview.earthdata.nasa.gov/) | Referência de visualização em camadas (dados da Terra) |

A NASA não endossa sites fora do governo dos EUA. Ao usar dados de terceiros, seguir os termos de uso de cada site.

## Protótipo

A pasta `prototipo/` tem um protótipo em Three.js para validar a ideia de duas telas sobre a mesma rota: o mapa de planejamento (tablet) e o visor do capacete. Ele usa a travessia do Monte Sharp como exemplo. Não tem build; basta servir a pasta:

```bash
python3 prototipo/tools/servir.py
```

Depois abrir http://localhost:5183. Para conferir a matemática de projeção, rotas e relevo:

```bash
node prototipo/src/check.mjs
```

O que ele faz hoje:

- **Tablet:** mapa 3D com relevo e imagem reais, camadas (declive, volta a pé, rádio, radiação, temperatura), a travessia do Monte Sharp com as paradas científicas e o painel "Segurança da saída".
- **Destino livre:** um clique no mapa calcula na hora a rota de ida e volta sobre o relevo real, a pé ou de veículo, na opção mais rápida ou mais segura.
- **Segurança:** até onde o oxigênio cobre a volta a pé, onde a rota perde o rádio direto com o habitat, o abrigo no ponto mais afastado e o protocolo de cada cenário de perigo.
- **O que o rover não conseguiu coletar:** sete tentativas de perfuração do Curiosity que falharam na região, cada uma com a fonte e um botão que planeja a ida até lá.
- **Visor do capacete:** um visor único com alertas por gravidade, protocolos de emergência conduzidos passo a passo, abrigo mais próximo, minimapa, perfil do terreno à frente, guia no chão, assistente por texto e voz, ciência nas paradas, diário de amostras e relato de perigos. Ele nasceu da junção de três variantes, que continuam em `prototipo/visores/` (ver `prototipo/visores/LEIA-ME.md`).

A pesquisa que sustenta os protocolos e as lições de missões passadas está em [docs/pesquisa.md](docs/pesquisa.md), com link em cada fato.

O que é dado real e o que é simulado no protótipo:

- **Real:** o relevo, a imagem orbital HiRISE, o mapa de declive, o trajeto e as altitudes do Curiosity, as rotas a pé e de veículo com perfil de altitude e as paradas científicas.
- **Simulado:** as camadas de radiação e temperatura, a telemetria do traje e as mensagens do copiloto.
- **Hipótese da equipe:** velocidade a pé e de veículo, consumo de oxigênio, reserva de 10%, alturas das antenas de rádio e os protocolos de emergência.

As rotas de destino livre usam a função de caminhada de Tobler sobre a grade de 8 m; blocos menores que isso não aparecem, então elas servem para planejar e não substituem a leitura do terreno.

Os dados ficam em `prototipo/assets/` (cerca de 10 MB):

| Dado | Fonte |
|---|---|
| Relevo (`elevation/`, grade de 8 m) | [MSL Gale Merged DEM 1 m v3](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m), Calef & Parker, USGS Astrogeology / JPL-Caltech / NASA |
| Imagem (`hirise/`) | HiRISE colorida (MRO), mosaico da equipe MSL, NASA/JPL-Caltech/UArizona |
| Declive (`slope.png`) | Classes de declive calculadas sobre o mesmo DEM |

O relevo é um recorte do DEM de 3,6 GB do USGS, lido direto do servidor. Para refazer o recorte (leva alguns minutos):

```bash
cd prototipo/tools && npm install && npm run extrair-dem
```

Se o arquivo de relevo faltar, o protótipo abre com um relevo aproximado e avisa no selo do mapa.

O protótipo não fecha nenhuma das decisões abaixo.

## Decisões em aberto

Nada abaixo foi decidido ainda.

- Objetivo científico da missão
- Local ou rota em Marte
- Quais camadas de dado entram (mínimo três tipos) e de quais missões
- Formato da entrega (habitat, tablet, HUD, outro)
- Stack técnica
