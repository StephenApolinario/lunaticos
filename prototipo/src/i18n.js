// Idioma da interface: inglês (padrão) ou português do Brasil.
//
// O texto do código é escrito em português, e esse texto é a chave da tradução:
//   t`Volta a pé`                 → "Volta a pé" em português, "Walk-back" em inglês
//   t`Chegada em ${duracao}`      → a chave é "Chegada em {0}"; o inglês pode mudar a ordem dos {n}
//   t('Saída', 'botão do visor')  → mesmo texto com sentidos diferentes: a chave é "Saída¦botão do visor"
// As traduções ficam em ./i18n/en/, um arquivo por área. Texto sem tradução aparece em português;
// `node prototipo/tools/check-i18n.mjs` lista o que falta.
//
// Puro: roda no navegador e no Node.

import EN from './i18n/en.js';

export const LANGS = Object.freeze([
  Object.freeze({ id: 'en', short: 'EN', label: 'English' }),
  Object.freeze({ id: 'pt', short: 'PT', label: 'Português (Brasil)' }),
]);
export const DEFAULT_LANG = 'en';
const SOURCE_LANG = 'pt';
const STORAGE_KEY = 'lunaticos:idioma';
const QUERY_PARAM = 'lang';
const CONTEXT_MARK = '¦';
const IS_BROWSER = typeof document !== 'undefined';

const isSupported = (id) => LANGS.some((lang) => lang.id === id);

// O navegador pode recusar o armazenamento (janela anônima, dados bloqueados): o idioma então vale só no endereço.
function readStored() {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function store(id) {
  try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* sem armazenamento, fica o endereço */ }
}

// No navegador vale o idioma pedido no endereço (?lang=pt), senão o que a pessoa escolheu antes,
// senão inglês. O idioma do navegador não entra: o padrão é inglês para qualquer visitante.
// Fora do navegador (checagens no Node) vale o português, que é o texto escrito no código;
// LUNATICOS_LANG=en troca.
function resolveLang() {
  if (!IS_BROWSER) {
    const fromEnv = globalThis.process?.env?.LUNATICOS_LANG;
    return isSupported(fromEnv) ? fromEnv : SOURCE_LANG;
  }
  const asked = new URLSearchParams(window.location.search).get(QUERY_PARAM);
  if (isSupported(asked)) {
    store(asked);
    return asked;
  }
  const stored = readStored();
  return isSupported(stored) ? stored : DEFAULT_LANG;
}

export const LANG = resolveLang();
export const IS_ENGLISH = LANG === 'en';
/** Localidade para números e datas (`toLocaleString`). */
export const LOCALE = IS_ENGLISH ? 'en-US' : 'pt-BR';
/** Valor do atributo `lang` do HTML e das APIs de voz do navegador. */
export const HTML_LANG = IS_ENGLISH ? 'en' : 'pt-BR';

/** Chaves usadas sem tradução nesta página, para conferência (`?debug` expõe em window.lunaticos). */
export const MISSING = new Set();

const fill = (template, values) => template.replace(/\{(\d+)\}/g, (slot, index) => (Number(index) < values.length ? String(values[Number(index)]) : slot));

function translate(key, values) {
  const template = EN[key];
  if (template === undefined) {
    MISSING.add(key);
    return null;
  }
  return fill(template, values);
}

/**
 * Texto no idioma da interface. Use como marca de template (t`...`) ou com texto fixo (t('...')).
 * O segundo argumento do texto fixo é um contexto, para a mesma palavra com traduções diferentes.
 * @param {TemplateStringsArray | string} strings
 * @param {...unknown} values
 * @returns {string}
 */
export function t(strings, ...values) {
  if (typeof strings === 'string') {
    if (!IS_ENGLISH) return strings;
    const context = values[0];
    return translate(context ? `${strings}${CONTEXT_MARK}${context}` : strings, []) ?? strings;
  }
  const source = strings.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ''), '');
  if (!IS_ENGLISH) return source;
  const key = strings.reduce((text, part, index) => text + part + (index < values.length ? `{${index}}` : ''), '');
  return translate(key, values) ?? source;
}

/** Troca o idioma: guarda a escolha e recarrega a página com ela no endereço. */
export function setLang(id) {
  if (!IS_BROWSER || !isSupported(id) || id === LANG) return;
  store(id);
  const url = new URL(window.location.href);
  url.searchParams.set(QUERY_PARAM, id);
  window.location.assign(url);
}

/**
 * Texto fixo do HTML. A página chega em inglês, para o visitante não ver português piscar antes de
 * o script rodar; o português fica em `data-i18n` (conteúdo) e em `data-i18n-<atributo>`.
 */
export function applyStaticTexts(root = document) {
  if (!IS_BROWSER) return;
  document.documentElement.lang = HTML_LANG;
  if (IS_ENGLISH) return;
  const PREFIX = 'data-i18n-';
  root.querySelectorAll('*').forEach((element) => {
    for (const { name, value } of [...element.attributes]) {
      if (name === 'data-i18n') element.textContent = value;
      else if (name.startsWith(PREFIX)) element.setAttribute(name.slice(PREFIX.length), value);
    }
  });
}
