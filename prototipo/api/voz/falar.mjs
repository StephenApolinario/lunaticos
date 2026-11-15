import { speak } from '../_voz.mjs';

export default { fetch: (request) => speak(request, process.env) };
