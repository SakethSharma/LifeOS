import { handleModels, readBackendEnv, safeConsoleLog } from '../ai/handlers';

// POST /api/ai/models (rewritten here by netlify.toml).
export default (request: Request): Promise<Response> =>
  handleModels(request, { env: readBackendEnv(process.env), fetch, log: safeConsoleLog });
