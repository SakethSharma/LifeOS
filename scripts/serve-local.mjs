/**
 * Local LifeOS server: serves the production build and runs the real AI
 * backend handlers (netlify/ai/handlers.ts) — the same code Netlify runs —
 * so AI features work on this computer without the Netlify CLI.
 *
 *   npm run serve:local        → http://localhost:8080
 *
 * Needs AI_CREDENTIAL_SECRET in a git-ignored .env file (see README).
 * Binds to 127.0.0.1 only: API keys are sent over plain HTTP locally, so the
 * server must not be reachable from other devices.
 */
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  handleChat,
  handleConnect,
  handleExtract,
  handleModels,
  handleTest,
  readBackendEnv,
  safeConsoleLog,
} from '../netlify/ai/handlers.ts';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_STATIC_ROOT = join(PROJECT_ROOT, 'dist', 'demo', 'browser');

/** Same routes netlify.toml rewrites to the functions. */
export const API_ROUTES = {
  '/api/ai/connect': handleConnect,
  '/api/ai/test': handleTest,
  '/api/ai/models': handleModels,
  '/api/ai/chat': handleChat,
  '/api/ai/extract': handleExtract,
};

/** Slightly above the handlers' own 6 MB limit, so they produce the proper error. */
const MAX_API_BODY_BYTES = 6_500_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const BASE_HEADERS = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' };

/**
 * Creates (but doesn't start) the local server.
 * `deps` are the AI handlers' dependencies — tests pass a fake fetch/log.
 */
export function createLocalServer({ staticRoot = DEFAULT_STATIC_ROOT, deps }) {
  const root = resolve(staticRoot);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const handler = Object.hasOwn(API_ROUTES, url.pathname) ? API_ROUTES[url.pathname] : null;

      if (handler) {
        await handleApi(handler, req, res, url, deps);
      } else if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { success: false, errorCode: 'INVALID_REQUEST' });
      } else {
        await handleStatic(root, req, res, url);
      }
    } catch {
      // Never echo internals; the handlers already return their own safe errors.
      if (!res.headersSent) {
        sendJson(res, 500, { success: false, errorCode: 'SERVER_ERROR' });
      } else {
        res.end();
      }
    }
  });
}

// ---- API: Node request → Web Request → existing handler → Web Response → Node response ----

async function handleApi(handler, req, res, url, deps) {
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  let body;

  if (hasBody) {
    body = await readBody(req, MAX_API_BODY_BYTES);

    if (body === null) {
      sendJson(res, 413, { success: false, errorCode: 'INVALID_REQUEST' });
      return;
    }
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }

  // If the app stops waiting (the user tapped Stop), abort the handler's provider call too.
  const clientGone = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) clientGone.abort();
  });

  const request = new Request(url, { method, headers, body, signal: clientGone.signal });
  const response = await handler(request, deps);

  if (clientGone.signal.aborted || res.destroyed) {
    return;
  }

  const responseBody = Buffer.from(await response.arrayBuffer());

  res.writeHead(response.status, { ...BASE_HEADERS, ...Object.fromEntries(response.headers) });
  res.end(responseBody);
}

/** Reads the whole body, or returns null as soon as it exceeds `limit` bytes. */
function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolveBody(tooLarge ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---- Static files + Angular route fallback ----

async function handleStatic(root, req, res, url) {
  const method = req.method ?? 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { ...BASE_HEADERS, allow: 'GET, HEAD' });
    res.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, BASE_HEADERS);
    res.end();
    return;
  }

  // Resolve inside the build folder only (blocks ../ traversal).
  const filePath = normalize(join(root, pathname));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.writeHead(403, BASE_HEADERS);
    res.end();
    return;
  }

  const file = await fileIfExists(filePath === root ? join(root, 'index.html') : filePath);

  if (file) {
    sendFile(res, method, file.path, file.data);
    return;
  }

  // App routes like /info or /ai-insights have no extension → serve the app shell.
  // Missing assets (e.g. /missing.js) stay a real 404.
  if (!extname(pathname)) {
    const index = await fileIfExists(join(root, 'index.html'));
    if (index) {
      sendFile(res, method, index.path, index.data);
      return;
    }
  }

  res.writeHead(404, { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
  res.end(method === 'HEAD' ? undefined : 'Not found');
}

async function fileIfExists(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { path, data: await readFile(path) };
  } catch {
    return null;
  }
}

function sendFile(res, method, path, data) {
  res.writeHead(200, {
    ...BASE_HEADERS,
    'content-type': MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': data.length,
  });
  res.end(method === 'HEAD' ? undefined : data);
}

function sendJson(res, status, body) {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---- CLI ----

function isLoopback(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * True if something already accepts connections on this port. Needed because
 * Windows lets us bind 127.0.0.1:PORT even while another server (e.g.
 * http-server) holds 0.0.0.0:PORT — two servers would then silently share it.
 */
function portAlreadyServed(port) {
  return new Promise((resolveTaken) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const done = (taken) => {
      socket.destroy();
      resolveTaken(taken);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function main() {
  const envFile = join(PROJECT_ROOT, '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const host = process.env.LIFEOS_HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.PORT) || 8080;
  const staticRoot = process.env.LIFEOS_STATIC_ROOT?.trim() || DEFAULT_STATIC_ROOT;
  const env = readBackendEnv(process.env);

  if (!existsSync(join(staticRoot, 'index.html'))) {
    console.error(`No production build found in ${staticRoot}. Run "npm run build" first.`);
    process.exit(1);
  }

  // Report only whether the secret is usable — never its value.
  if (!env.credentialSecret || env.credentialSecret.length < 32) {
    console.warn(
      existsSync(envFile)
        ? 'AI_CREDENTIAL_SECRET in .env is missing or shorter than 32 characters — AI connections will fail.'
        : 'No .env file found — AI connections will fail. Create one with AI_CREDENTIAL_SECRET (see README → "Local development").',
    );
  } else {
    console.log('AI_CREDENTIAL_SECRET loaded from environment.');
  }

  if (!isLoopback(host)) {
    console.warn(
      `WARNING: listening on ${host}. API keys travel over plain HTTP — anyone on this network could read them. Use 127.0.0.1 unless you understand the risk.`,
    );
  }

  const portInUseMessage = `Port ${port} is already in use (perhaps http-server?). Stop that server first, or set PORT to another port.`;

  if (await portAlreadyServed(port)) {
    console.error(portInUseMessage);
    process.exit(1);
  }

  const server = createLocalServer({ staticRoot, deps: { env, fetch, log: safeConsoleLog } });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(portInUseMessage);
    } else {
      console.error(`Could not start the server: ${err.code ?? err.message}`);
    }
    process.exit(1);
  });

  server.listen(port, host, () => {
    const shown = isLoopback(host) ? 'localhost' : host;
    console.log(`LifeOS running at http://${shown}:${port}  (AI backend: /api/ai/*)`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
