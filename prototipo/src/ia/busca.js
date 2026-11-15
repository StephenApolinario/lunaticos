// Busca nas fontes da missão: a IA consulta aqui o que foi pesquisado e publicado, em vez de
// responder de memória. O acervo junta a pesquisa (docs/pesquisa.md), a ciência das paradas, as
// coletas do rover, os protocolos e a lista "de onde vem cada informação". Puro.

import { RESEARCH_FACTS } from '../../data/pesquisa.js';
import { RESEARCH_FACTS_EN } from '../../data/pesquisa-en.js';
import { STOPS, HAZARD } from '../../data/travessia.js';
import { OPPORTUNITIES } from '../../data/oportunidades.js';
import { PROTOCOLS } from '../../data/protocolos.js';
import { KINDS, SOURCE_GROUPS, CHALLENGE_RESOURCES } from '../../data/fontes.js';
import { IS_ENGLISH, t } from '../i18n.js';

// O acervo acompanha o idioma da interface: a pergunta em inglês casa com o texto em inglês.
const FACTS = IS_ENGLISH ? RESEARCH_FACTS_EN : RESEARCH_FACTS;

const MAX_RESULTS = 5;
const STEM_CHARS = 6;
const MIN_SCORE = 1.2;
const STOPWORDS_PT = 'a o e de da do das dos em no na nos nas um uma uns umas para por com sem que qual quais como onde quando quanto quanta'
  + ' se ser esta este isso essa esse aqui ali la ja nao sim mais menos muito pouco sobre entre ate tem ter foi sao era meu minha seu sua eu voce'
  + ' vem vai fazer faz fala diz dizer the of and me te lhe pra pro ao aos as os';
const STOPWORDS_EN = 'a an the of and or to in on at for with without is are was were be been it its this that these those what which how where when who why'
  + ' do does did can could should would will my your our their me you we they he she there here from by as about into than then so not no yes more less very'
  + ' much many any some have has had if but tell say says know';
const STOPWORDS = new Set((IS_ENGLISH ? STOPWORDS_EN : STOPWORDS_PT).split(' '));

const normalize = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Radical simples: sem plural e cortado em seis letras ("abrigos", "abrigar" e "abrigo" se encontram).
const stem = (word) => word.replace(/(es|s)$/, '').slice(0, STEM_CHARS);
const wordsOf = (text) => normalize(text).split(/[^a-z0-9]+/).filter((word) => word.length >= 2 && !STOPWORDS.has(word));
const termsOf = (text) => wordsOf(text).map(stem);

// Palavras do astronauta que nas fontes aparecem com outro nome.
const SYNONYMS_PT = Object.freeze({
  saida: ['eva'], traje: ['xemu', 'axemu', 'emu'], volta: ['walkback', 'retorno'], poeira: ['tau', 'opacidade', 'tempestade'],
  radiacao: ['rad', 'dose'], frio: ['temperatura'], calor: ['temperatura'], clima: ['rems', 'temperatura'], jipe: ['lrv', 'veiculo'],
  rover: ['curiosity'], furo: ['perfuracao', 'broca'], amostra: ['coleta'], duracao: ['horas'], abrigo: ['protecao', 'paredao'],
});
const SYNONYMS_EN = Object.freeze({
  spacewalk: ['eva'], marswalk: ['eva'], outing: ['eva'], suit: ['xemu', 'axemu', 'emu'], dust: ['tau', 'opacity', 'storm'],
  radiation: ['rad', 'dose'], cold: ['temperature'], heat: ['temperature'], weather: ['rems', 'temperature'], jeep: ['lrv', 'vehicle'],
  rover: ['curiosity'], hole: ['drilling', 'drill'], sample: ['sampling'], duration: ['hours'], shelter: ['protection', 'cliff'],
});
const SYNONYMS = IS_ENGLISH ? SYNONYMS_EN : SYNONYMS_PT;
// Em inglês o plural simples acha o mesmo sinônimo ("suits", "holes").
const synonymsOf = (word) => SYNONYMS[word] ?? (IS_ENGLISH ? SYNONYMS[word.replace(/s$/, '')] : undefined) ?? [];
const expand = (words) => words.flatMap((word) => [word, ...synonymsOf(word)]);

