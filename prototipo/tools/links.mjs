// Reúne os links de todas as fontes do projeto, sem repetir, agrupados por onde são usados.
// Lê os mesmos arquivos de dados que o protótipo usa e os links de docs/pesquisa.md.
// Usado por gerar-fontes.mjs (docs/fontes.md).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SOURCE_GROUPS, CHALLENGE_RESOURCES, DATA_ENDPOINTS } from '../data/fontes.js';
import { STOPS, HAZARD } from '../data/travessia.js';
import { OPPORTUNITIES } from '../data/oportunidades.js';
import { PROTOCOLS } from '../data/protocolos.js';
import { RAD, REMS } from '../data/medicoes.js';

const RESEARCH = fileURLToPath(new URL('../../docs/pesquisa.md', import.meta.url));
const MARKDOWN_LINK = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;

// Todo objeto com `url` https dentro do valor, com o rótulo de `label`, `item` ou `name`.
function linksIn(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => linksIn(item, found));
  } else if (value && typeof value === 'object') {
    if (typeof value.url === 'string' && value.url.startsWith('https://')) {
      found.push({ label: String(value.label ?? value.item ?? value.name ?? value.url), url: value.url });
    }
    Object.values(value).forEach((item) => linksIn(item, found));
  }
  return found;
}

/** @returns {Promise<Array<{ title: string, links: Array<{ label: string, url: string }> }>>} */
export async function collectLinkGroups() {
  const research = [...(await readFile(RESEARCH, 'utf8')).matchAll(MARKDOWN_LINK)].map((match) => ({ label: match[1], url: match[2] }));
  const groups = [
    { title: 'Dados e serviços usados pelo protótipo', links: [...linksIn(SOURCE_GROUPS), ...linksIn(CHALLENGE_RESOURCES), ...linksIn([RAD, REMS]), ...DATA_ENDPOINTS] },
    { title: 'Ciência das paradas', links: linksIn([STOPS, HAZARD]) },
    { title: 'Coletas do rover', links: linksIn(OPPORTUNITIES) },
    { title: 'Protocolos de emergência', links: linksIn(PROTOCOLS) },
    { title: 'Pesquisa (docs/pesquisa.md)', links: research },
  ];
  // Cada endereço aparece uma vez, no primeiro grupo em que é usado.
  const seen = new Set();
  return groups
    .map((group) => ({ ...group, links: group.links.filter(({ url }) => !seen.has(url) && seen.add(url)) }))
    .filter((group) => group.links.length > 0);
}
