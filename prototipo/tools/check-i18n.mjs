// Confere as traduções para o inglês (prototipo/src/i18n/en/).
//
//   node prototipo/tools/check-i18n.mjs                    confere tudo
//   node prototipo/tools/check-i18n.mjs visores/guardiao   só os arquivos cujo caminho contém o trecho
//
// O que ele confere:
// - toda chave usada no código com t`...` ou t('...') tem tradução (falha se faltar);
// - a mesma chave não tem traduções diferentes em duas áreas (falha);
// - a tradução usa as mesmas lacunas {0}, {1}… da chave (falha: lacuna a mais ficaria escrita na tela,
//   lacuna a menos esconderia um valor);
// - o texto fixo do demo.html, que chega em inglês, tem o português guardado em data-i18n (falha);
// - os números do texto em português aparecem na tradução (aviso: datas e ordens mudam de forma);
// - traduções que nenhum código usa (aviso).
//
// A leitura do código é simples de propósito: só entende t`...` e t('texto') ou t('texto', 'contexto')
// com texto fixo. Chamar t(variavel) não é conferido; traduza onde o texto é escrito.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import EN, { AREAS } from '../src/i18n/en.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'visores', 'data'];
const SKIP_DIRS = new Set(['i18n', 'node_modules']);
// O próprio i18n.js só cita t`...` nos comentários de exemplo.
const SKIP_FILES = new Set(['i18n.js']);
const CONTEXT_MARK = '¦';
const only = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const isStrict = !process.argv.includes('--avisos');

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path);
    return entry.name.endsWith('.js') && !SKIP_FILES.has(entry.name) ? [path] : [];
  });
}

// O valor de um trecho de código-fonte entre aspas ou crases, com os escapes resolvidos.
const cook = (quoted) => new Function(`return ${quoted};`)();

function skipString(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length && source[index] !== quote) index += source[index] === '\\' ? 2 : 1;
  return index + 1;
}

// Pula uma expressão ${...}; `start` é o primeiro caractere depois de "${". Devolve o índice depois do "}".
function skipExpression(source, start) {
  let depth = 1;
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === '\'' || char === '"') { index = skipString(source, index); continue; }
    if (char === '`') { index = readTemplate(source, index + 1).end; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  throw new Error('expressão ${...} sem fim');
}

// Lê um template a partir do caractere depois da crase de abertura. A chave troca cada ${...} por {n}.
function readTemplate(source, start) {
  let key = '';
  let chunk = '';
  let slots = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') { chunk += source.slice(index, index + 2); index += 2; continue; }
    if (char === '`') return { key: key + cook(`\`${chunk}\``), end: index + 1 };
    if (char === '$' && source[index + 1] === '{') {
      key += `${cook(`\`${chunk}\``)}{${slots}}`;
      slots += 1;
      chunk = '';
      index = skipExpression(source, index + 2);
      continue;
    }
    chunk += char;
    index += 1;
  }
  throw new Error('template sem fim');
}

const TAGGED = /(?<![\w$.])t`/g;
const LITERAL = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"`;
const PLAIN = new RegExp(String.raw`(?<![\w$.])t\(\s*(${LITERAL})\s*(?:,\s*(${LITERAL})\s*)?\)`, 'g');

/** Chaves de tradução usadas num arquivo de código. */
export function keysOf(source) {
  const keys = [];
  for (const match of source.matchAll(TAGGED)) keys.push(readTemplate(source, match.index + 2).key);
  for (const match of source.matchAll(PLAIN)) {
    const text = cook(match[1]);
    // Contexto vazio conta como sem contexto, igual ao `t` de verdade.
    const context = match[2] ? cook(match[2]) : '';
    keys.push(context ? `${text}${CONTEXT_MARK}${context}` : text);
  }
  return keys;
}

// Números de um texto, sem os {n} das lacunas, com vírgula e ponto tratados como o mesmo sinal.
const numbersOf = (text) => (text.replace(/\{\d+\}/g, ' ').match(/\d+(?:[.,]\d+)*/g) ?? []).map((raw) => raw.replace(/,/g, '.')).sort();

