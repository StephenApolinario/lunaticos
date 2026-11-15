# Visor cientista: notas

Tese: o visor como parceiro de campo. O assistente conversa com o astronauta, conduz a ciência das paradas e os protocolos de emergência, e guarda os perigos relatados para as próximas saídas.

- Visor completo: `http://localhost:5183/?visor=cientista`, depois "Entrar no visor do capacete".
- Peças fora do HUD (exemplo de integração): `http://localhost:5183/visores/cientista/exemplo.html`.
- Teste sem navegador: `node prototipo/visores/cientista/check.mjs`.

Decisão do dono do projeto (14/11/2026): as três variantes serão juntadas em um visor só, com o Guardião como base. Daqui entram o assistente conversacional, a voz, o diário de amostras e o relato de perigos. Por isso essas peças estão separadas do HUD, e este arquivo começa pelo mapa dos módulos.

## Mapa dos módulos

"Pura" quer dizer: não toca no DOM, roda no Node e é coberta por `check.mjs`.

### Lógica pura

| Arquivo | O que faz | Exporta |
|---|---|---|
| `assistente.js` | Motor de intenções por regras e o ponto único de entrada. Lê tudo de um objeto `context` (formato em `@typedef AssistantContext`, no topo do arquivo). | `askAssistant(question, context, engine?)`, `answerByRules(question, context)`, `quickQuestions(context)`, `normalize(text)`, `INTENT_IDS` |
| `conversa.js` | Liga o motor, a voz (opcional) e quem mostra as mensagens. Devolve os comandos reconhecidos para quem hospeda. | `createConversation({ getContext, onMessage, onAction, voice?, onVoiceChange?, engine? })` → `{ ask, say, listen, toggleSpeaking, stop, voiceState }` |
| `contexto.js` | Monta o `AssistantContext` a partir da simulação compartilhada e calcula os alertas por severidade. | `buildContext(input)`, `buildAlerts(context)`, `describeStops(plan)`, `habitatReturn(plan, here, o2Pct, walkBackH)`, `commsStatus(plan, distM, failed)`, `homeLine`, `habitatLine`, `pct`, `stopShortName`, `LIMITS`, `SEVERITIES`, `DIRECTION_TEXT` |
| `protocolos.js` | Liga cada emergência da demonstração ao protocolo compartilhado (`data/protocolos.js`) e acrescenta os números do momento. Os passos não moram aqui. | `EMERGENCIES`, `PROTOCOL_BY_ALERT`, `bindProtocols(protocolFor)`, `protocolStepCount`, `protocolStepText`, `protocolIntroText`, `protocolEvidenceText`, `shelterLine` |
| `diario.js` | Diário da saída em memória e exportação em texto. | `createJournal()` → `{ add, record, recordSample, entries, stats }`, `journalToText(planLabel, entries, hazardLines)`, `entryLabel`, `fmtPosition`, `fmtStamp`, `MAX_NOTE_CHARS`, `EXPORT_FILE`, e `downloadText(filename, text)`, que é a única função do arquivo que usa o navegador |
| `perigos.js` | Relato de perigos com persistência e aviso de aproximação. O armazenamento entra por parâmetro. | `createHazardStore(storage?)` → `{ list, reload, report, remove }`, `locateHazards(hazards, here, heading, outingId)`, `hazardWarning(located, limits?)`, `describeHazard(hazard)`, `HAZARD_TYPES`, `HAZARD_STORAGE_KEY`, `HAZARD_WARNING`, `MAX_HAZARD_NOTE_CHARS`, `newId` |

### Dependem do navegador

