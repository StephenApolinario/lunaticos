// Dicionário do inglês: junta as áreas. Cada área tem o seu arquivo em ./en/.
import tablet from './en/tablet.js';
import visor from './en/visor.js';
import guardiao from './en/guardiao.js';
import campo from './en/campo.js';
import dados from './en/dados.js';
import ia from './en/ia.js';

/** As áreas separadas, para a conferência achar chave repetida com traduções diferentes. */
export const AREAS = Object.freeze({ tablet, visor, guardiao, campo, dados, ia });

export default Object.freeze(Object.assign({}, ...Object.values(AREAS)));
