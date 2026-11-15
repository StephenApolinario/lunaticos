# Planejador de travessia (Travessia Monte Sharp)

Comandos abaixo são executados a partir desta pasta (`planejador/`).

Planejador de travessias para exploração humana no Monte Sharp (cratera Gale, Marte). Projeto para o desafio de mapa de EVA em Marte da NASA Space Apps.

**Como funciona:** você marca os pontos no mapa 2D ou no terreno 3D, escolhe **a pé**, **veículo** ou **híbrido**, e o app calcula a melhor rota sobre o relevo real, o tempo da saída, os riscos, e simula a travessia.

**Planejar**
- **Mapa de alcance**: a partir da partida, o mapa mostra até onde dá para ir e voltar dentro do limite da saída (degradê + linhas a cada hora; fora do alcance escurece). Passe o mouse para ver o tempo de ida e volta
- **Modo híbrido**: veículo até onde o declive permite, ponto de desembarque automático, trecho final a pé e volta ao veículo
- **Tipos de parada** (coleta 40 min, observação 20, fotos 10, descanso 15), **otimizar ordem**, **desfazer** (Ctrl+Z) e **link do plano** para compartilhar (o plano fica no endereço)

**Decidir com segurança**
- **Tempo realista**: velocidade a pé em função do declive (função de Tobler, limitada a 3,6 km/h pelo traje); veículo a até 6 km/h, mais lento em declive
- **Limite da saída** (O₂) com alertas: tempo total acima do limite, **ponto de não retorno** (de onde voltar a pé já não cabe no limite) e a regra de retorno a pé se o veículo falhar
- **Rádio**: trechos sem linha de visada com a antena do habitat (10 m), calculados sobre o relevo e a curvatura de Marte
- **Cronograma** com hora de chegada e saída de cada parada, e tempo de volta a pé a partir de cada uma

**Simular**
- **Linha do tempo** da saída no 3D: o astronauta anda pela rota, o sol e as sombras acompanham a hora
- Câmeras **Livre**, **Seguir** e **Capacete** (primeira pessoa com HUD: próxima parada, declive, altitude, rádio, volta a pé, O₂ e alerta de "voltar agora")

**Visual**
- **Mapa 2D** (Leaflet): imagem HiRISE, declividade, trajeto do Curiosity
- **Terreno 3D** (three.js): imagem HiRISE a ~0,7 m/pixel, iluminação com o detalhe do DEM, sol ajustável com sombras, exagero vertical, bússola, altitude e declive sob o cursor

## Rodar a aplicação

Requisitos: Node 20+.

```bash
cd app
npm install
npm run dev               # versão ampliada
npm run dev:hackathon     # versão só com recursos listados no desafio
```

Produção: `npm run build` (→ `app/dist/`) e `npm run build:hackathon` (→ `app/dist-hackathon/`).

## Como a rota é calculada

O cálculo roda **no navegador**, em um Web Worker (`app/src/lib/router.worker.js`):

1. O pipeline Python exporta, uma vez, grades do terreno: custo a pé, custo de veículo, declividade e altitude (`app/public/grid/`).
2. Para cada par de pontos consecutivos, o app roda **A\*** (8 vizinhos) sobre a grade de custo e acha o caminho de menor custo.
3. Ao longo do caminho, mede distância real (com a subida), subida acumulada, declive máximo e perfil de altitude.

Custo de cada célula = 1 + declividade + rugosidade local + penalidade acima de um limite:

| | A pé | Veículo |
|---|---|---|
| Limite de declive (perfil conservador) | 15° | 15° |
| Rugosidade | pesa menos | pesa mais |
| Zona de rochas cortantes (só versão ampliada) | custo ×1,5 | custo ×25 |
| Terreno já percorrido pelo Curiosity (só versão ampliada) | normal | custo ×0,55 |

Células acima do limite são **intransitáveis**. Referências para o limite: o Curiosity registrou inclinação mediana de 9° e máxima de 29,1° nesta área (borda do Greenheugh, sol 2692, dado do trajeto oficial); o Perseverance subiu encostas acima de 20° em Jezero. O perfil conservador usa 15° para margem de segurança (ajuste em `PROFILES` no `export_grids.py`).

