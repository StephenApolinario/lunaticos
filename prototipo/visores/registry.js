// Registro das variantes de visor. A variante é escolhida por ?visor=<id> na URL.
// Cada uma mora em visores/<id>/ e segue o contrato de LEIA-ME.md.

import { t } from '../src/i18n.js';

export const VISORS = Object.freeze([
  { id: 'unificado', name: t`Visor único` },
  { id: 'base', name: 'Base' },
  { id: 'guardiao', name: t`Guardião · segurança` },
  { id: 'navegador', name: t`Navegador · terreno` },
  { id: 'cientista', name: t`Cientista · assistente` },
]);
// O visor único junta o Guardião, o Navegador e o Cientista. As outras variantes ficam
// disponíveis para comparação.
export const DEFAULT_VISOR = 'unificado';

const isKnown = (id) => VISORS.some((visor) => visor.id === id);

// Só aceita um id que esteja na lista acima: o valor vem da URL.
export function visorIdFromUrl(search = window.location.search) {
  const requested = new URLSearchParams(search).get('visor');
  return requested && isKnown(requested) ? requested : DEFAULT_VISOR;
}

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Falha ao carregar ${href}`));
    document.head.append(link);
  });
}

/**
 * Carrega o CSS e o módulo de uma variante.
 * @param {string} id
 * @returns {Promise<(context: object) => { start: (plan: object) => void, stop: () => void, frame: (dtS: number) => void }>}
 */
export async function loadVisor(id) {
  if (!isKnown(id)) throw new Error(`Visor desconhecido: ${id}`);
  const base = new URL(`./${id}/`, import.meta.url);
  await loadStylesheet(new URL('visor.css', base).href);
  const module = await import(new URL('visor.js', base).href);
  if (typeof module.createVisor !== 'function') throw new Error(`O visor "${id}" não exporta createVisor.`);
  return module.createVisor;
}
