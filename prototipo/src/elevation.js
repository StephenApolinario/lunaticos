// Carrega a grade de altitude real (extraída do DEM do USGS por tools/extrair-dem.mjs).

const ELEVATION_DIR = './assets/elevation/';
const META_FILE = 'monte-sharp.json';
const SAFE_FILE_NAME = /^[\w-]+\.u16$/;

async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao carregar ${url}: HTTP ${response.status}`);
  return response;
}

/**
 * @returns {Promise<{ meta: object, values: Uint16Array }>} Rejeita se o arquivo faltar ou vier malformado.
 */
export async function loadElevation() {
  const meta = await (await fetchOk(ELEVATION_DIR + META_FILE)).json();
  // O nome do arquivo de dados vem do JSON: só aceita um nome simples, na mesma pasta.
  if (typeof meta?.file !== 'string' || !SAFE_FILE_NAME.test(meta.file)) {
    throw new Error('Descrição da grade de altitude sem um nome de arquivo válido.');
  }
  const buffer = await (await fetchOk(ELEVATION_DIR + meta.file)).arrayBuffer();
  if (buffer.byteLength % 2 !== 0) throw new Error('Arquivo de altitude com tamanho inesperado.');
  return { meta, values: new Uint16Array(buffer) };
}
