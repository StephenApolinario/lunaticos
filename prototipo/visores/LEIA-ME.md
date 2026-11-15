# Variantes de visor

O visor do capacete é uma peça plugável. Cada variante mora em `visores/<id>/` e é escolhida pela URL: `http://localhost:5183/?visor=<id>` (ou pelo seletor "Variante do visor" no painel do tablet).

Variantes registradas em [registry.js](registry.js): `unificado` (o padrão), `base`, `guardiao`, `navegador`, `cientista`.

O visor [unificado/](unificado/NOTAS.md) é o do produto: usa o Guardião como base e traz o minimapa, o perfil e a guia do Navegador e o assistente, a ciência nas paradas, o diário e o relato de perigos do Cientista. Ele importa a lógica das três pastas, então elas não podem ser apagadas.

## Arquivos de uma variante

| Arquivo | Obrigatório | O que é |
|---|---|---|
| `visor.js` | sim | Exporta `createVisor(context)` |
| `visor.css` | sim | Todo o CSS da variante (carregado antes do módulo) |
| outros módulos, dados, imagens | não | Livres, desde que fiquem dentro da pasta |

## Contrato

```js
export function createVisor(context) {
  return { start(plan), stop(), frame(dtS) };
}
```

`context`:

| Campo | O que é |
|---|---|
| `mount` | Elemento vazio que cobre a cena, com `pointer-events: none` e `hidden` fora do visor. Todo o HTML da variante vai aqui. A variante tira o `hidden` em `start` e devolve em `stop`. Controles clicáveis precisam de `pointer-events: auto`. |
| `stageElement` | O palco inteiro. Serve para ouvir o ponteiro (arrastar para olhar em volta). |
| `camera` | `THREE.PerspectiveCamera`. No modo visor a variante é dona dela: define posição e rotação a cada quadro. |
| `terrain` | `heightAt(x, z)` devolve a altura da superfície; `probe(x, z)` devolve `{ y, slopeDeg, radiation, groundTemp }`; `isReal` e `cellM` descrevem a grade. |
| `overlays` | `setNextStop(stopId ou null, texto)` controla o rótulo do pino da próxima parada. |
| `onExit()` | Volta ao tablet. |
| `onLocalHour(horaH)` | Opcional. O visor informa a hora solar local do relógio da saída e a luz da cena (Sol e sombras) acompanha. O visor único chama a cada quadro. |
| `safety` | Segurança calculada sobre o relevo real. Ver a seção "Segurança" abaixo. |

Chamadas:

- `start(plan)`: o usuário entrou no visor. `plan` vem de `buildPlan` em [../src/route.js](../src/route.js): modo, trechos, caminho com distância e tempo acumulados, paradas e estatísticas.
- `frame(dtS)`: a cada quadro, só enquanto o visor está ativo. `dtS` é o tempo real em segundos desde o quadro anterior.
- `stop()`: o usuário saiu do visor.

O plano pode ser a travessia pré-calculada ou uma **rota livre** com pontos escolhidos no mapa (`plan.isCustom === true`, de 1 a 13 paradas com ids `A`, `B`, `C`… sem o `H`, que é o habitat). Não presuma que as paradas são as seis de `data/travessia.js`: use sempre `plan.stops`. `findStop('A')` e `shortName('A')` funcionam para os pontos do plano mais recente.

Coordenadas: `x` aponta para leste, `z` para sul, `y` para cima, tudo em metros. Conversões em [../src/geo.js](../src/geo.js).

## Segurança

`context.safety` e `plan.safety` vêm de [../src/safety.js](../src/safety.js) e de [../data/protocolos.js](../data/protocolos.js). O relevo é real; as alturas de antena, o consumo de oxigênio e a reserva são hipóteses da equipe e devem aparecer como tal.

| Em `context.safety` | O que devolve |
|---|---|
| `walkBackAt(x, z)` | Horas de caminhada do ponto até o habitat (`Infinity` se não há caminho a pé). |
| `commsAt(x, z)` | `{ visible, distM }`: se há linha de visada com o mastro do habitat. |
| `nearestShelter(x, z)` | `{ habitat: { x, z, distM, walkH }, terrain: { x, z, distM, walkH, skyBlocked } ou null }`. A proteção de relevo é estimativa geométrica. |
| `assessPlan(plan)` | A mesma avaliação que já vem pronta em `plan.safety`. |
| `protocols`, `protocolFor(id)`, `shelterKinds` | Protocolos de emergência (propostas da equipe, cada um com `source`). |
| `assumptions` | `{ habitatMastM, suitAntennaM, o2ReservePct }`. |

