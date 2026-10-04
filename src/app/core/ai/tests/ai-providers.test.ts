/**
 * Tests for Ollama (local AI), model selection, and switching between cloud
 * and local providers. All network calls are faked: no paid API access or
 * running Ollama server is needed. Run with: npm run test:ai
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AI_CREDENTIAL_HEADER, AI_ERROR_CODES, isAiProviderId, isValidModelId, unsupportedAttachmentKinds } from '../ai-contract';
import { AiBackendClient } from '../ai-backend-client';
import { AI_CONNECTIONS_STORAGE_KEY, AiConnectionStorage } from '../ai-connection-storage';
import { AiConnectionManager } from '../ai-connection-manager';
import { AiRequestError, describeAiError } from '../ai-errors';
import { getBillingUrl, providerLabel } from '../ai-provider-guides';
import { OllamaClient, classifyOllamaError, normalizeOllamaUrl } from '../ollama-client';

type Call = { url: string; init: RequestInit; body: Record<string, unknown> | null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const TAGS = { models: [{ name: 'llama3.2:latest' }, { name: 'llava:7b' }] };

/** Fake network for both the LifeOS backend (relative /api/ai/*) and Ollama (http://localhost:11434). */
function setup(options: { ollama?: (call: Call) => Response | Promise<Response>; backend?: (call: Call) => Response | undefined } = {}, mem = memoryStorage()) {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init: RequestInit = {}) => {
    const call = { url, init, body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);

    if (url.startsWith('/api/ai/')) {
      const custom = options.backend?.(call);
      if (custom) return custom;
      const provider = call.body?.['provider'];
      if (url.endsWith('/connect')) {
        return json(200, { success: true, provider, credential: `sealed-for-${provider}`, keyHint: 'xx••••••••1234', verified: true });
      }
      if (url.endsWith('/models')) {
        return json(200, { success: true, provider, defaultModel: 'gpt-4.1-mini', models: [{ id: 'gpt-4.1', label: 'gpt-4.1' }] });
      }
      return json(200, { success: true, provider, message: `reply from ${provider}` });
    }

    if (options.ollama) return options.ollama(call);
    if (url.endsWith('/api/tags')) return json(200, TAGS);
    if (url.endsWith('/api/chat')) return json(200, { message: { role: 'assistant', content: 'local reply' }, done: true });
    return json(404, { error: 'not found' });
  }) as unknown as typeof fetch;

  const manager = new AiConnectionManager(
    new AiConnectionStorage(mem),
    new AiBackendClient({ baseUrl: '', isOnline: () => true, fetch: fakeFetch }),
    () => {},
    () => new Date('2026-10-04T10:00:00Z'),
    new OllamaClient({ fetch: fakeFetch }),
  );

  return { manager, calls, mem };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (err) {
    assert.ok(err instanceof AiRequestError);
    return err.code;
  }
}

// ---- Ollama URL handling --------------------------------------------------------

test('ollama url: localhost http is fine; other hosts need https; no credentials, paths or queries', () => {
  assert.equal(normalizeOllamaUrl('http://localhost:11434'), 'http://localhost:11434');
  assert.equal(normalizeOllamaUrl(' http://127.0.0.1:11434/ '), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaUrl('http://[::1]:11434'), 'http://[::1]:11434');
  assert.equal(normalizeOllamaUrl('https://ollama.example.com'), 'https://ollama.example.com');

  assert.equal(normalizeOllamaUrl('http://192.168.1.20:11434'), null, 'plain http across a network is refused');
  assert.equal(normalizeOllamaUrl('http://user:pass@localhost:11434'), null);
  assert.equal(normalizeOllamaUrl('http://localhost:11434/api'), null);
  assert.equal(normalizeOllamaUrl('http://localhost:11434?x=1'), null);
  assert.equal(normalizeOllamaUrl('javascript:alert(1)'), null);
  assert.equal(normalizeOllamaUrl('not a url'), null);
});