| Arquivo | O que faz | Exporta | Depende de |
|---|---|---|---|
| `voz.js` | Fala (`speechSynthesis`) e escuta (reconhecimento de fala). Sem suporte, não faz nada. | `createVoice()` → `{ canSpeak, canListen, isSpeaking, speak, setSpeaking, listen, stopListening }`, `toSpeech(text)` (esta é pura) | APIs de voz |
| `painel.js` | Três telas independentes e o painel com abas que as junta. Cada tela cria o próprio elemento e recebe os dados por método. | `createChatView({ onAsk, onMic })`, `createScienceView({ onRecordSample, onMic, onSuggest, onContinue })`, `createJournalView({ onExport, onDeleteHazard })`, `createPanel(root, handlers)` | DOM, `componentes.css` |
| `marcadores.js` | Projeta pontos da cena 3D na tela (perigos, abrigo de relevo). | `createSceneMarkers(layer, camera, terrain)` → `{ render(items), clear }` | DOM, Three.js, `componentes.css` |
| `hud.js` | HUD deste visor: moldura, bússola, indicadores, alertas, faixa do assistente, controles. | `createHud(mount)`, `renderHud(els, context, viewHeading, targetBearing)`, `setData` | DOM, `visor.css` |
| `camera.js` | Câmera em primeira pessoa (cópia da lógica do visor base). | `createCameraRig(camera, stageElement, isActive)` → `{ reset, apply }` | eventos de ponteiro |
| `visor.js` | `createVisor(context)` do contrato. É só a cola: simulação, emergências, chegada às paradas e a ligação entre as peças. | `createVisor` | tudo acima |

### Outros arquivos

| Arquivo | O que é |
|---|---|
| `componentes.css` | CSS das peças que funcionam sozinhas (telas, painel, botões, marcadores). Toda tela tem a classe `cientista-ui` na raiz. Precisa só de `../../styles.css`. |
| `visor.css` | CSS do HUD deste visor. Importa `componentes.css`, para o contrato de "um `visor.css` por variante" continuar valendo. |
| `exemplo.html`, `exemplo.js` | Conversa, diário e perigos montados fora do HUD, sem mapa 3D. É o exemplo de integração. |
| `check.mjs` | Teste em Node das peças puras. |

Quem importa quem, entre as peças puras: `assistente` → `contexto`, `protocolos`; `protocolos` → `contexto`; `contexto` → `perigos`; `conversa` → `assistente`; `diario` e `perigos` não importam nada desta pasta. Nenhuma importa `hud.js`, `visor.js` ou `painel.js`.

## Como usar cada peça sozinha

`exemplo.js` faz tudo isto em um arquivo curto e roda. Em resumo:

**Assistente.** `askAssistant(pergunta, context)` devolve `{ intent, text, action }`. O `context` é só dados. Com a simulação compartilhada, `buildContext` monta um. Com outro motor de simulação (o do Guardião), monte o objeto no formato de `AssistantContext`; as peças `describeStops`, `habitatReturn` e `commsStatus` ajudam, e `buildContext` aceita `alerts` prontos, para o assistente responder em cima do motor de alertas de quem hospeda. Perguntas devolvem `text`. Comandos devolvem `action` e texto vazio; quem hospeda executa e relata. As ações: `report-hazard` (`hazardType`, `note`), `record-sample` (`note`), `pause`, `resume`, `protocol-advance`, `protocol-end`.

**Conversa.** `createConversation` cuida do resto: mostra a pergunta, chama o motor, fala a resposta, entrega a ação e trata falha do motor.

```js
const conversa = createConversation({
  getContext: () => contextoAtual,
  onMessage: (mensagem) => telaDeConversa.addMessage(mensagem), // { from, text, stamp }
  onAction: (acao) => executar(acao),                           // valide o tipo antes de executar
  voice: createVoice(),                                          // opcional
});
conversa.ask('Quanto falta?');
conversa.say('Alerta: declive à frente.', 'alert');              // fala proativa
```

**Diário.** `createJournal()` e `journal.record(tipo, texto, momento, idDaParada)`, em que `momento` é qualquer objeto com `{ elapsedH, clockH, position: { lat, lon, elevM } }` (o contexto serve). `journal.recordSample(observacao, momento, idDaParada)` para amostras. `journalToText(...)` gera o texto; `createJournalView` mostra.

**Perigos.** `createHazardStore()` usa o `localStorage`; para teste ou outro armazenamento, passe um objeto com `getItem` e `setItem`. `store.report({ type, note, position, outing, missionH })` devolve `{ hazard, saved }`. Para o aviso: `hazardWarning(locateHazards(store.list(), { x, z }, rumo, idDaSaida))` devolve o alerta ou `null`. Para a cena: `createSceneMarkers(camada, camera, terrain).render(lista)`.

