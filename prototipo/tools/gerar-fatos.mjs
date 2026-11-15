// Escreve prototipo/data/pesquisa.js a partir de docs/pesquisa.md, para a IA do visor e do tablet
// poder consultar os fatos pesquisados (a página não enxerga a pasta docs/).
// Uso: node prototipo/tools/gerar-fatos.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../../docs/pesquisa.md', import.meta.url));
const TARGET = fileURLToPath(new URL('../data/pesquisa.js', import.meta.url));
const LINK = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
const TEAM_SECTION = 'O que isso muda no protótipo';

const facts = [];
let theme = '';
for (const line of (await readFile(SOURCE, 'utf8')).split('\n')) {
  const heading = line.match(/^#{2,3}\s+(?:\d+\.\s+)?(.+)$/);
  if (heading) { theme = heading[1].trim(); continue; }
  if (!line.startsWith('- ')) continue;
  const sources = [...line.matchAll(LINK)].map((match) => ({ label: match[1], url: match[2] }));
  const text = line.slice(2).replace(LINK, '').replace(/\*\*/g, '').replace(/\s+([.,;])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  if (text.length < 20) continue;
  facts.push({ tema: theme, texto: text, fontes: sources, daEquipe: theme === TEAM_SECTION });
}

const body = `// Gerado por prototipo/tools/gerar-fatos.mjs a partir de docs/pesquisa.md. Não editar à mão.
// Cada fato traz o tema, o texto e os links das fontes. \`daEquipe\` marca conclusões da equipe.

export const RESEARCH_FACTS = Object.freeze(${JSON.stringify(facts, null, 2)}.map(Object.freeze));
`;
await writeFile(TARGET, body);
process.stdout.write(`escrito: ${TARGET} (${facts.length} fatos)\n`);