// ---- Ollama client --------------------------------------------------------------

test('ollama client: lists installed models from /api/tags', async () => {
  const calls: Call[] = [];
  const client = new OllamaClient({
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init, body: null });
      return json(200, TAGS);
    }) as unknown as typeof fetch,
  });

  const models = await client.listModels('http://localhost:11434');

  assert.deepEqual(models.map((m) => m.id), ['llama3.2:latest', 'llava:7b']);
  assert.equal(calls[0].url, 'http://localhost:11434/api/tags');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.cache, 'no-store');
});

test('ollama client: chat builds a non-streaming /api/chat request with system, history and images', async () => {
  let sent: Record<string, unknown> = {};
  const client = new OllamaClient({
    fetch: (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return json(200, { message: { role: 'assistant', content: '  Housing is your largest expense.  ' } });
    }) as unknown as typeof fetch,
  });

  const reply = await client.chat({
    baseUrl: 'http://localhost:11434',
    model: 'llava:7b',
    system: 'RULES',
    turns: [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'What is this?' },
    ],
    blocks: [{ type: 'image', mediaType: 'image/png', base64Data: 'aGVsbG8=' }],
    maxTokens: 700,
  });

  assert.equal(reply, 'Housing is your largest expense.');
  assert.equal(sent['model'], 'llava:7b');
  assert.equal(sent['stream'], false);
  assert.deepEqual(sent['options'], { num_predict: 700 });
  const messages = sent['messages'] as Record<string, unknown>[];
  assert.deepEqual(messages[0], { role: 'system', content: 'RULES' });
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[3], { role: 'user', content: 'What is this?', images: ['aGVsbG8='] });
  assert.equal(messages[1]['images'], undefined, 'images ride only with the newest message');
});

test('ollama client: PDFs are refused before any request (Ollama has no PDF input)', async () => {
  let called = false;
  const client = new OllamaClient({ fetch: (async () => ((called = true), json(200, {}))) as unknown as typeof fetch });

  const code = await codeOf(
    client.chat({
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2',
      system: 's',
      turns: [{ role: 'user', content: 'x' }],
      blocks: [{ type: 'document', mediaType: 'application/pdf', base64Data: 'aGVsbG8=' }],
      maxTokens: 10,
    }),
  );

  assert.equal(code, 'UNSUPPORTED_CAPABILITY');
  assert.equal(called, false);
  assert.deepEqual(unsupportedAttachmentKinds('ollama', [{ type: 'document', mediaType: 'application/pdf', base64Data: 'a' }]), ['pdf']);
  assert.deepEqual(unsupportedAttachmentKinds('ollama', [{ type: 'image', mediaType: 'image/png', base64Data: 'a' }]), []);
});

test('ollama client: not running / CORS, timeouts, missing models and bad replies get clear codes', async () => {
  const make = (impl: () => Promise<Response>) => new OllamaClient({ fetch: impl as unknown as typeof fetch });
  const chat = (c: OllamaClient) =>
    c.chat({ baseUrl: 'http://localhost:11434', model: 'm', system: 's', turns: [{ role: 'user', content: 'x' }], maxTokens: 5 });

  assert.equal(await codeOf(make(async () => Promise.reject(new TypeError('Failed to fetch'))).listModels('http://localhost:11434')), 'LOCAL_AI_UNREACHABLE');
  assert.equal(
    await codeOf(make(async () => Promise.reject(new DOMException('t', 'TimeoutError'))).listModels('http://localhost:11434')),
    'TIMEOUT',
  );
  assert.equal(await codeOf(chat(make(async () => json(404, { error: "model 'm' not found" })))), 'MODEL_UNAVAILABLE');
  assert.equal(await codeOf(chat(make(async () => json(403, {})))), 'LOCAL_AI_UNREACHABLE', 'origin not allowed by OLLAMA_ORIGINS');
  assert.equal(await codeOf(chat(make(async () => json(500, { error: 'boom' })))), 'PROVIDER_ERROR');
  assert.equal(await codeOf(chat(make(async () => json(200, { message: { content: '' } })))), 'EMPTY_RESPONSE');
  assert.equal(await codeOf(chat(make(async () => new Response('<html>', { status: 200 })))), 'EMPTY_RESPONSE');
  assert.equal(await codeOf(make(async () => json(200, {})).listModels('http://10.0.0.5:11434')), 'INVALID_REQUEST');

  assert.equal(classifyOllamaError(400, 'this model does not support images'), 'UNSUPPORTED_CAPABILITY');
});