const entry = (tema, texto, tipo, fontes = []) => ({ tema, texto, tipo, fontes: fontes.filter((source) => source?.url) });

function buildCorpus() {
  const published = t('fato publicado');
  const team = t('proposta da equipe');
  return [
    ...FACTS.map((fact) => entry(fact.tema, fact.texto, fact.daEquipe ? team : published, fact.fontes)),
    ...STOPS.flatMap((stop) => [
      entry(t`Parada ${stop.id}: ${stop.name}`, `${stop.sci} ${stop.imp} ${stop.int}`, published, stop.sources ?? []),
      entry(t`Parada ${stop.id}: ${stop.name} (roteiro)`, t`Pergunta científica: ${stop.q} Tarefa: ${stop.task}${stop.risk ? t` Risco do local: ${stop.risk}.` : ''}`, team),
    ]),
    entry(t('Zona de rochas cortantes'), HAZARD.name, team, [HAZARD.source]),
    ...OPPORTUNITIES.map((item) => entry(t`Coleta do Curiosity em ${item.name} (sol ${item.sol})`, item.what, published, [item.source])),
    ...PROTOCOLS.flatMap((protocol) => [
      entry(t`Protocolo: ${protocol.title}`, t`Quando: ${protocol.trigger} Passos: ${protocol.steps.join(' ')}`, team),
      ...protocol.evidence.map((fact) => entry(t`Base do protocolo: ${protocol.title}`, fact.text, published, [{ label: fact.label, url: fact.url }])),
    ]),
    ...SOURCE_GROUPS.flatMap((group) => group.entries.map((item) =>
      entry(t`De onde vem: ${item.item}`, `${item.item}: ${KINDS[item.kind]}. ${item.source}`, KINDS[item.kind].toLowerCase(), [{ label: t('fonte'), url: item.url }]))),
    ...CHALLENGE_RESOURCES.map((resource) => entry(t`Recurso do desafio: ${resource.name}`, resource.use, t('recurso da NASA'), [{ label: resource.name, url: resource.url }])),
  ];
}

/**
 * @returns {(query: string, limit?: number, minScore?: number) => Array<{ tema: string, texto: string, tipo: string, fontes: Array<{ label: string, url: string }> }>}
 *   Os fatos mais próximos da consulta, do melhor para o pior. Lista vazia se nada no acervo tem a ver.
 */
export function createFactSearch() {
  const corpus = buildCorpus().map((fact) => ({ fact, terms: new Set(termsOf(`${fact.tema} ${fact.texto}`)), themeTerms: new Set(termsOf(fact.tema)) }));
  const frequency = new Map();
  for (const { terms } of corpus) for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  // Termo raro vale mais que termo que aparece em todo lugar.
  const weight = (term) => Math.log(1 + corpus.length / (frequency.get(term) ?? corpus.length));

  return (query, limit = MAX_RESULTS, minScore = MIN_SCORE) => {
    const wanted = [...new Set(expand(wordsOf(query)).map(stem))].filter((term) => frequency.has(term));
    if (wanted.length === 0) return [];
    return corpus
      .map(({ fact, terms, themeTerms }) => {
        const hits = wanted.filter((term) => terms.has(term));
        const raw = hits.reduce((sum, term) => sum + weight(term) * (themeTerms.has(term) ? 1.5 : 1), 0);
        // Quem casa com mais palavras da pergunta sobe: evita ganhar por uma palavra só.
        return { fact, score: raw * (0.5 + (0.5 * hits.length) / wanted.length) };
      })
      .filter(({ score }) => score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(limit, MAX_RESULTS))
      .map(({ fact }) => fact);
  };
}
