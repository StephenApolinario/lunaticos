import { health } from '../_ponte.mjs';

export default { fetch: () => health(process.env) };
