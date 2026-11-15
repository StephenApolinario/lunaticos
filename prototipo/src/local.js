// A página está aberta neste computador (protótipo local) ou publicada num endereço da internet?
// Publicada, ela não procura os serviços locais (modelo no Ollama e servidor de voz em 127.0.0.1):
// eles não existem no computador de quem visita, e o navegador pediria permissão para acessar a
// rede local. A IA e a voz vêm do próprio site.

const LOCAL_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

// Fora do navegador (checagens no Node) vale como local.
export const IS_LOCAL_PAGE = !globalThis.location || LOCAL_HOSTS.includes(globalThis.location.hostname);
