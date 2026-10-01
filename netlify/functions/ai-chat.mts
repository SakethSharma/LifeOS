import { handleChat, readBackendEnv, safeConsoleLog } from '../ai/handlers';

// POST /api/ai/chat (rewritten here by netlify.toml).
export default (request: Request): Promise<Response> =>
  handleChat(request, { env: readBackendEnv(process.env), fetch, log: safeConsoleLog });
