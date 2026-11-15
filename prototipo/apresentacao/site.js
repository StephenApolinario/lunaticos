// Página de apresentação: a rota que acompanha a rolagem e a conversa com a IA de bordo, que é digitada.
// Sem este script a página fica completa e parada: a rota inteira acesa e a conversa toda à vista.

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- A rota acompanha a rolagem ----------
// A linha acende até onde a leitura chegou, uma bolinha (o astronauta) anda sobre ela e cada parada
// acende quando é alcançada. A posição é a de um ponto fixo da janela, um pouco acima do meio.
const READING_LINE = 0.45;

function followRoute(route) {
  const pins = [...route.querySelectorAll('.pino')];
  if (pins.length < 2) return;
  const fill = document.createElement('span');
  fill.className = 'rota-avanco';
  const dot = document.createElement('span');
  dot.className = 'rota-astronauta';
  for (const mark of [fill, dot]) mark.setAttribute('aria-hidden', 'true');
  route.append(fill, dot);
  route.dataset.viva = 'true';

  // Centro de cada parada, em pixels a partir do topo da rota.
  let centers = [];
  function measure() {
    const top = route.getBoundingClientRect().top;
    centers = pins.map((pin) => { const box = pin.getBoundingClientRect(); return box.top - top + box.height / 2; });
    route.style.setProperty('--trilho-topo', `${centers[0]}px`);
    route.style.setProperty('--trilho-altura', `${centers.at(-1) - centers[0]}px`);
  }

  function update() {
    // No fim da página não há mais rolagem para levar a última parada até a linha de leitura:
    // na última tela, a linha desce até o pé da janela, e a rota fecha no habitat.
    const leftToScroll = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
    const line = leftToScroll < window.innerHeight ? 1 - (1 - READING_LINE) * Math.max(0, leftToScroll) / window.innerHeight : READING_LINE;
    const reached = window.innerHeight * line - route.getBoundingClientRect().top;
    const length = centers.at(-1) - centers[0];
    // Rota sem comprimento (escondida, por exemplo) não tem avanço para mostrar.
    const progress = length > 0 ? Math.min(1, Math.max(0, (reached - centers[0]) / length)) : 0;
    route.style.setProperty('--avanco', String(progress));
    route.style.setProperty('--avanco-px', `${progress * length}px`);
    pins.forEach((pin, index) => {
      const isReached = String(reached >= centers[index] - 1);
      if (pin.dataset.alcancada !== isReached) pin.dataset.alcancada = isReached;
    });
  }

  // Um cálculo por quadro, por mais eventos de rolagem que cheguem.
  let isQueued = false;
  function queue() {
    if (isQueued) return;
    isQueued = true;
    requestAnimationFrame(() => { isQueued = false; update(); });
  }
  measure();
  update();
  window.addEventListener('scroll', queue, { passive: true });
  // Imagens e fontes mudam a altura das seções depois da abertura.
  new ResizeObserver(() => { measure(); update(); }).observe(route);
}

// ---------- Conversa com a IA de bordo ----------
// O texto vem do HTML: cada troca tem a pergunta e a resposta, e a resposta traz em `data-estado` o
// que a IA mostra enquanto pensa. O script mostra uma troca por vez, como na tela: a pergunta é
// digitada, a IA pensa e a resposta chega aos poucos.
//
// As trocas ficam empilhadas na mesma área e o texto só fica invisível até ser "dito": a altura do
// quadro não muda e a página não pula. Para leitor de tela fica uma cópia parada da conversa inteira.
const CHAT = Object.freeze({ typeMs: 34, thinkMs: 1500, wordMs: 46, readMs: 4200 });
const LETTERS = /[\s\S]/g;
// O espaço no começo de um trecho (logo depois de um negrito) vai junto com a palavra seguinte.
const WORDS = /\s*\S+\s*|\s+/g;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Parte o texto de uma fala em pedaços, cada um num <span>, sem perder o negrito. Devolve os pedaços. */
function splitIntoPieces(line, unit) {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  const pieces = [];
  for (const node of textNodes) {
    const fragment = document.createDocumentFragment();
    for (const text of node.nodeValue.match(unit) ?? []) {
      const piece = document.createElement('span');
      piece.className = 'pedaco';
      piece.textContent = text;
      fragment.append(piece);
      pieces.push(piece);
    }
    node.replaceWith(fragment);
  }
  return pieces;
}

function playChat(chat) {
  const list = chat.querySelector('.conversa-falas');
  const turns = [...chat.querySelectorAll('.troca')]
    .map((turn) => ({ turn, question: turn.querySelector('.fala-pergunta'), answer: turn.querySelector('.fala-resposta') }))
    .filter(({ question, answer }) => question && answer);
  if (!list || turns.length === 0) return;

  // Quem usa leitor de tela recebe a conversa inteira, parada; a lista animada fica fora da leitura.
  const reading = list.cloneNode(true);
  reading.className = 'apenas-leitor';
  list.setAttribute('aria-hidden', 'true');
  list.after(reading);
  const steps = turns.map(({ turn, question, answer }) => ({ turn, asked: splitIntoPieces(question, LETTERS), answered: splitIntoPieces(answer, WORDS) }));

  // A conversa só anda quando está na tela e sem pausa.
  let isVisible = false;
  let isPaused = false;
  let release = null;
  const canRun = () => isVisible && !isPaused;
  const whenRunning = () => (canRun() ? Promise.resolve() : new Promise((resolve) => { release = resolve; }));
  function resumeIfPossible() {
    if (!canRun() || !release) return;
    release();
    release = null;
  }
  new IntersectionObserver(([entry]) => { isVisible = entry.isIntersecting; resumeIfPossible(); }, { threshold: 0.35 }).observe(chat);
  const pause = async (ms) => { await wait(ms); await whenRunning(); };

  // Pausar deixa a conversa inteira à vista, parada; tocar continua de onde estava.
  const button = chat.querySelector('.conversa-pausa');
  if (button) {
    button.hidden = false;
    button.addEventListener('click', () => {
      isPaused = !isPaused;
      button.textContent = isPaused ? button.dataset.tocar : button.dataset.pausar;
      if (isPaused) delete chat.dataset.viva;
      else chat.dataset.viva = 'true';
      resumeIfPossible();
    });
  }
  chat.dataset.viva = 'true';

  const say = async (pieces, stepMs) => {
    for (const piece of pieces) {
      piece.dataset.dito = 'true';
      await pause(stepMs);
    }
  };
  (async () => {
    for (;;) {
      for (const { turn, asked, answered } of steps) {
        await whenRunning();
        for (const piece of [...asked, ...answered]) delete piece.dataset.dito;
        turn.dataset.atual = 'true';
        turn.dataset.fase = 'pergunta';
        await say(asked, CHAT.typeMs);
        turn.dataset.fase = 'pensando';
        await pause(CHAT.thinkMs);
        turn.dataset.fase = 'resposta';
        await say(answered, CHAT.wordMs);
        await pause(CHAT.readMs);
        delete turn.dataset.atual;
      }
    }
  })();
}

document.querySelectorAll('.rota').forEach(followRoute);
if (!REDUCED_MOTION.matches) document.querySelectorAll('[data-conversa]').forEach(playChat);