`plan.safety` traz `noReturn` (primeiro ponto em que o oxigênio não cobre a volta a pé, ou `null`), `minMarginH`, `commsGaps` (trechos `{ fromM, toM }` sem rádio direto), `commsLostM`, `farthest` e `shelter`.

## O que pode ser reaproveitado

Estes módulos são compartilhados e **somente leitura** para as variantes:

- [../src/simulation.js](../src/simulation.js): estado da saída, avanço no tempo e leitura para o HUD.
- [../src/route.js](../src/route.js): amostragem do caminho, rumo, declive.
- [../src/geo.js](../src/geo.js), [../src/format.js](../src/format.js), [../src/dom.js](../src/dom.js), [../src/config.js](../src/config.js).
- [../data/travessia.js](../data/travessia.js): paradas, rotas, trajeto do Curiosity, zona de risco.

O visor [base/](base/visor.js) é o exemplo de referência do contrato.

## Regras

1. Editar só arquivos dentro da própria pasta. Se faltar algo em um módulo compartilhado, copiar a lógica para a pasta ou anotar o pedido em `visores/<id>/NOTAS.md`.
2. Sem etapa de build. Módulos ES puros; o Three.js entra por `import * as THREE from 'three'`.
3. CSS com prefixo próprio (por exemplo `.guardiao-…`), para não colidir com outras variantes. Cores e espaços vêm das variáveis de [../styles.css](../styles.css).
4. Texto da interface em português. Nada de `innerHTML` com dado vindo de fora.
5. Dado simulado aparece rotulado como simulado na tela. Dado real cita a fonte.
6. Não inventar dado de Marte.

## Como testar

O servidor do protótipo serve todas as variantes e não deixa o navegador guardar versão antiga dos módulos:

```bash
python3 prototipo/tools/servir.py
```

Abrir `http://localhost:5183/?visor=<id>` e clicar em "Entrar no visor do capacete".

## Hora de partida e medições

- `plan.startClockH` é a hora solar local escolhida no tablet para o início da saída. Use `localClockOf(plan, horasDecorridas)` de `src/simulation.js` para a hora local: ela já converte horas da Terra em horas de Marte.
- `terrain.probe(x, z).radiation` é a média medida pelo RAD do Curiosity (igual em todo ponto) e não há mais `groundTemp`. A temperatura do ar vem de `estimatedAirTempC(horaLocal)` em `src/clima.js`, uma curva entre os extremos medidos pelo REMS.
- A origem de cada número está em `data/fontes.js` (que gera `docs/fontes.md`). Ao mudar um dado, atualize lá.

## IA de bordo

No visor único, a conversa é com um modelo de linguagem (`src/ia/agente.js`): na nuvem, pelo OpenRouter, quando o servidor do protótipo tem a chave (`tools/servir.py` repassa a conversa em `/ia/chat`; a chave fica no `.env` da raiz e nunca vai para a página), ou neste computador, pelo Ollama, quando não há chave. O visor recebe no contexto `live()`, que devolve as medições lidas da NASA (`weather`, `dose`) e a estação de hoje (`lsDeg`), e `safety.radiationAt`.

- `src/ia/ferramentas-visor.js` monta os dados de agora (situação, traje, volta e abrigos, ambiente, alertas), que entram em toda pergunta, e as ferramentas que o modelo pode chamar. `src/ia/ferramentas-tablet.js` faz o mesmo para o tablet.
- Os dados de agora trazem também quanto tempo dá para ficar parado (`parar_aqui`), o ponto mais próximo da rota que serve para descansar (`pontos_para_parar`) e onde está o rover Curiosity (`rover_curiosity`, posição publicada pela NASA). A ferramenta `simular_deslocamento` refaz o plano inteiro a pé ou de veículo, com as paradas, sem mudar nada; o visor recebe `planIn(modo)` para isso.
- `src/ia/ferramentas-comuns.js` busca nas fontes (`data/pesquisa.js`, gerado de `docs/pesquisa.md` por `tools/gerar-fatos.mjs`) os fatos sobre a pergunta, que também entram junto.
- `src/ia/conferencia.js` barra resposta com número que não esteja nesses dados. Não é prova de verdade: confere se o valor aparece nos dados, não se ele foi usado no sentido certo.
- Ferramenta de ação (`action: true`) só roda com ordem direta (`isOrder`) e uma vez por pergunta.
- `visores/unificado/ia.js` liga tudo ao motor da conversa. Ordem direta que as regras reconhecem (confirmar passo, abortar, pausar) é executada sem esperar o modelo.
- Para testar com o modelo de verdade: `node prototipo/tools/testar-ia.mjs` (opções `--nuvem`, `--tablet`, `--so=trecho da pergunta`, `--ver`). Sem `--nuvem` o teste usa o modelo local.

