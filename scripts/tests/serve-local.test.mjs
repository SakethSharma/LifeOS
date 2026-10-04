/**
 * Tests for scripts/serve-local.mjs: static serving, Angular route fallback,
 * and dispatch of /api/ai/* to the real handlers (with a fake provider).
 * Run with: npm run test:ai
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createLocalServer } from '../serve-local.mjs';
import { readBackendEnv } from '../../netlify/ai/handlers.ts';

const SECRET = 'local-test-secret-that-is-long-enough-1234567890';
const FAKE_KEY = 'sk-proj-LOCALTESTKEY0000000000abcd';

let server;
let base;
let staticRoot;
let providerCalls = [];
let providerReply = () => new Response('{}', { status: 200 });
const logs = [];

before(async () => {
  staticRoot = mkdtempSync(join(tmpdir(), 'lifeos-serve-'));
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>LifeOS</title><app-root></app-root>');
  writeFileSync(join(staticRoot, 'main.js'), 'console.log("app");');
  writeFileSync(join(staticRoot, 'styles.css'), 'body{}');

  server = createLocalServer({
    staticRoot,
    deps: {
      env: readBackendEnv({ AI_CREDENTIAL_SECRET: SECRET, AI_PROVIDER_TIMEOUT_MS: '2000' }),
      fetch: async (url, init) => {
        providerCalls.push({ url: String(url), init });
        return providerReply(String(url));
      },
      log: (event, fields) => logs.push({ event, fields }),
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(staticRoot, { recursive: true, force: true });
});

const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Raw request so the path isn't normalized by URL parsing (for traversal tests). */
const rawGet = (path) =>
  new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });

// ---- Static files & Angular routes ----

test('static: index, assets with correct types, and Angular route fallback', async () => {
  const root = await fetch(base + '/');
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /text\/html/);

  for (const route of ['/home', '/info', '/ai-insights', '/settings', '/info/']) {
    const res = await fetch(base + route);
    assert.equal(res.status, 200, route);
    assert.match(await res.text(), /<app-root>/, `${route} serves the app shell`);
  }

  const js = await fetch(base + '/main.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff');

  const css = await fetch(base + '/styles.css');
  assert.match(css.headers.get('content-type'), /text\/css/);
});

test('static: missing assets are real 404s, not the app shell', async () => {
  const res = await fetch(base + '/missing-chunk.js');
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /<app-root>/);
});

test('static: path traversal outside the build folder is blocked', async () => {
  for (const path of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/package.json']) {
    const res = await rawGet(path);
    assert.ok([403, 404].includes(res.status), `${path} → ${res.status}`);
    assert.doesNotMatch(res.body, /"name"|"scripts"/, `${path} must not leak files`);
  }
});

test('static: POST to an app page is 405 (only /api/ai/* accepts POST)', async () => {
  const res = await post('/info', {});
  assert.equal(res.status, 405);
});

// ---- API dispatch to the existing handlers ----

test('api: connect with an empty key → NOT_CONFIGURED, provider never called', async () => {
  providerCalls = [];
  const res = await post('/api/ai/connect', { provider: 'openai', apiKey: '' });

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { success: false, errorCode: 'NOT_CONFIGURED' });
  assert.equal(providerCalls.length, 0);
});

test('api: connect with a key the provider rejects → INVALID_KEY (401), no provider text', async () => {
  providerCalls = [];
  providerReply = () => new Response(JSON.stringify({ error: { message: 'Incorrect API key SECRET-PROVIDER-DETAIL' } }), { status: 401 });

  const res = await post('/api/ai/connect', { provider: 'openai', apiKey: FAKE_KEY });
  const text = await res.text();

  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(text), { success: false, errorCode: 'INVALID_KEY' });
  assert.ok(!text.includes('SECRET-PROVIDER-DETAIL') && !text.includes(FAKE_KEY));
  assert.equal(providerCalls[0].url, 'https://api.openai.com/v1/models', 'the real handler made the provider check');
});

