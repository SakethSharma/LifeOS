import { handleConnect, readBackendEnv, safeConsoleLog } from '../ai/handlers';

// POST /api/ai/connect (rewritten here by netlify.toml).
export default (request: Request): Promise<Response> =>
  handleConnect(request, { env: readBackendEnv(process.env), fetch, log: safeConsoleLog });
