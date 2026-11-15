import { chat } from '../_ponte.mjs';

export default { fetch: (request) => chat(request, process.env) };