test('api: connect → test → chat → extract all reach their handlers; credential header passes through', async () => {
  providerReply = (url) =>
    url.endsWith('/models')
      ? new Response(JSON.stringify({ data: [] }), { status: 200 })
      : new Response(JSON.stringify({ choices: [{ message: { content: 'From the provider' } }] }), { status: 200 });

  const connect = await post('/api/ai/connect', { provider: 'openai', apiKey: FAKE_KEY });
  const connected = await connect.json();
  assert.equal(connect.status, 200);
  assert.equal(connected.keyHint, 'sk-proj-••••••••abcd');
  assert.ok(!JSON.stringify(connected).includes(FAKE_KEY), 'raw key never returned');

  const auth = { 'x-lifeos-ai-credential': connected.credential };

  const testRes = await post('/api/ai/test', { provider: 'openai' }, auth);
  assert.equal(testRes.status, 200);

  const chat = await post('/api/ai/chat', { provider: 'openai', history: [], message: 'Hi', context: null }, auth);
  assert.deepEqual(await chat.json(), { success: true, provider: 'openai', message: 'From the provider' });

  const extract = await post(
    '/api/ai/extract',
    { provider: 'openai', task: 'salary_document', blocks: [{ type: 'text', text: 'Basic 50000' }] },
    auth,
  );
  assert.equal(extract.status, 200);

  const noCredential = await post('/api/ai/test', { provider: 'openai' });
  assert.equal((await noCredential.json()).errorCode, 'NOT_CONFIGURED');
});

test('api: wrong method gets the handler\'s JSON 405; unknown API routes get JSON 404', async () => {
  const get = await fetch(base + '/api/ai/connect');
  assert.equal(get.status, 405);
  assert.deepEqual(await get.json(), { success: false, errorCode: 'INVALID_REQUEST' }, 'JSON — so the app shows a real error, not "backend not running"');

  const unknown = await post('/api/ai/nope', {});
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).success, false);
});

test('api: CORS preflight is answered by the handler for the Android origin', async () => {
  const res = await fetch(base + '/api/ai/chat', { method: 'OPTIONS', headers: { origin: 'https://localhost' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://localhost');
});

test('api: oversized bodies are refused before reaching a provider', async () => {
  providerCalls = [];
  const res = await post('/api/ai/chat', 'x'.repeat(6_600_000));
  assert.equal(res.status, 413);
  assert.equal(providerCalls.length, 0);
});

test('api: Google Gemini connects and chats through the local server like the other providers', async () => {
  providerCalls = [];
  providerReply = (url) =>
    url.includes(':generateContent')
      ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini says hi' }] } }] }), { status: 200 })
      : new Response(JSON.stringify({ models: [] }), { status: 200 });

  const geminiKey = 'AIzaSyLOCAL-gemini-test-key-0000000';
  const connect = await post('/api/ai/connect', { provider: 'gemini', apiKey: geminiKey });
  const connected = await connect.json();
  assert.equal(connect.status, 200);
  assert.equal(connected.provider, 'gemini');
  assert.equal(connected.verified, true);

  const chat = await post('/api/ai/chat', { provider: 'gemini', message: 'Hi' }, { 'x-lifeos-ai-credential': connected.credential });
  assert.deepEqual(await chat.json(), { success: true, provider: 'gemini', message: 'Gemini says hi' });

  assert.ok(providerCalls.every((c) => c.url.startsWith('https://generativelanguage.googleapis.com/') && !c.url.includes(geminiKey)));

  // The Gemini credential is refused for another provider, even through the local server.
  const crossed = await post('/api/ai/chat', { provider: 'openai', message: 'Hi' }, { 'x-lifeos-ai-credential': connected.credential });
  assert.equal((await crossed.json()).errorCode, 'INVALID_KEY');
});

test('api: billing errors pass through the local server as clean codes', async () => {
  providerReply = (url) =>
    url.endsWith('/models')
      ? new Response(JSON.stringify({ data: [] }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota DETAIL' } }), { status: 429 });

  const connected = await (await post('/api/ai/connect', { provider: 'openai', apiKey: FAKE_KEY })).json();
  const chat = await post('/api/ai/chat', { provider: 'openai', message: 'Hi' }, { 'x-lifeos-ai-credential': connected.credential });
  const text = await chat.text();

  assert.equal(chat.status, 402);
  assert.deepEqual(JSON.parse(text), { success: false, errorCode: 'QUOTA_EXCEEDED' });
  assert.ok(!text.includes('DETAIL'));
});

test('logs never contain the API key, the sealed credential, or the message', () => {
  const all = JSON.stringify(logs);
  assert.ok(logs.length > 0);
  assert.ok(!all.includes(FAKE_KEY) && !all.includes('LOCALTESTKEY'));
  assert.ok(!all.includes('v1.'), 'no sealed credential');
  assert.ok(!all.includes('Basic 50000'));
});
