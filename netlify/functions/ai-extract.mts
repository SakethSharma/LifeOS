import { handleExtract, readBackendEnv, safeConsoleLog } from '../ai/handlers';

// POST /api/ai/extract (rewritten here by netlify.toml).
export default (request: Request): Promise<Response> =>
  handleExtract(request, { env: readBackendEnv(process.env), fetch, log: safeConsoleLog });
