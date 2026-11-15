// Trava contra número inventado: todo valor com unidade que a IA escrever precisa estar nos dados
// que as ferramentas devolveram nesta pergunta (ou na própria pergunta). Arredondar pode; converter
// ou estimar, não. Puro: roda no Node e no navegador.

const NUMBER = /\d+(?:[.,]\d+)*/g;
// O que vem logo depois do número e mostra que ele é uma medida (e não uma contagem solta).
const UNIT_AFTER = /^\s?(%|°|º|h\d|h\b|min\b|km|m\b|m\/|kpa|pa\b|µ|msv|kg\b|g\b|w\b|×|x\b|vezes|por cento|graus?|horas?|minutos?|metros?|quil|sols?\b)/i;
// Inteiros pequenos sem unidade (contagens, passos, "parada 3") não precisam de conferência.
const FREE_INTEGER_MAX = 20;
const MAX_ROUNDABLE_DECIMALS = 2;

// Leituras possíveis de um número escrito: "1.080" pode ser mil e oitenta ou 1,08.
function readings(raw) {
  const plain = (text) => ({ value: Number.parseFloat(text), decimals: (text.split('.')[1] ?? '').length });
  if (/^\d+$/.test(raw)) return [plain(raw)];
  if (/^\d+,\d+$/.test(raw)) return [plain(raw.replace(',', '.'))];
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) {
    const thousands = plain(raw.replace(/\./g, '').replace(',', '.'));
    return /^\d+\.\d+$/.test(raw) ? [thousands, plain(raw)] : [thousands];
  }
  if (/^\d+\.\d+$/.test(raw)) return [plain(raw)];
  return raw.split(/[.,]/).filter(Boolean).map(plain);
}

function numbersOf(text) {
  return [...String(text).matchAll(NUMBER)].map((match) => ({
    raw: match[0],
    readings: readings(match[0]),
    hasUnit: UNIT_AFTER.test(text.slice(match.index + match[0].length, match.index + match[0].length + 12)),
  }));
}

/**
 * Valores da resposta que não aparecem em nenhuma das fontes.
 * @param {string} answer Texto que a IA quer dizer.
 * @param {string[]} sources Textos de onde os números podem vir (resultados das ferramentas, a pergunta).
 * @returns {string[]} Os números sem lastro, como foram escritos. Vazio = resposta conferida.
 */
export function ungroundedNumbers(answer, sources) {
  const known = sources.flatMap((source) => numbersOf(source).flatMap((number) => number.readings));
  // Vale o valor igual ou arredondado. Número de muitas casas (uma coordenada) só vale se a resposta
  // mantiver pelo menos duas: senão "5%" passaria por ser o arredondamento de uma latitude 4,76135.
  const isKnown = ({ value, decimals }) => known.some((source) => Math.abs(source.value - value) <= 0.5 * 10 ** -decimals + 1e-9
    && (source.decimals <= MAX_ROUNDABLE_DECIMALS || decimals >= MAX_ROUNDABLE_DECIMALS));
  const needsCheck = ({ readings: options, hasUnit }) => hasUnit || options.some(({ value, decimals }) => decimals > 0 || value > FREE_INTEGER_MAX);
  return [...new Set(numbersOf(answer).filter((number) => needsCheck(number) && !number.readings.some(isKnown)).map((number) => number.raw))];
}
