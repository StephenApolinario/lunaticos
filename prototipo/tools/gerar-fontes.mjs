// Escreve docs/fontes.md a partir de prototipo/data/fontes.js, para o documento não divergir do painel.
// Uso: node prototipo/tools/gerar-fontes.mjs

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { KINDS, SOURCE_GROUPS, CHALLENGE_RESOURCES } from '../data/fontes.js';

const line = ({ item, kind, source, url }, index) => `${index + 1}. **${item}** — ${KINDS[kind]}. ${source}${url ? ` [fonte](${url})` : ''}`;
const count = (kind) => SOURCE_GROUPS.flatMap((group) => group.entries).filter((entry) => entry.kind === kind).length;

const text = [
  '# De onde vem cada informação',
  '',
  'Gerado por `node prototipo/tools/gerar-fontes.mjs` a partir de `prototipo/data/fontes.js`. Para corrigir, edite aquele arquivo e gere de novo.',
  '',
  'Cada item diz o tipo: medição de missão, cálculo sobre dado real, estimativa a partir de medição, hipótese da equipe, simulado ou ilustrativo.',
  '',
  `Resumo: ${Object.keys(KINDS).map((kind) => `${count(kind)} ${KINDS[kind].toLowerCase()}`).join(' · ')}.`,
  '',
  ...SOURCE_GROUPS.flatMap((group) => [`## ${group.title}`, '', ...group.entries.map(line), '']),
  '## Recursos da aba Resources do desafio',
  '',
  ...CHALLENGE_RESOURCES.map((resource) => `- [${resource.name}](${resource.url}): ${resource.use}`),
  '',
].join('\n');

const target = fileURLToPath(new URL('../../docs/fontes.md', import.meta.url));
await writeFile(target, text);
process.stdout.write(`escrito: ${target}\n`);
