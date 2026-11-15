import { listen } from '../_voz.mjs';

export default { fetch: (request) => listen(request, process.env) };