Para o Guardião: só li a lista de funções exportadas dele, não o código. Ele tem motor de protocolos próprio (`confirmStep`, `decide`), então o mais simples é mapear a ação `protocol-advance` para a confirmação de passo dele e preencher `context.protocol` (`{ id, step }`) e `context.protocols` (`{ [id]: { title, steps, evidence } }`) com o protocolo que ele estiver conduzindo. Os ids das emergências em `EMERGENCIES` (`storm`, `solar`, `radio`, `o2`) são deste visor; se os dele forem outros, `EMERGENCY_WORDS` e `EMERGENCIES` precisam do mesmo conjunto de chaves.

## Pronto e testado, e o que ficou pela metade

**Pronto e testado** (Node e Chromium, 1440×900 e 375×812, sem erro no console):

- Motor do assistente: 30 perguntas em dois momentos da saída, comandos, respostas com os textos reais das paradas, "não sei" quando falta dado. Pergunta nunca vira comando (há teste para dez casos).
- Conversa: com tela e voz de mentira no Node, e no visor.
- Diário: registro, contagem por parada, exportação. No navegador, o texto exportado foi conferido.
- Relato de perigos: por toque e por comando de texto, persistência depois de recarregar, aviso e marcador ao se aproximar, dado corrompido ou adulterado no armazenamento.
- Ciência nas paradas: chegada pausa a simulação, lista de verificação, amostra, aviso ao sair sem amostra.
- Emergências: as quatro, com os passos de `data/protocolos.js`, a fonte citada ao final, duas ao mesmo tempo (fila) e a barra de posição arrastada no meio.
- Segurança do relevo: rádio por linha de visada, volta a pé, ponto sem volta, proteção de relevo no evento solar.
- Plano a pé, de veículo com extensão e destino livre (`plan.isCustom`).
- Teclado: Tab, `/` abre a conversa, espaço pausa, Esc fecha o painel e depois volta ao tablet. Digitar no campo não dispara atalho.
- Peças fora do HUD: `exemplo.html` (conversa, diário e perigos, com armazenamento em memória).

**Pela metade ou não verificado:**

- Voz: o som da fala e o reconhecimento com microfone real não foram verificados (no navegador de teste os botões ligam e desligam, mas não há áudio). `toSpeech` é testada.
- `createScienceView` e `createSceneMarkers` só foram exercitados dentro deste visor, não montados em outro HUD. `createChatView` e `createJournalView` foram, em `exemplo.html`.
- Firefox e Safari não foram testados.
- Marcadores: projetados em 2D, sem oclusão pelo relevo; dois relatos no mesmo ponto se sobrepõem.
- Diário: vale por saída, não persiste ao recarregar (só os perigos persistem).
- Tempestade de poeira: é uma camada de CSS, a névoa da cena não muda.
- O vazamento de O₂ trava o oxigênio em 18% enquanto está ligado; ele não continua caindo.
- Desempenho: `buildContext` aloca objetos novos a cada quadro. Não medi impacto; a animação seguiu fluida nos testes.
- Uma revisão independente do código foi feita e os achados alto e médios foram corrigidos. Dos baixos, ficaram sem tratar as alocações por quadro acima e um caso de borda: com uma emergência ligada, chegar ao fim da rota interrompe o protocolo (o assistente avisa), e voltar a barra reinicia o protocolo como se fosse novo.

## Intenções que o assistente entende

Perguntas: `quanto-falta`, `seguranca`, `importancia`, `tarefa`, `pergunta-cientifica`, `observar`, `parada` (por número ou palavra, por exemplo "enxofre"), `oxigenio`, `bateria`, `abrigo`, `sem-volta`, `radiacao`, `temperatura`, `comunicacao`, `terreno`, `altitude`, `veiculo`, `tempo`, `rota`, `resumo`, `perigos`, `diario`, `protocolo`, `fonte`, `previsao` (responde que não sabe), `identidade`, `ajuda`, `saudacao`, `agradecimento`, `confirmacao`.

Comandos: `relatar-perigo` ("relatar perigo areia fofa", "relatar perigo: buraco fundo"), `registrar-amostra` ("registrar amostra: veio amarelo"), `pausar`, `continuar`, `protocolo-encerrar` ("encerrar emergência") e, durante um protocolo, `protocolo-avancar` ("feito") e `protocolo-repetir`.

Comando é ordem direta: verbo no começo e sem interrogação. Sem regra que case, a resposta é "Não sei responder a isso" (`desconhecido`). A primeira regra que casa vence; a ordem está em `INTENTS`.

