import { health } from '../_voz.mjs';

export default { fetch: () => health(process.env) };
