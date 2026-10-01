import { handleTest, readBackendEnv, safeConsoleLog } from '../ai/handlers';

// POST /api/ai/test (rewritten here by netlify.toml).
export default (request: Request): Promise<Response> =>
  handleTest(request, { env: readBackendEnv(process.env), fetch, log: safeConsoleLog });