## O que é real e o que é simulado

- **Real:** posição, distância, declive e altitude (rotas sobre o MSL Gale Merged DEM, USGS); linha de visada de rádio, tempo de volta a pé, ponto sem volta e proteção de relevo (`context.safety` e `plan.safety`, calculados sobre o relevo real); textos das paradas; fatos de missão citados nos protocolos, com a fonte.
- **Hipótese da equipe (dita assim na tela e na fala):** alturas de antena, reserva de O₂ e os passos dos protocolos (não são procedimento oficial da NASA).
- **Simulado (rotulado no HUD):** O₂, bateria, radiação, dose, temperatura, hora local, visibilidade, as quatro emergências dos botões e o próprio assistente, que funciona por regras, sem modelo de linguagem.

Um achado dos dados reais: no plano a pé padrão (9,0 km), 7,31 km ficam sem linha de visada de rádio com o habitat, em seis trechos.

## Como ligar um modelo de linguagem real depois

`askAssistant(pergunta, context, motor)` é o ponto único, e `createConversation` aceita `engine`.

1. Subir um servidor próprio com uma rota, por exemplo `POST /api/assistente`, que recebe `{ pergunta, contexto }`, guarda a chave do modelo e devolve `{ intent, text, action }`. A chave nunca vai para o navegador.
2. No prompt do servidor: responder só com o que está no contexto, dizer "não sei" quando faltar dado, e só propor as ações listadas acima.
3. Passar um motor que chama o servidor e cai nas regras se falhar:

```js
import { answerByRules } from './assistente.js';

const motorRemoto = async (pergunta, contexto) => {
  try {
    const resposta = await fetch('/api/assistente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pergunta, contexto }) });
    if (!resposta.ok) throw new Error(String(resposta.status));
    return await resposta.json();
  } catch {
    return answerByRules(pergunta, contexto); // sem rede (ou sem rádio), as regras seguem respondendo
  }
};
createConversation({ getContext, onMessage, onAction, engine: motorRemoto });
```

Quem hospeda já ignora ações desconhecidas e trata o texto como texto. As regras ficam como reserva sem conexão, o que combina com o cenário de perda de rádio. `check.mjs` testa a troca de motor e a falha dele.

## O que eu precisaria dos módulos compartilhados

- **Perigos relatados no tablet:** hoje só aparecem no visor. `overlays` precisaria aceitar marcadores extras (ou expor a cena) para o mapa de planejamento mostrar os relatos. Formato guardado, na chave `lunaticos.cientista.perigos.v1`: lista de `{ id, type, lat, lon, elevM, note, outing, missionH, createdAt }`.
- **Emergências na simulação:** tempestade, falha de rádio e vazamento de O₂ vivem só nesta variante; `src/simulation.js` só conhece o evento solar.
- **Poeira na cena:** com acesso à névoa do palco, a visibilidade cairia de verdade.
- **Formato de hora:** `fmtDuration` arredonda e `fmtClock` trunca, então o diário mostra, por exemplo, "0h21 · 09:20".
- **Cache do servidor estático:** `python3 -m http.server` não manda cabeçalho de cache. Depois de mudar `data/protocolos.js`, o navegador serviu a versão antiga e o tablet quebrou em `protocolCard` até recarregar sem cache.

## Roteiro de demonstração (60 segundos)

1. (0–10 s) Entrar no visor. Ler a fala inicial: o plano e o resumo de segurança pelo relevo real (trechos sem rádio, ponto sem volta).
2. (10–20 s) "Conversar" e as perguntas rápidas "É seguro continuar?" e "Oxigênio na volta?".
3. (20–35 s) Deixar chegar à parada 1 (uns 20 s a 60×, ou arrastar a barra até pouco antes). A simulação pausa e a aba Ciência abre: marcar a lista, digitar uma observação, "Registrar amostra", "Concluir parada e seguir".
4. (35–45 s) "Relatar perigo" → "Areia fofa". Mostrar na aba Diário que ficou guardado. Para o efeito completo, deixar um relato feito antes e recarregar a página: o aviso e o marcador aparecem ao se aproximar.
5. (45–60 s) "Emergências" → "Evento solar": alerta crítico, marcador verde da proteção de relevo na cena e o assistente conduzindo o protocolo. "Feito" até o fim: a última fala cita o fato de missão e a fonte.
