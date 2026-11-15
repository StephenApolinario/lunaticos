// Confere que a apresentação em português (pt.html) tem a mesma estrutura da em inglês (index.html):
// as mesmas tags, classes e ids, na mesma ordem. Só o texto e os endereços podem mudar.
//   node prototipo/tools/check-apresentacao.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = /<([a-z][a-z0-9]*)\b([^>]*)>/g;
const attr = (attrs, name) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '';

/** A estrutura da página: cada tag de abertura com a classe e o id. */
function skeleton(file) {
  const html = readFileSync(join(ROOT, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  return [...html.matchAll(TAG)].map(([, tag, attrs]) => `${tag}.${attr(attrs, 'class')}#${attr(attrs, 'id')}`);
}

const english = skeleton('index.html');
const portuguese = skeleton('pt.html');
const firstDifference = english.findIndex((item, index) => item !== portuguese[index]);
if (english.length !== portuguese.length || firstDifference !== -1) {
  const at = firstDifference === -1 ? Math.min(english.length, portuguese.length) : firstDifference;
  console.error(`FALHA: index.html e pt.html divergem no elemento ${at + 1}: "${english[at] ?? 'fim'}" e "${portuguese[at] ?? 'fim'}"`);
  process.exit(1);
}
console.log(`ok: index.html e pt.html com a mesma estrutura (${english.length} elementos)`);
