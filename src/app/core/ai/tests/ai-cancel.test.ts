/**
 * Stop / cancellation tests: the chat session, the backend client, the Ollama
 * client, and the connection manager. Network calls are faked.
 * Run with: npm run test:ai
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AiChatSession, STOPPED_NOTICE } from '../ai-chat-session';
import { AiBackendClient } from '../ai-backend-client';
import { AiConnectionStorage } from '../ai-connection-storage';
import { AiConnectionManager } from '../ai-connection-manager';
import { AiRequestError, describeAiError, requestSignal } from '../ai-errors';
import { OllamaClient } from '../ollama-client';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fetch that never answers until its signal aborts — like a model still generating. */
function hangingFetch(seen: { signal?: AbortSignal; aborted?: boolean }[]) {
  return ((_url: string, init: RequestInit) => {
    const entry: { signal?: AbortSignal; aborted?: boolean } = { signal: init.signal ?? undefined };
    seen.push(entry);
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        entry.aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  }) as unknown as typeof fetch;
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

/** A sender whose reply the test releases by hand. */
function controllableSender() {
  const calls: { message: string; signal: AbortSignal; resolve: (text: string) => void; reject: (e: unknown) => void }[] = [];
  const sender = (_history: unknown, message: string, _blocks: unknown, signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => calls.push({ message, signal, resolve, reject }));
  return { sender, calls };
}

// ---- Chat session ------------------------------------------------------------------

test('stop: aborts the request, keeps the question, adds no reply and no error', async () => {
  const { sender, calls } = controllableSender();
  const session = new AiChatSession(sender);

  const sending = session.send('Where did I spend the most?');
  assert.equal(session.state.pending, true);

  assert.equal(session.stop(), true);
  assert.equal(calls[0].signal.aborted, true, 'the provider request was aborted');
  assert.equal(session.state.pending, false);
  assert.equal(session.state.error, null, 'stopping is not an error');
  assert.equal(session.state.unansweredPrompt, null);
  assert.deepEqual(session.state.messages.map((m) => [m.role, m.content]), [
    ['user', 'Where did I spend the most?'],
    ['notice', STOPPED_NOTICE],
  ]);

  // The provider answers anyway (or fails as aborted): nothing is added.
  calls[0].resolve('late answer');
  await sending;
  assert.equal(session.state.messages.length, 2);
  assert.ok(!session.state.messages.some((m) => m.content === 'late answer'));
});

test('stop: a new prompt works normally afterwards; the stopped question is not sent as history', async () => {
  const { sender, calls } = controllableSender();
  let lastHistory: unknown[] = [];
  const session = new AiChatSession((history, message, blocks, signal) => {
    lastHistory = history;
    return sender(history, message, blocks, signal);
  });

  void session.send('First');
  session.stop();
  assert.equal(session.canSend('Second'), true, 'Send is available again');

  const second = session.send('Second');
  assert.equal(calls[1].signal.aborted, false);
  calls[1].resolve('Answer to second');
  await second;

  assert.deepEqual(lastHistory, [], 'the unanswered (stopped) question is not history');
  assert.equal(session.state.messages.at(-1)?.content, 'Answer to second');
  assert.equal(session.state.pending, false);
});

test('stop: an abort error from the provider never shows as an error message', async () => {
  const { sender, calls } = controllableSender();
  const session = new AiChatSession(sender);

  const sending = session.send('Hi');
  session.stop();
  calls[0].reject(new AiRequestError('CANCELLED'));
  await sending;

  assert.equal(session.state.error, null);
});

test('stop: does nothing when no reply is in progress', () => {
  const session = new AiChatSession(async () => 'x');
  assert.equal(session.stop(), false);
  assert.equal(session.state.messages.length, 0);
});

test('reset during generation aborts the request and drops the late reply', async () => {
  const { sender, calls } = controllableSender();
  const session = new AiChatSession(sender);

  const sending = session.send('Hi');
  session.reset();
  assert.equal(calls[0].signal.aborted, true);
  calls[0].resolve('late');
  await sending;
  assert.equal(session.state.messages.length, 0);
});

test('CANCELLED has calm copy (used only if ever surfaced)', () => {
  assert.equal(describeAiError('CANCELLED').title, 'Stopped');
});

// ---- Clients -----------------------------------------------------------------------

test('backend client: Stop aborts the fetch and reports CANCELLED (not TIMEOUT or NETWORK_ERROR)', async () => {
  const seen: { signal?: AbortSignal; aborted?: boolean }[] = [];
  const client = new AiBackendClient({ baseUrl: '', isOnline: () => true, fetch: hangingFetch(seen) });
  const cancel = new AbortController();

  const pending = codeOf(client.chat({ provider: 'openai', history: [], message: 'Hi', context: null }, 'cred', cancel.signal));
  await new Promise((r) => setTimeout(r, 5));
  cancel.abort();

  assert.equal(await pending, 'CANCELLED');
  assert.equal(seen[0].aborted, true);
});

test('backend client: an already-stopped request is never sent', async () => {
  let called = false;
  const client = new AiBackendClient({ baseUrl: '', isOnline: () => true, fetch: (async () => ((called = true), json(200, {}))) as unknown as typeof fetch });
  const cancel = new AbortController();
  cancel.abort();

  assert.equal(await codeOf(client.extract({ provider: 'openai', task: 'salary_document', blocks: [] }, 'c', cancel.signal)), 'CANCELLED');
  assert.equal(called, false);
});

test('backend client: timeouts are still reported as TIMEOUT when a cancel signal is passed', async () => {
  const seen: { signal?: AbortSignal; aborted?: boolean }[] = [];
  const client = new AiBackendClient({ baseUrl: '', isOnline: () => true, fetch: hangingFetch(seen), timeoutMs: 20 });
  // Node doesn't keep the process alive for AbortSignal.timeout alone (browsers don't need this).
  const keepAlive = setTimeout(() => {}, 1000);

  assert.equal(await codeOf(client.chat({ provider: 'openai', history: [], message: 'Hi', context: null }, 'c', new AbortController().signal)), 'TIMEOUT');
  clearTimeout(keepAlive);
});

test('ollama client: Stop closes the /api/chat request (Ollama stops when the client disconnects)', async () => {
  const seen: { signal?: AbortSignal; aborted?: boolean }[] = [];
  const client = new OllamaClient({ fetch: hangingFetch(seen) });
  const cancel = new AbortController();

  const pending = codeOf(
    client.chat({ baseUrl: 'http://localhost:11434', model: 'llama3.2', system: 's', turns: [{ role: 'user', content: 'x' }], maxTokens: 5, cancel: cancel.signal }),
  );
  await new Promise((r) => setTimeout(r, 5));
  cancel.abort();

  assert.equal(await pending, 'CANCELLED');
  assert.equal(seen[0].aborted, true);
});

test('requestSignal: aborts on cancel or timeout', async () => {
  const cancel = new AbortController();
  const signal = requestSignal(10_000, cancel.signal);
  assert.equal(signal.aborted, false);
  cancel.abort();
  assert.equal(signal.aborted, true);

  const timed = requestSignal(10);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(timed.aborted, true);
});

// ---- Manager: cancellation reaches the active provider -------------------------------

test('manager: Stop reaches Ollama and the cloud backend alike; a cancelled request never marks a key as failed', async () => {
  const seen: { signal?: AbortSignal; aborted?: boolean }[] = [];
  const hanging = hangingFetch(seen);
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (url.endsWith('/connect')) {
      return json(200, { success: true, provider: 'openai', credential: 'sealed', keyHint: 'h', verified: true });
    }
    if (url.endsWith('/api/tags')) return json(200, { models: [{ name: 'llama3.2:latest' }] });
    return hanging(url, init);
  }) as unknown as typeof fetch;

  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const manager = new AiConnectionManager(
    new AiConnectionStorage(storage),
    new AiBackendClient({ baseUrl: '', isOnline: () => true, fetch: fetchImpl }),
    () => {},
    () => new Date(),
    new OllamaClient({ fetch: fetchImpl }),
  );
  await manager.saveKey('openai', 'sk-test-key-00000000000000');
  await manager.saveOllama('http://localhost:11434', 'llama3.2:latest');

  for (const provider of ['openai', 'ollama'] as const) {
    manager.setActiveProvider(provider);
    const cancel = new AbortController();
    const pending = codeOf(manager.chat([], 'Hi', null, [], cancel.signal));
    await new Promise((r) => setTimeout(r, 5));
    cancel.abort();
    assert.equal(await pending, 'CANCELLED', provider);
    assert.equal(manager.state.providers[provider]?.status, 'connected', `${provider} still connected`);
  }

  assert.ok(seen.every((s) => s.aborted));
});