const used = new Map();
for (const dir of SCAN_DIRS) {
  for (const file of sourceFiles(join(ROOT, dir))) {
    const path = relative(ROOT, file);
    if (only.length && !only.some((part) => path.includes(part))) continue;
    let keys;
    try {
      keys = keysOf(readFileSync(file, 'utf8'));
    } catch (error) {
      console.error(`ERRO ao ler ${path}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    for (const key of keys) used.set(key, [...(used.get(key) ?? []), path]);
  }
}

const missing = [...used].filter(([key]) => EN[key] === undefined);
const byFile = new Map();
for (const [key, paths] of missing) byFile.set(paths[0], [...(byFile.get(paths[0]) ?? []), key]);
for (const [path, keys] of byFile) {
  console.log(`\nSEM TRADUÇÃO em ${path} (${keys.length}):`);
  for (const key of keys) console.log(`  ${JSON.stringify(key)}`);
}

const conflicts = [];
const seen = new Map();
for (const [area, entries] of Object.entries(AREAS)) {
  for (const [key, value] of Object.entries(entries)) {
    if (seen.has(key) && seen.get(key).value !== value) conflicts.push(`${JSON.stringify(key)}: "${seen.get(key).value}" (${seen.get(key).area}) e "${value}" (${area})`);
    else seen.set(key, { area, value });
  }
}
if (conflicts.length) console.log(`\nMESMA CHAVE, TRADUÇÕES DIFERENTES (${conflicts.length}):\n  ${conflicts.join('\n  ')}`);

// As lacunas da chave e as da tradução têm de ser as mesmas (a ordem pode mudar).
const slotsOf = (text) => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort().join(' ');
const slotErrors = Object.entries(EN)
  .filter(([key]) => !only.length || used.has(key))
  .filter(([key, value]) => slotsOf(key) !== slotsOf(value))
  .map(([key, value]) => `${JSON.stringify(key)}\n    → ${JSON.stringify(value)}`);
if (slotErrors.length) console.log(`\nLACUNAS DIFERENTES entre a chave e a tradução (${slotErrors.length}):\n  ${slotErrors.join('\n  ')}`);

// O HTML do protótipo chega em inglês; cada texto fixo precisa do português em data-i18n (conteúdo)
// ou em data-i18n-<atributo>. Nome próprio, símbolo e letra solta não contam.
const STATIC_ATTRS = ['title', 'aria-label', 'placeholder'];
function staticTextErrors(file) {
  const html = readFileSync(join(ROOT, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const errors = [];
  for (const [, tag, attrs, text] of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>([^<]*)/g)) {
    const has = (name) => new RegExp(`\\s${name}="`).test(attrs);
    for (const name of STATIC_ATTRS) if (has(name) && !has(`data-i18n-${name}`)) errors.push(`<${tag}> tem ${name} sem data-i18n-${name}`);
    if (tag === 'meta' && /name="description"/.test(attrs) && !has('data-i18n-content')) errors.push('<meta description> sem data-i18n-content');
    const words = text.trim();
    if (/\p{L}{3,}/u.test(words) && words !== 'Lunáticos' && !has('data-i18n')) errors.push(`<${tag}> com o texto "${words.slice(0, 50)}" sem data-i18n`);
  }
  return errors;
}
const staticErrors = only.length ? [] : staticTextErrors('demo.html');
if (staticErrors.length) console.log(`\nTEXTO FIXO SEM PORTUGUÊS em demo.html (${staticErrors.length}):\n  ${staticErrors.join('\n  ')}`);

const numberWarnings = Object.entries(EN)
  .filter(([key]) => !only.length || used.has(key))
  .filter(([key, value]) => numbersOf(key.split(CONTEXT_MARK)[0]).join(' ') !== numbersOf(value).join(' '))
  .map(([key, value]) => `${JSON.stringify(key)}\n    → ${JSON.stringify(value)}`);
if (numberWarnings.length) console.log(`\nAVISO: números diferentes entre o português e o inglês (${numberWarnings.length}):\n  ${numberWarnings.join('\n  ')}`);

if (!only.length) {
  const unused = Object.keys(EN).filter((key) => !used.has(key));
  if (unused.length) console.log(`\nAVISO: traduções que nenhum código usa (${unused.length}):\n  ${unused.map((key) => JSON.stringify(key)).join('\n  ')}`);
}

const failed = missing.length + conflicts.length + slotErrors.length + staticErrors.length;
console.log(`\n${failed ? 'FALTA' : 'ok'}: ${used.size} textos no código, ${missing.length} sem tradução, ${conflicts.length} conflitos, ${slotErrors.length} lacunas diferentes, ${staticErrors.length} textos fixos sem português, ${numberWarnings.length} avisos de número.`);
if (failed && isStrict) process.exitCode = 1;