**Destino inacessível:**
- Ponto clicado numa encosta acima do limite: a rota usa o lugar transitável mais próximo e avisa a distância.
- Destino sem caminho dentro do limite (topo de mesa, área cercada de penhascos): a rota vai até o **ponto alcançável mais próximo**, o mapa mostra quanto faltou (linha tracejada) e o painel oferece **"Mover para o ponto acessível"**. No modo híbrido, o veículo vai até onde consegue e a equipe tenta o resto a pé.

Limitações: blocos menores que a resolução da grade (2 m ou 4 m) não aparecem; a zona de rochas cortantes tem posição aproximada; os pesos de custo são uma primeira estimativa; o tempo usa 2,5 km/h a pé, 4,5 km/h de veículo e 45 min por parada.

## Duas versões

| | Ampliada (`npm run dev`) | Hackathon (`npm run dev:hackathon`) |
|---|---|---|
| Fontes | NASA/JPL (mapa oficial do Curiosity, MMGIS) e USGS | Só recursos do desafio: JPL Mars Trek e PIA23179 |
| Imagem | HiRISE colorida (tiles baixados) | HiRISE preto e branco, ao vivo do Mars Trek |
| Relevo | DEM 1 m do USGS, grade de 2 m | DEM 1 m do Mars Trek, grade de 4 m |
| Trajeto do Curiosity | Completo até 2026 | Do Mars Trek, termina em 2018 |
| Zona de rochas cortantes | Sim (estimada) | Não |
| Tempo de cálculo típico | ~2 s | ~0,5 s |

## Estrutura

```
app/                   aplicação React + Vite
  src/
    App.jsx              estado: pontos da rota, modo, visão
    components/          Map2D, Scene3D, Panel, Profile
    lib/router.worker.js A* no navegador
    lib/useRouter.js     liga o worker ao React (recalcula ao mudar pontos/modo)
    lib/plan.js          resumo, tempo e avisos da rota
    data/stops.js        pontos de interesse científico e textos
    dataset.js           configuração das duas versões
  public/              dados da versão ampliada (grid/, 3d/, tiles/, data/, slope.png)
  public/hk/           dados da versão hackathon
pipeline/              scripts Python que geram os dados
data/, data_hk/        dados intermediários (relevo recortado etc.)
```

## Pipeline de dados

Requisitos: Python 3 e `pip install numpy requests imagecodecs scikit-image`.

**Versão ampliada**

```bash
python pipeline/tiffinfo.py data/tifftags.json                     # índice do DEM do USGS
python pipeline/dem_crop.py data/tifftags.json data/dem2m.npy      # recorte de 2 m (~1,5 min)
python pipeline/fetch_tiles.py app/public data                     # tiles HiRISE e trajeto do Curiosity
cp data/traverse.json app/public/data/
python pipeline/route.py data app/public                           # camada de declividade (slope.png)
python pipeline/export_grids.py data app/public                    # grades de custo para o roteador
python pipeline/fetch_hd_tiles.py data                             # tiles HiRISE zoom 17 para o 3D (~30 s)
python pipeline/export_3d.py data app/public                       # relevo, textura em faixas e mapa de inclinação
```

**Versão hackathon**

```bash
python pipeline/fetch_trek.py data_hk                              # relevo, imagem e trajeto do Mars Trek (~2 min)
python pipeline/route.py data_hk app/public/hk --strict
cp data_hk/traverse.json app/public/hk/data/
python pipeline/export_grids.py data_hk app/public/hk --strict
python pipeline/fetch_hd_tiles.py data_hk
python pipeline/export_3d.py data_hk app/public/hk
```

Para mudar o comportamento da rota, edite `PROFILES` em `pipeline/export_grids.py` e rode o `export_grids.py` de novo.

## Fontes

- Altitude: [MSL Gale Merged DEM 1m](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m), USGS Astrogeology (Calef & Parker); versão hackathon: *MRO HiRISE, Gale Crater DEM* no [JPL Mars Trek](https://trek.nasa.gov/mars/)
- Imagem e trajeto: [mapa oficial do Curiosity](https://mars.nasa.gov/maps/location/?mission=MSL) (NASA/JPL-Caltech, MMGIS), HiRISE (MRO, University of Arizona); versão hackathon: JPL Mars Trek
- Unidades geológicas: [Curiosity's Proposed Path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) (PIA23179)