// ---- Manager: Ollama ---------------------------------------------------------------

test('ollama: saving checks the server and model; it becomes active only when nothing else is', async () => {
  const { manager } = setup();

  const result = await manager.saveOllama('http://localhost:11434', 'llama3.2:latest');

  assert.deepEqual(result, { errorCode: null, verified: true });
  assert.equal(manager.state.active, 'ollama');
  assert.deepEqual(manager.usableProviders(), ['ollama']);
  assert.equal(manager.state.providers.ollama?.model, 'llama3.2:latest');
  assert.equal(manager.state.providers.ollama?.status, 'connected');

  const missing = await manager.saveOllama('http://localhost:11434', 'not-installed');
  assert.equal(missing.errorCode, 'MODEL_UNAVAILABLE');
  assert.equal(manager.state.providers.ollama?.model, 'llama3.2:latest', 'existing settings untouched');
});

test('ollama: unreachable server is saved as "Not tested" (nothing secret), invalid addresses are refused', async () => {
  const { manager } = setup({ ollama: async () => Promise.reject(new TypeError('Failed to fetch')) });

  const result = await manager.saveOllama('http://localhost:11434', 'llama3.2');
  assert.deepEqual(result, { errorCode: null, verified: false });
  assert.equal(manager.state.providers.ollama?.status, 'not_tested');
  assert.equal(manager.state.providers.ollama?.lastErrorCode, 'LOCAL_AI_UNREACHABLE');

  assert.equal((await manager.saveOllama('http://192.168.0.9:11434', 'llama3.2')).errorCode, 'INVALID_REQUEST');
});

