import { health } from '../_voz.mjs';

export default { fetch: (request) => health(process.env, request) };
