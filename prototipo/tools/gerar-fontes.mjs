// Escreve docs/fontes.md a partir de prototipo/data/fontes.js, para o documento não divergir do painel.
// Uso: node prototipo/tools/gerar-fontes.mjs

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { KINDS, SOURCE_GROUPS, CHALLENGE_RESOURCES } from '../data/fontes.js';
import { collectLinkGroups } from './links.mjs';

const line = ({ item, kind, source, url }, number) => `${number}. **${item}** — ${KINDS[kind]}. ${source}${url ? ` [fonte](${url})` : ''}`;
const linkGroups = await collectLinkGroups();
const linkCount = linkGroups.reduce((sum, group) => sum + group.links.length, 0);
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
  // A numeração segue de um grupo ao outro, para dar para citar "o item 12".
  ...SOURCE_GROUPS.reduce((acc, group) => {
    const lines = group.entries.map((entry, i) => line(entry, acc.next + i));
    return { next: acc.next + group.entries.length, out: [...acc.out, `## ${group.title}`, '', ...lines, ''] };
  }, { next: 1, out: [] }).out,
  '## Recursos da aba Resources do desafio',
  '',
  ...CHALLENGE_RESOURCES.map((resource) => `- [${resource.name}](${resource.url}): ${resource.use}`),
  '',
  '## Todos os links',
  '',
  `Só os links, sem repetir: ${linkCount} no total, agrupados por onde são usados.`,
  '',
  ...linkGroups.flatMap((group) => [`### ${group.title} (${group.links.length})`, '', ...group.links.map(({ label, url }) => `- [${label}](${url})`), '']),
].join('\n');

const target = fileURLToPath(new URL('../../docs/fontes.md', import.meta.url));
await writeFile(target, text);
process.stdout.write(`escrito: ${target}\n`);