test('ollama: chat goes straight to Ollama with LifeOS rules and context — never to the LifeOS backend', async () => {
  const { manager, calls } = setup();
  await manager.saveOllama('http://localhost:11434', 'llama3.2:latest');
  calls.length = 0;

  const reply = await manager.chat([], 'How much did I spend?', { totalExpenses: 1234 });

  assert.deepEqual(reply, { text: 'local reply', provider: 'ollama' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:11434/api/chat');
  const messages = calls[0].body?.['messages'] as { role: string; content: string }[];
  assert.match(messages[0].content, /You are LifeOS AI/);
  assert.match(messages[0].content, /"totalExpenses":1234/);
  assert.ok(!calls.some((c) => c.url.startsWith('/api/ai/')));
  assert.ok(!JSON.stringify(calls[0].init.headers ?? {}).includes(AI_CREDENTIAL_HEADER), 'no credential header to Ollama');
});

test('ollama: the salary document reader also works with Ollama (extraction rules sent as system prompt)', async () => {
  const { manager, calls } = setup();
  await manager.saveOllama('http://localhost:11434', 'llama3.2:latest');
  calls.length = 0;

  await manager.extract('salary_document', [{ type: 'text', text: 'Basic 50000' }]);

  const messages = calls[0].body?.['messages'] as { role: string; content: string }[];
  assert.match(messages[0].content, /document-reading step of LifeOS/);
  assert.match(messages[1].content, /Basic 50000/);
});

// ---- Switching between cloud and local ---------------------------------------------

test('switching: each request uses only the active provider, its own model and its own credential', async () => {
  const { manager, calls } = setup();
  await manager.saveKey('openai', 'sk-openai-key-000000000000');
  await manager.saveKey('anthropic', 'sk-ant-key-00000000000000');
  await manager.saveOllama('http://localhost:11434', 'llama3.2:latest');
  assert.equal(manager.state.active, 'openai', 'adding providers never switches silently');
  assert.ok(manager.setModel('openai', 'gpt-4.1'));

  calls.length = 0;
  await manager.chat([], 'Hi', null);
  assert.equal(calls[0].url, '/api/ai/chat');
  assert.equal(calls[0].body?.['provider'], 'openai');
  assert.equal(calls[0].body?.['model'], 'gpt-4.1');
  assert.equal((calls[0].init.headers as Record<string, string>)[AI_CREDENTIAL_HEADER], 'sealed-for-openai');

  manager.setActiveProvider('anthropic');
  calls.length = 0;
  await manager.chat([], 'Hi', null);
  assert.equal(calls[0].body?.['provider'], 'anthropic');
  assert.equal(calls[0].body?.['model'], undefined, "OpenAI's model is never sent to Anthropic");
  assert.equal((calls[0].init.headers as Record<string, string>)[AI_CREDENTIAL_HEADER], 'sealed-for-anthropic');

  manager.setActiveProvider('ollama');
  calls.length = 0;
  await manager.chat([], 'Hi', null);
  assert.equal(calls[0].url, 'http://localhost:11434/api/chat');
  assert.ok(!JSON.stringify(calls[0]).includes('sealed-for'), 'no cloud credential ever reaches Ollama');
});

test('switching: a failed Ollama request is not retried through a cloud provider', async () => {
  const { manager, calls } = setup({ ollama: async (c) => (c.url.endsWith('/api/tags') ? json(200, TAGS) : Promise.reject(new TypeError('x'))) });
  await manager.saveKey('openai', 'sk-openai-key-000000000000');
  await manager.saveOllama('http://localhost:11434', 'llama3.2:latest');
  manager.setActiveProvider('ollama');
  calls.length = 0;

  assert.equal(await codeOf(manager.chat([], 'Hi', null)), 'LOCAL_AI_UNREACHABLE');
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((c) => c.url.startsWith('/api/ai/')));
  assert.equal(manager.state.active, 'ollama');
});

test('switching: removing Ollama keeps cloud keys; Ollama settings and model choices persist across restarts', async () => {
  const mem = memoryStorage();
  const first = setup({}, mem);
  await first.manager.saveKey('gemini', 'AIzaGeminiKey0000000000000');
  await first.manager.saveOllama('http://localhost:11434', 'llava:7b');
  first.manager.setModel('gemini', 'gemini-2.5-flash');

  const stored = mem.map.get(AI_CONNECTIONS_STORAGE_KEY) ?? '';
  assert.ok(!stored.includes('AIzaGeminiKey'), 'no raw key stored');

  const second = setup({}, mem);
  assert.equal(second.manager.state.providers.ollama?.model, 'llava:7b');
  assert.equal(second.manager.state.providers.ollama?.baseUrl, 'http://localhost:11434');
  assert.equal(second.manager.state.providers.gemini?.model, 'gemini-2.5-flash');

  second.manager.setActiveProvider('ollama');
  second.manager.removeProvider('ollama');
  assert.equal(second.manager.state.providers.ollama, undefined);
  assert.equal(second.manager.state.active, 'gemini');
  assert.ok(second.manager.state.providers.gemini);
});

test('storage: tampered Ollama addresses and model ids are dropped on load', () => {
  const mem = memoryStorage();
  mem.setItem(
    AI_CONNECTIONS_STORAGE_KEY,
    JSON.stringify({
      active: 'ollama',
      providers: { openai: { credential: 'c', keyHint: 'h', savedAt: '', status: 'connected', model: '../../evil?x=' } },
      ollama: { baseUrl: 'http://evil.example.com:11434', model: 'llama3.2', savedAt: '', status: 'connected' },
    }),
  );

  const loaded = new AiConnectionStorage(mem).load();
  assert.equal(loaded.ollama, undefined, 'plain-http non-local address refused');
  assert.equal(loaded.providers.openai?.model, undefined, 'unsafe model id refused');
  assert.equal(loaded.active, null);
});

// ---- Model selection ---------------------------------------------------------------

test('models: cloud models are listed through the backend with that provider\'s own credential', async () => {
  const { manager, calls } = setup();
  await manager.saveKey('openai', 'sk-openai-key-000000000000');
  calls.length = 0;

  const result = await manager.listModels('openai');

  assert.deepEqual(result, { models: [{ id: 'gpt-4.1', label: 'gpt-4.1' }], defaultModel: 'gpt-4.1-mini' });
  assert.equal(calls[0].url, '/api/ai/models');
  assert.equal((calls[0].init.headers as Record<string, string>)[AI_CREDENTIAL_HEADER], 'sealed-for-openai');
  assert.equal(await codeOf(manager.listModels('anthropic')), 'NOT_CONFIGURED', 'unconfigured provider: no request');
});

test('models: an answer for a different provider is refused', async () => {
  const { manager } = setup({
    backend: (c) => (c.url.endsWith('/models') ? json(200, { success: true, provider: 'gemini', models: [], defaultModel: 'x' }) : undefined),
  });
  await manager.saveKey('openai', 'sk-openai-key-000000000000');

  assert.equal(await codeOf(manager.listModels('openai')), 'UNKNOWN_ERROR');
});

test('models: invalid model ids are refused; null returns to the backend default', async () => {
  const { manager } = setup();
  await manager.saveKey('openai', 'sk-openai-key-000000000000');

  assert.equal(manager.setModel('openai', 'gpt-4.1/../../x'), false);
  assert.equal(manager.setModel('openai', 'gpt-4.1'), true);
  assert.equal(manager.state.providers.openai?.model, 'gpt-4.1');
  assert.equal(manager.setModel('openai', null), true);
  assert.equal(manager.state.providers.openai?.model, undefined);
  assert.equal(manager.setModel('gemini', 'gemini-2.5-flash'), false, 'unconfigured provider');

  assert.ok(isValidModelId('claude-haiku-4-5-20251001'));
  assert.ok(isValidModelId('gemini-flash-latest'));
  assert.ok(!isValidModelId('models/gemini'));
  assert.ok(!isValidModelId(''));
});

test('models: re-saving a key keeps the chosen model', async () => {
  const { manager } = setup();
  await manager.saveKey('openai', 'sk-openai-key-000000000000');
  manager.setModel('openai', 'gpt-4.1');
  await manager.saveKey('openai', 'sk-openai-key-111111111111');

  assert.equal(manager.state.providers.openai?.model, 'gpt-4.1');
});

// ---- Presentation -----------------------------------------------------------------

test('ollama is app-only: the backend provider check rejects it and it has no billing page', () => {
  assert.equal(isAiProviderId('ollama'), false);
  assert.equal(getBillingUrl('ollama'), null);
  assert.equal(providerLabel('ollama'), 'Ollama (local)');
  assert.equal(isAiProviderId('chatgpt'), false, 'ChatGPT is never treated as an API provider');
});

test('new error codes have friendly copy with a next step', () => {
  for (const code of ['LOCAL_AI_UNREACHABLE', 'MODEL_UNAVAILABLE'] as const) {
    assert.ok(AI_ERROR_CODES.includes(code));
    const view = describeAiError(code);
    assert.ok(view.title && view.message && view.actionLabel);
  }
  assert.match(describeAiError('LOCAL_AI_UNREACHABLE').message, /OLLAMA_ORIGINS/);
});
