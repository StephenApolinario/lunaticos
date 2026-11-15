// Areia escura (fofa) estimada pela equipe a partir da cor da imagem HiRISE e do declive
// (tools/gerar-areia.mjs). Não é mapa de areia da NASA: serve para a rota preferir outro caminho
// e para avisar quem planeja. Uma célula da grade do relevo por bit.

const SAND_META_URL = './assets/areia/areia.json';

/**
 * @param {Uint8Array} bits 1 bit por célula, bit menos significativo primeiro.
 * @param {number} count Número de células da grade do relevo.
 * @returns {Uint8Array | null} 1 onde há areia, ou null se o arquivo não for desta grade.
 */
export function decodeSand(bits, count) {
  if (!bits || bits.length !== Math.ceil(count / 8)) return null;
  const cells = new Uint8Array(count);
  for (let i = 0; i < count; i++) cells[i] = (bits[i >> 3] >> (i & 7)) & 1;
  return cells;
}

/** Lê o arquivo da areia no navegador. Sem ele, o protótipo segue sem essa camada. */
export async function loadSandBits() {
  const meta = await (await fetch(SAND_META_URL)).json();
  const response = await fetch(new URL(meta.file, new URL(SAND_META_URL, window.location.href)));
  if (!response.ok) throw new Error(`Arquivo da areia: resposta ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
