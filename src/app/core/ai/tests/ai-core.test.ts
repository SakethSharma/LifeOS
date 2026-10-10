/**
 * Framework-free tests for the app side of LifeOS AI.
 * Run with: npm run test:ai
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AI_CREDENTIAL_HEADER, AI_ERROR_CODES, maskApiKey } from '../ai-contract';
import { AiRequestError, describeAiError } from '../ai-errors';
import { AiBackendClient } from '../ai-backend-client';
import {
  AI_CONNECTIONS_STORAGE_KEY,
  AiConnectionStorage,
  LEGACY_AI_CONNECTION_STORAGE_KEY,
} from '../ai-connection-storage';
import { AiChatSession } from '../ai-chat-session';
import { buildFinancialContext } from '../financial-context.builder';
import { AI_PROVIDERS } from '../ai-provider-guides';
import { clampStep, stepAfterSwipe } from '../../../features/info/components/ai-setup-carousel/carousel-navigation';
import type { Transaction } from '../../models/transaction.model';

// ---- helpers -----------------------------------------------------------------

type FetchCall = { url: string; init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeClient(respond: (call: FetchCall) => Response | Promise<Response>, online = () => true) {
  const calls: FetchCall[] = [];
  const client = new AiBackendClient({
    baseUrl: '',
    isOnline: online,
    fetch: (async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    }) as unknown as typeof fetch,
  });
  return { client, calls };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (err) {
    assert.ok(err instanceof AiRequestError, 'client must only throw AiRequestError');
    return err.code;
  }
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

function tx(partial: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'category' | 'date'>): Transaction {
  return {
    id: `id-${Math.random()}`,
    description: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

// ---- API key masking -----------------------------------------------------------

test('maskApiKey shows only a known prefix and the last 4 characters', () => {
  const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234';
  const masked = maskApiKey(key);

  assert.equal(masked, 'sk-proj-••••••••1234');
  assert.ok(!masked.includes('abcdefgh'));
  assert.equal(maskApiKey('sk-ant-api03-SECRETSECRETSECRET9876'), 'sk-ant-••••••••9876');
  assert.equal(maskApiKey('short'), '••••••••', 'short input reveals nothing');
});

// ---- Error catalog -------------------------------------------------------------

test('every error code has friendly copy and an action', () => {
  for (const code of AI_ERROR_CODES) {
    const view = describeAiError(code);
    assert.ok(view.title && view.message && view.actionLabel, code);
    assert.ok(!/http|status|stack|undefined/i.test(view.message), `${code} message must be user-friendly`);
  }

  assert.equal(describeAiError('NOT_CONFIGURED').action, 'connect');
  assert.equal(describeAiError('INVALID_KEY').action, 'check-key');
  assert.equal(describeAiError('OFFLINE').action, 'retry');
  assert.equal(describeAiError('TIMEOUT').message, 'The AI request took too long. Please try again.');
});

// ---- Backend client ------------------------------------------------------------

test('client: offline is detected before any request is made', async () => {
  const { client, calls } = makeClient(() => jsonResponse(200, {}), () => false);

  assert.equal(await codeOf(client.chat({ provider: 'openai', history: [], message: 'hi', context: null }, 'cred')), 'OFFLINE');
  assert.equal(calls.length, 0);
});

test('client: connection dropping mid-request maps to OFFLINE, otherwise NETWORK_ERROR', async () => {
  let online = true;
  const failing = makeClient(() => {
    online = false;
    throw new TypeError('Failed to fetch');
  }, () => online);
  assert.equal(await codeOf(failing.client.test('openai', 'cred')), 'OFFLINE');

  const network = makeClient(() => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(await codeOf(network.client.test('openai', 'cred')), 'NETWORK_ERROR');
});

test('client: timeout maps to TIMEOUT', async () => {
  const { client } = makeClient(() => {
    throw new DOMException('The operation timed out.', 'TimeoutError');
  });
  assert.equal(await codeOf(client.test('openai', 'cred')), 'TIMEOUT');
});

test('client: backend error codes pass through; unknown codes become UNKNOWN_ERROR', async () => {
  for (const [status, code] of [
    [401, 'INVALID_KEY'],
    [502, 'PROVIDER_ERROR'],
    [502, 'EMPTY_RESPONSE'],
    [502, 'RATE_LIMITED'],
  ] as const) {
    const { client } = makeClient(() => jsonResponse(status, { success: false, errorCode: code }));
    assert.equal(await codeOf(client.chat({ provider: 'openai', history: [], message: 'x', context: null }, 'c')), code);
  }

  const { client } = makeClient(() => jsonResponse(500, { success: false, errorCode: 'SOMETHING_NEW', detail: 'raw' }));
  assert.equal(await codeOf(client.test('openai', 'c')), 'UNKNOWN_ERROR');
});

test('client: non-backend responses (SPA fallback, gateway errors) are classified safely', async () => {
  const spa = makeClient(() => new Response('<!doctype html><html></html>', { status: 200 }));
  assert.equal(await codeOf(spa.client.test('openai', 'c')), 'BACKEND_NOT_RUNNING');

  const gateway = makeClient(() => new Response('Bad gateway', { status: 504 }));
  assert.equal(await codeOf(gateway.client.test('openai', 'c')), 'TIMEOUT');

  const crash = makeClient(() => new Response('oops', { status: 500 }));
  assert.equal(await codeOf(crash.client.test('openai', 'c')), 'SERVER_ERROR');

  const noBackend = new AiBackendClient({ baseUrl: null, isOnline: () => true, fetch: fetch });
  assert.equal(await codeOf(noBackend.test('openai', 'c')), 'BACKEND_UNAVAILABLE');
});

test('client: a plain file server (no AI backend) is reported as "AI backend isn\'t running"', async () => {
  // Exactly what http-server answers to POST /api/ai/connect: 405 with an empty body.
  const staticServer405 = makeClient(() => new Response(null, { status: 405 }));
  assert.equal(await codeOf(staticServer405.client.connect({ provider: 'openai', apiKey: 'k' })), 'BACKEND_NOT_RUNNING');

  const staticServer404 = makeClient(() => new Response('Not found', { status: 404 }));
  assert.equal(await codeOf(staticServer404.client.test('openai', 'c')), 'BACKEND_NOT_RUNNING');

  const view = describeAiError('BACKEND_NOT_RUNNING');
  assert.equal(view.title, "AI backend isn't running");
  assert.match(view.message, /npm run serve:local/);
});

test('client: real backend errors are never mistaken for a missing backend', async () => {
  // The LifeOS backend's own 405 (wrong method) is JSON and keeps its meaning.
  const backend405 = makeClient(() => jsonResponse(405, { success: false, errorCode: 'INVALID_REQUEST' }));
  assert.equal(await codeOf(backend405.client.test('openai', 'c')), 'INVALID_REQUEST');

  const backend404 = makeClient(() => jsonResponse(404, { success: false, errorCode: 'INVALID_REQUEST' }));
  assert.equal(await codeOf(backend404.client.test('openai', 'c')), 'INVALID_REQUEST');

  const invalidKey = makeClient(() => jsonResponse(401, { success: false, errorCode: 'INVALID_KEY' }));
  assert.equal(await codeOf(invalidKey.client.connect({ provider: 'openai', apiKey: 'k' })), 'INVALID_KEY');

  const serverError = makeClient(() => jsonResponse(500, { success: false, errorCode: 'SERVER_ERROR' }));
  assert.equal(await codeOf(serverError.client.test('openai', 'c')), 'SERVER_ERROR');

  const unexpected403 = makeClient(() => new Response('Forbidden', { status: 403 }));
  assert.equal(await codeOf(unexpected403.client.test('openai', 'c')), 'UNKNOWN_ERROR', 'other statuses are not relabelled');
});

test('client: successful chat returns the message; credential travels only in the header', async () => {
  const { client, calls } = makeClient(() => jsonResponse(200, { success: true, provider: 'openai', message: 'You spent most on Food.' }));

  const reply = await client.chat(
    { provider: 'openai', history: [], message: 'Where did I spend most?', context: { a: 1 } },
    'SEALED-CREDENTIAL',
  );

  assert.equal(reply, 'You spent most on Food.');
  assert.equal(calls[0].url, '/api/ai/chat');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers[AI_CREDENTIAL_HEADER], 'SEALED-CREDENTIAL');
  assert.ok(!String(calls[0].init.body).includes('SEALED-CREDENTIAL'), 'credential must not be in the body');
});

test('client: connect is the only call that carries the raw key, and has no credential header', async () => {
  const { client, calls } = makeClient(() =>
    jsonResponse(200, { success: true, provider: 'openai', credential: 'v1.a.b', keyHint: 'sk-••••••••1234' }),
  );

  const result = await client.connect({ provider: 'openai', apiKey: 'sk-test-key-1234' });

  assert.equal(result.credential, 'v1.a.b');
  assert.equal(calls[0].url, '/api/ai/connect');
  assert.equal((calls[0].init.headers as Record<string, string>)[AI_CREDENTIAL_HEADER], undefined);
});

// ---- Connection storage ----------------------------------------------------------

test('storage: keeps one sealed credential per provider, never a raw key', () => {
  const mem = memoryStorage();
  const storage = new AiConnectionStorage(mem);

  storage.save({
    active: 'gemini',
    providers: {
      openai: { credential: 'v1.o.o', keyHint: 'sk-••••••••1111', savedAt: 't', status: 'connected' },
      gemini: { credential: 'v1.g.g', keyHint: 'AIza••••••••2222', savedAt: 't', status: 'not_tested' },
    },
  });

  const raw = mem.map.get(AI_CONNECTIONS_STORAGE_KEY) ?? '';
  assert.ok(!/apiKey/i.test(raw), 'no raw key field is persisted');

  const loaded = storage.load();
  assert.equal(loaded.active, 'gemini');
  assert.equal(loaded.providers.openai?.credential, 'v1.o.o');
  assert.equal(loaded.providers.gemini?.status, 'not_tested');

  storage.clear();
  assert.deepEqual(storage.load(), { active: null, providers: {} });
});

test('storage: migrates the old single-provider connection as connected and active', () => {
  const mem = memoryStorage();
  mem.map.set(
    LEGACY_AI_CONNECTION_STORAGE_KEY,
    JSON.stringify({ provider: 'anthropic', credential: 'v1.a.a', keyHint: 'sk-ant-••••••••9876', connectedAt: 'then' }),
  );

  const loaded = new AiConnectionStorage(mem).load();

  assert.equal(loaded.active, 'anthropic');
  assert.equal(loaded.providers.anthropic?.status, 'connected');
  assert.equal(mem.map.has(LEGACY_AI_CONNECTION_STORAGE_KEY), false, 'old entry removed after migrating');
  assert.ok(mem.map.has(AI_CONNECTIONS_STORAGE_KEY));
});

test('storage: corrupt, unknown, or unavailable storage degrades to "nothing configured"', () => {
  const mem = memoryStorage();
  mem.map.set(AI_CONNECTIONS_STORAGE_KEY, '{not json');
  assert.deepEqual(new AiConnectionStorage(mem).load(), { active: null, providers: {} });

  mem.map.set(
    AI_CONNECTIONS_STORAGE_KEY,
    JSON.stringify({
      active: 'someone-else',
      providers: { 'someone-else': { credential: 'x' }, openai: { credential: '' }, gemini: { credential: 'v1.g', status: 'weird' } },
    }),
  );
  const loaded = new AiConnectionStorage(mem).load();
  assert.equal(loaded.active, null, 'unknown active provider ignored');
  assert.deepEqual(Object.keys(loaded.providers), ['gemini'], 'unknown providers and empty credentials dropped');
  assert.equal(loaded.providers.gemini?.status, 'not_tested', 'unknown status is not trusted as connected');

  const nothing = new AiConnectionStorage(null);
  assert.deepEqual(nothing.load(), { active: null, providers: {} });
  assert.equal(nothing.save({ active: null, providers: {} }), false);
});

// ---- Chat session ----------------------------------------------------------------

test('chat: empty and whitespace-only messages are not sent', async () => {
  let sent = 0;
  const session = new AiChatSession(async () => {
    sent++;
    return 'reply';
  });

  assert.equal(await session.send('   '), false);
  assert.equal(sent, 0);
  assert.equal(session.state.messages.length, 0);
});

test('chat: a second send while one is in flight is refused (no duplicate submissions)', async () => {
  let release!: (v: string) => void;
  let sent = 0;
  const session = new AiChatSession(() => {
    sent++;
    return new Promise<string>((resolve) => (release = resolve));
  });

  const first = session.send('First question');
  assert.equal(session.state.pending, true);
  assert.equal(await session.send('Second question'), false);

  release('Answer');
  await first;

  assert.equal(sent, 1);
  assert.deepEqual(
    session.state.messages.map((m) => [m.role, m.content]),
    [
      ['user', 'First question'],
      ['assistant', 'Answer'],
    ],
  );
});

test('chat: successful reply is recorded with roles and timestamps; history is sent on the next turn', async () => {
  const histories: unknown[] = [];
  const session = new AiChatSession(async (history, message) => {
    histories.push(history);
    return `Reply to ${message}`;
  });

  await session.send('One');
  await session.send('Two');

  assert.equal(session.state.messages.length, 4);
  assert.ok(session.state.messages.every((m) => !Number.isNaN(Date.parse(m.timestamp))));
  assert.deepEqual(histories[1], [
    { role: 'user', content: 'One' },
    { role: 'assistant', content: 'Reply to One' },
  ]);
});

test('chat: failure shows an error code; Try Again resends without duplicating the question', async () => {
  let online = false;
  const session = new AiChatSession(async () => {
    if (!online) throw new AiRequestError('OFFLINE');
    return 'Now it works';
  });

  await session.send('Where did I spend the most?');
  assert.equal(session.state.error, 'OFFLINE');
  assert.equal(session.state.unansweredPrompt, 'Where did I spend the most?');

  online = true; // internet comes back
  assert.equal(await session.retry(), true);

  assert.equal(session.state.error, null);
  assert.deepEqual(
    session.state.messages.map((m) => m.role),
    ['user', 'assistant'],
  );
});

test('chat: empty AI reply becomes EMPTY_RESPONSE; unexpected errors become UNKNOWN_ERROR', async () => {
  const empty = new AiChatSession(async () => '   ');
  await empty.send('Hi');
  assert.equal(empty.state.error, 'EMPTY_RESPONSE');

  const weird = new AiChatSession(async () => {
    throw new Error('boom: stack trace details');
  });
  await weird.send('Hi');
  assert.equal(weird.state.error, 'UNKNOWN_ERROR');
});

test('chat: not connected keeps the question and reports NOT_CONFIGURED without calling AI', async () => {
  let sent = 0;
  const session = new AiChatSession(async () => {
    sent++;
    return 'x';
  });

  session.rejectWith('Where did I spend the most money?', 'NOT_CONFIGURED');
  session.rejectWith('Where did I spend the most money?', 'NOT_CONFIGURED');

  assert.equal(sent, 0);
  assert.equal(session.state.error, 'NOT_CONFIGURED');
  assert.equal(session.state.messages.length, 1, 'repeated attempts do not duplicate the question');
});

test('chat: reset clears the conversation and drops a reply that arrives afterwards', async () => {
  let release!: (v: string) => void;
  const session = new AiChatSession(() => new Promise<string>((resolve) => (release = resolve)));

  const pending = session.send('Question');
  session.reset();
  release('Late answer');
  await pending;

  assert.deepEqual(session.state, { messages: [], pending: false, error: null, unansweredPrompt: null });
});

// ---- Financial context -------------------------------------------------------------

test('context: uses real LifeOS totals and never includes free-text or payment fields', () => {
  const now = new Date(2026, 8, 20); // 20 Sep 2026
  const transactions = [
    tx({ type: 'income', amount: 100000, category: 'Salary', date: '2026-09-01', description: 'ACME Corp payroll' }),
    tx({ type: 'expense', amount: 30000, category: 'Housing', date: '2026-09-02', description: 'Rent to Mr Sharma' }),
    tx({
      type: 'expense',
      amount: 5000,
      category: 'Food',
      date: '2026-09-05',
      paymentMethod: 'UPI',
      notes: 'upi id someone@okbank, card 4111 1111 1111 1111',
      description: 'Dinner',
    }),
    tx({ type: 'income', amount: 98000, category: 'Salary', date: '2026-08-01' }),
    tx({ type: 'expense', amount: 55000, category: 'Shopping', date: '2026-08-10' }),
  ];

  const context = buildFinancialContext({ transactions, currencyCode: 'INR', currencySymbol: '₹', now });
  const current = context['currentMonth'] as Record<string, unknown>;
  const previous = context['previousMonth'] as Record<string, unknown>;

  assert.equal(current['income'], 100000);
  assert.equal(current['expenses'], 35000);
  assert.equal(current['savings'], 65000);
  assert.equal(previous['expenses'], 55000);
  assert.equal(previous['savings'], 43000);
  assert.deepEqual((current['topExpenseCategories'] as { category: string }[]).map((c) => c.category), ['Housing', 'Food']);

  const serialized = JSON.stringify(context);
  for (const secret of ['ACME', 'Sharma', 'Dinner', 'UPI', 'okbank', '4111', 'id-']) {
    assert.ok(!serialized.includes(secret), `context must not contain "${secret}"`);
  }
  assert.equal((context['salaryTax'] as { available: boolean }).available, false);
});

test('context: no transactions says so instead of inventing numbers; tax facts pass through unchanged', () => {
  const context = buildFinancialContext({
    transactions: [],
    currencyCode: 'INR',
    currencySymbol: '₹',
    now: new Date(2026, 8, 20),
    salaryTax: {
      taxYear: 'FY 2025-26',
      regime: 'new',
      annualCtc: 1200000,
      grossAnnualSalary: 1150000,
      standardDeduction: 75000,
      totalOtherDeductions: 0,
      taxableIncome: 1075000,
      annualIncomeTax: 0,
      monthlyIncomeTax: 0,
      employeePfAnnual: 50000,
      monthlyTakeHome: 91666.67,
      annualTakeHome: 1100000,
    },
  });

  assert.ok(String(context['dataNote']).includes('not recorded'));
  assert.equal(context['currentMonth'], undefined);
  assert.equal((context['salaryTax'] as { annualTakeHome: number }).annualTakeHome, 1100000);
});

// ---- Setup guide / carousel ------------------------------------------------------------

test('guides: each provider has 4–6 steps, official https links, and no real-looking keys', () => {
  const officialHosts = ['platform.openai.com', 'aistudio.google.com', 'platform.claude.com'];

  for (const provider of AI_PROVIDERS) {
    assert.ok(provider.steps.length >= 4 && provider.steps.length <= 6, provider.id);

    for (const step of provider.steps) {
      assert.ok(step.title && step.body, 'every step has text for when images are unavailable');
      if (step.link) {
        const url = new URL(step.link.url);
        assert.equal(url.protocol, 'https:');
        assert.ok(officialHosts.includes(url.hostname), `${url.hostname} is an official host`);
      }
      if (step.illustrationText?.startsWith('sk-')) {
        assert.ok(step.illustrationText.includes('•'), 'example keys are redacted');
      }
    }
  }

  const openAiFirst = AI_PROVIDERS.find((p) => p.id === 'openai')!.steps[0].body;
  assert.match(openAiFirst, /not ChatGPT/, 'distinguishes ChatGPT from the API platform');
});

test('carousel: navigation stays in bounds and swipes need a clear horizontal gesture', () => {
  assert.equal(clampStep(-1, 6), 0);
  assert.equal(clampStep(9, 6), 5);
  assert.equal(stepAfterSwipe(0, 6, -80, 5), 1, 'swipe left → next');
  assert.equal(stepAfterSwipe(1, 6, 80, 5), 0, 'swipe right → previous');
  assert.equal(stepAfterSwipe(1, 6, -20, 0), 1, 'too short');
  assert.equal(stepAfterSwipe(1, 6, -60, 120), 1, 'mostly vertical = page scroll');
  assert.equal(stepAfterSwipe(5, 6, -80, 0), 5, 'no past the last step');
});

// ---- Chat attachments --------------------------------------------------------------

import {
  CHAT_ATTACHMENT_RULES,
  classifyAttachment,
  matchesSignature,
  validateNewAttachments,
} from '../chat-attachments';

test('attachments: supported images and PDFs pass; type is recognised by extension when the browser gives none', () => {
  const { accepted, errors } = validateNewAttachments([], [
    { name: 'payslip.pdf', size: 120_000, type: 'application/pdf' },
    { name: 'receipt.jpg', size: 300_000, type: 'image/jpeg' },
  ]);

  assert.equal(errors.length, 0);
  assert.deepEqual(accepted.map((a) => a.kind), ['pdf', 'image']);
  assert.equal(classifyAttachment({ name: 'Scan.PNG', size: 1, type: '' })?.mediaType, 'image/png');
});

test('attachments: every rejected file gets a friendly message (nothing silently dropped)', () => {
  const max = CHAT_ATTACHMENT_RULES.maxFileBytes;
  const { accepted, errors } = validateNewAttachments([], [
    { name: 'notes.docx', size: 1000, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { name: 'empty.pdf', size: 0, type: 'application/pdf' },
    { name: 'huge.pdf', size: max + 1, type: 'application/pdf' },
    { name: 'fake.png', size: 10, type: 'text/plain' },
  ]);

  assert.equal(accepted.length, 0);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /not supported/);
  assert.match(errors[1], /empty/);
  assert.match(errors[2], /too large/);
  assert.ok(errors.every((e) => !/undefined|null|Error/.test(e)));
});

test('attachments: per-message file count and total size limits apply across picks', () => {
  const max = CHAT_ATTACHMENT_RULES.maxFiles;
  const already = Array.from({ length: max - 1 }, () => 1000);
  const tooMany = validateNewAttachments(already, [
    { name: 'a.png', size: 1000, type: 'image/png' },
    { name: 'b.png', size: 1000, type: 'image/png' },
  ]);
  assert.equal(tooMany.accepted.length, 1);
  assert.match(tooMany.errors[0], new RegExp(`up to ${max} files`));

  const total = validateNewAttachments([CHAT_ATTACHMENT_RULES.maxTotalBytes - 10], [
    { name: 'big.png', size: 1000, type: 'image/png' },
  ]);
  assert.equal(total.accepted.length, 0);
  assert.match(total.errors[0], /too large/);
});

test('attachments: content must really be the claimed type (renamed/corrupt files are unreadable)', () => {
  assert.equal(matchesSignature('JVBERi0xLjcK', 'application/pdf'), true);
  assert.equal(matchesSignature('iVBORw0KGgoAAA', 'image/png'), true);
  assert.equal(matchesSignature('SGVsbG8gd29ybGQ=', 'application/pdf'), false, 'text renamed to .pdf');
  assert.equal(matchesSignature('', 'image/png'), false);
});

test('chat: attachments are sent with their message, kept for Try Again, and only named in later history', async () => {
  const calls: { history: unknown; message: string; blocks: unknown[] }[] = [];
  let fail = true;
  const session = new AiChatSession(async (history, message, blocks) => {
    calls.push({ history, message, blocks });
    if (fail) throw new AiRequestError('TIMEOUT');
    return 'Your payslip shows a basic salary.';
  });

  const file = { name: 'payslip.pdf', kind: 'pdf' as const, block: { type: 'document' as const, mediaType: 'application/pdf', base64Data: 'JVBER' } };

  assert.equal(session.canSend('', 1), true, 'files alone can be sent');
  await session.send('', [file]);
  assert.equal(calls[0].blocks.length, 1);
  assert.ok(calls[0].message.length > 0, 'a default prompt is used when only files are sent');
  assert.deepEqual(session.state.messages[0].attachments, [{ name: 'payslip.pdf', kind: 'pdf' }]);
  assert.ok(!JSON.stringify(session.state).includes('JVBER'), 'file data is not kept in visible state');

  fail = false;
  await session.retry();
  assert.equal(calls[1].blocks.length, 1, 'Try Again resends the file');

  await session.send('And the HRA?');
  assert.equal(calls[2].blocks.length, 0, 'files are not resent with later turns');
  assert.match(JSON.stringify(calls[2].history), /Attached earlier: payslip\.pdf/);
});

// ---- Multi-provider connections ---------------------------------------------------

import { AiConnectionManager } from '../ai-connection-manager';
import { AI_PROVIDER_CAPABILITIES, isBillingError, unsupportedAttachmentKinds } from '../ai-contract';
import { getBillingUrl, getProviderInfo } from '../ai-provider-guides';

type BackendCall = { path: string; body: Record<string, unknown>; credential: string | undefined };

/**
 * A manager wired to a fake LifeOS backend. `respond` decides each answer;
 * by default connect succeeds and returns a credential tagged with its provider.
 */
function makeManager(respond?: (call: BackendCall) => Response | undefined, mem = memoryStorage()) {
  const calls: BackendCall[] = [];
  const client = new AiBackendClient({
    baseUrl: '',
    isOnline: () => true,
    fetch: (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const call = {
        path: url.replace('/api/ai/', ''),
        body: JSON.parse(String(init.body)),
        credential: headers[AI_CREDENTIAL_HEADER],
      };
      calls.push(call);
      const custom = respond?.(call);
      if (custom) return custom;
      const provider = call.body['provider'];
      if (call.path === 'connect') {
        return jsonResponse(200, { success: true, provider, credential: `sealed-for-${provider}`, keyHint: 'xx••••••••1234', verified: true });
      }
      return jsonResponse(200, { success: true, provider, message: `reply from ${provider}` });
    }) as unknown as typeof fetch,
  });
  const manager = new AiConnectionManager(new AiConnectionStorage(mem), client);
  return { manager, calls, mem };
}

test('providers: each provider is configured independently; adding one never replaces another', async () => {
  const { manager } = makeManager();

  assert.equal((await manager.saveKey('openai', 'sk-openai-key-000000000000')).errorCode, null);
  assert.equal((await manager.saveKey('gemini', 'AIzaGeminiKey0000000000000')).errorCode, null);
  assert.equal((await manager.saveKey('anthropic', 'sk-ant-key-00000000000000')).errorCode, null);

  const state = manager.state;
  assert.deepEqual(Object.keys(state.providers).sort(), ['anthropic', 'gemini', 'openai']);
  assert.equal(state.active, 'openai', 'the first provider became active; later ones did not switch it silently');
  assert.ok(!JSON.stringify(state).includes('sealed-for'), 'the state shown to the UI has no credentials');
});

test('providers: switching changes which provider — and whose credential — is used for each request', async () => {
  const { manager, calls } = makeManager();
  await manager.saveKey('openai', 'sk-openai-key-000000000000');
  await manager.saveKey('gemini', 'AIzaGeminiKey0000000000000');

  const first = await manager.chat([], 'Hi', null);
  assert.equal(first.provider, 'openai');

  assert.equal(manager.setActiveProvider('gemini'), true);
  const second = await manager.chat([], 'Hi again', null);
  assert.equal(second.provider, 'gemini');
  assert.equal(second.text, 'reply from gemini');

  const chats = calls.filter((c) => c.path === 'chat');
  assert.deepEqual(chats.map((c) => [c.body['provider'], c.credential]), [
    ['openai', 'sealed-for-openai'],
    ['gemini', 'sealed-for-gemini'],
  ]);

  await manager.extract('salary_document', [{ type: 'text', text: 'Basic 50000' }]);
  const extract = calls.find((c) => c.path === 'extract')!;
  assert.deepEqual([extract.body['provider'], extract.credential], ['gemini', 'sealed-for-gemini']);
});

test('providers: unconfigured provider — no request is sent and it cannot be selected', async () => {
  const { manager, calls } = makeManager();

  await assert.rejects(manager.chat([], 'Hi', null), (e: unknown) => e instanceof AiRequestError && e.code === 'NOT_CONFIGURED');
  assert.equal(manager.setActiveProvider('anthropic'), false);
  assert.equal(await manager.testProvider('gemini'), 'NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});

test('providers: a rejected key is never saved, and a failed update keeps the existing key', async () => {
  let reject = false;
  const { manager } = makeManager((c) =>
    reject && c.path === 'connect' ? jsonResponse(401, { success: false, errorCode: 'INVALID_KEY' }) : undefined,
  );

  await manager.saveKey('openai', 'sk-good-key-0000000000000');
  reject = true;
  const result = await manager.saveKey('openai', 'sk-bad-key-00000000000000');
  assert.equal(result.errorCode, 'INVALID_KEY');
  assert.equal(manager.state.providers.openai?.status, 'connected', 'the working key is still there');

  const fresh = await manager.saveKey('anthropic', 'sk-ant-bad-0000000000000');
  assert.equal(fresh.errorCode, 'INVALID_KEY');
  assert.equal(manager.state.providers.anthropic, undefined);
});

test('providers: a key that stops working is marked failed and blocked; other providers stay usable', async () => {
  let geminiRejects = false;
  const { manager, calls } = makeManager((c) =>
    geminiRejects && c.body['provider'] === 'gemini' && c.path !== 'connect'
      ? jsonResponse(401, { success: false, errorCode: 'INVALID_KEY' })
      : undefined,
  );
  await manager.saveKey('gemini', 'AIzaGeminiKey0000000000000');
  await manager.saveKey('openai', 'sk-openai-key-000000000000');

  geminiRejects = true;
  await assert.rejects(manager.chat([], 'Hi', null));
  assert.equal(manager.state.providers.gemini?.status, 'failed');
  assert.deepEqual(manager.usableProviders(), ['openai']);

  const before = calls.length;
  await assert.rejects(manager.chat([], 'Hi', null), (e: unknown) => e instanceof AiRequestError && e.code === 'INVALID_KEY');
  assert.equal(calls.length, before, 'no request is sent with a key known to be rejected');
  assert.equal(manager.setActiveProvider('gemini'), false);
  assert.equal(manager.setActiveProvider('openai'), true);
});

test('providers: an unverified save shows "Not tested" until a real call succeeds', async () => {
  const { manager } = makeManager((c) =>
    c.path === 'connect'
      ? jsonResponse(200, { success: true, provider: 'gemini', credential: 'sealed-for-gemini', keyHint: 'AIza••••••••1234', verified: false, verifyErrorCode: 'TIMEOUT' })
      : undefined,
  );

  const saved = await manager.saveKey('gemini', 'AIzaGeminiKey0000000000000');
  assert.deepEqual(saved, { errorCode: null, verified: false });
  assert.equal(manager.state.providers.gemini?.status, 'not_tested');
  assert.equal(manager.state.providers.gemini?.lastErrorCode, 'TIMEOUT');

  assert.equal(await manager.testProvider('gemini'), null);
  assert.equal(manager.state.providers.gemini?.status, 'connected');
});

test('providers: a failed request is never retried through another provider', async () => {
  const { manager, calls } = makeManager((c) =>
    c.path === 'chat' ? jsonResponse(402, { success: false, errorCode: 'QUOTA_EXCEEDED' }) : undefined,
  );
  await manager.saveKey('openai', 'sk-openai-key-000000000000');
  await manager.saveKey('anthropic', 'sk-ant-key-00000000000000');

  await assert.rejects(manager.chat([], 'Hi', null), (e: unknown) => e instanceof AiRequestError && e.code === 'QUOTA_EXCEEDED');

  const chats = calls.filter((c) => c.path === 'chat');
  assert.equal(chats.length, 1);
  assert.equal(chats[0].body['provider'], 'openai');
  assert.equal(manager.state.active, 'openai', 'still on the provider the user chose');
  assert.equal(manager.state.providers.openai?.status, 'connected', 'a billing problem does not mark the key as failed');
});

test('providers: removing one keeps the others; removing the active one selects another ready provider', async () => {
  const { manager, mem } = makeManager();
  await manager.saveKey('openai', 'sk-openai-key-000000000000');
  await manager.saveKey('gemini', 'AIzaGeminiKey0000000000000');

  manager.removeProvider('openai');
  assert.equal(manager.state.active, 'gemini');
  assert.deepEqual(Object.keys(manager.state.providers), ['gemini']);
  assert.ok(!(mem.map.get(AI_CONNECTIONS_STORAGE_KEY) ?? '').includes('sealed-for-openai'), 'removed from storage');

  manager.removeProvider('gemini');
  assert.equal(manager.state.active, null);
});

test('providers: connections persist per provider across app restarts', async () => {
  const mem = memoryStorage();
  const first = makeManager(undefined, mem);
  await first.manager.saveKey('openai', 'sk-openai-key-000000000000');
  await first.manager.saveKey('gemini', 'AIzaGeminiKey0000000000000');
  first.manager.setActiveProvider('gemini');

  const restarted = makeManager(undefined, mem);
  assert.equal(restarted.manager.state.active, 'gemini');
  assert.deepEqual(Object.keys(restarted.manager.state.providers).sort(), ['gemini', 'openai']);
});

// ---- Billing links & error guidance -------------------------------------------------

test('billing: each provider maps to its official billing page; nothing else can be opened', () => {
  assert.equal(getBillingUrl('openai'), 'https://platform.openai.com/settings/organization/billing/overview');
  assert.equal(getBillingUrl('gemini'), 'https://aistudio.google.com/billing');
  assert.equal(getBillingUrl('anthropic'), 'https://platform.claude.com/settings/billing');
  assert.equal(getBillingUrl('evil' as never), null);
  assert.equal(getBillingUrl('constructor' as never), null);
});

test('billing: credit / billing / usage-limit errors offer Open Usage Credits, Try Again and Switch Provider', () => {
  for (const code of ['QUOTA_EXCEEDED', 'BILLING_NOT_CONFIGURED', 'USAGE_LIMIT'] as const) {
    const view = describeAiError(code);
    assert.ok(isBillingError(code));
    assert.equal(view.title, 'AI usage unavailable');
    assert.equal(view.action, 'billing');
    assert.equal(view.actionLabel, 'Open Usage Credits');
    assert.deepEqual(view.extraActions?.map((a) => a.action), ['retry', 'switch-provider']);
    assert.match(view.caption ?? '', /new tab/);
    assert.doesNotMatch(view.message, /balance is|remaining|\d/i, 'never claims to know the balance');
  }
  assert.match(describeAiError('QUOTA_EXCEEDED').message, /may have insufficient credits or a billing issue/);
  assert.match(describeAiError('USAGE_LIMIT').message, /There may be a billing or usage-limit issue/);
});

test('billing: rate limits, bad keys and permissions are not presented as credit problems', () => {
  for (const code of ['RATE_LIMITED', 'INVALID_KEY', 'PERMISSION_DENIED', 'PROVIDER_ERROR', 'TIMEOUT'] as const) {
    const view = describeAiError(code);
    assert.ok(!isBillingError(code), code);
    assert.notEqual(view.title, 'AI usage unavailable', code);
    assert.notEqual(view.action, 'billing', code);
  }
  assert.equal(describeAiError('RATE_LIMITED').title, 'Too many requests');
});

test('capabilities: attachments are checked against the selected provider', () => {
  const pdf = { type: 'document' as const, mediaType: 'application/pdf', base64Data: 'JVBER' };
  const png = { type: 'image' as const, mediaType: 'image/png', base64Data: 'iVBOR' };

  for (const id of ['openai', 'gemini', 'anthropic'] as const) {
    assert.deepEqual(unsupportedAttachmentKinds(id, [pdf, png]), [], `${id} reads images and PDFs`);
  }

  const imagesOnly = { ...AI_PROVIDER_CAPABILITIES, gemini: { attachments: ['image'] as const } };
  assert.deepEqual(unsupportedAttachmentKinds('gemini', [pdf, png], imagesOnly), ['pdf']);
});

test('labels: OpenAI is presented as the OpenAI API, never as a ChatGPT subscription', () => {
  assert.equal(getProviderInfo('openai').label, 'OpenAI API');
  assert.equal(getProviderInfo('gemini').label, 'Google Gemini API');
  assert.equal(getProviderInfo('anthropic').label, 'Anthropic Claude API');
  assert.equal(getProviderInfo('gemini').shortName, 'Google Gemini');
  assert.equal(maskApiKey('AIzaSyD-ExampleExampleExample1234'), 'AIza••••••••1234');
});

test('chat: replies record their provider; switch notices are shown but never sent to the AI', async () => {
  const histories: unknown[] = [];
  let provider = 'OpenAI API';
  const session = new AiChatSession(async (history) => {
    histories.push(history);
    return { text: `answer from ${provider}`, provider };
  });

  await session.send('First');
  provider = 'Google Gemini';
  session.addNotice('Switched to Google Gemini. Earlier messages in this chat are shared with Google Gemini as context.');
  await session.send('Second');

  assert.deepEqual(session.state.messages.map((m) => [m.role, m.provider ?? '']), [
    ['user', ''],
    ['assistant', 'OpenAI API'],
    ['notice', ''],
    ['user', ''],
    ['assistant', 'Google Gemini'],
  ]);
  assert.ok(!JSON.stringify(histories).includes('Switched to'), 'notices are not part of AI history');
  assert.deepEqual(histories[1], [
    { role: 'user', content: 'First' },
    { role: 'assistant', content: 'answer from OpenAI API' },
  ]);
});

// ---- Android app: backend address -------------------------------------------------

import { nativeBackendBaseUrl } from '../ai-backend.config';

test('android: backend address must be an https origin; empty or unsafe means "not linked" (BACKEND_UNAVAILABLE)', async () => {
  assert.equal(nativeBackendBaseUrl('https://my-lifeos.example'), 'https://my-lifeos.example');
  assert.equal(nativeBackendBaseUrl(' https://my-lifeos.example/ '), 'https://my-lifeos.example');
  assert.equal(nativeBackendBaseUrl(''), null);
  assert.equal(nativeBackendBaseUrl('http://192.168.1.10:8080'), null, 'credentials never over plain http');
  assert.equal(nativeBackendBaseUrl('http://localhost:8080'), null, 'localhost on a phone is the phone');
  assert.equal(nativeBackendBaseUrl('https://site.example/api'), null);
  assert.equal(nativeBackendBaseUrl('https://user:pw@site.example'), null);

  const unlinked = new AiBackendClient({ baseUrl: nativeBackendBaseUrl(''), isOnline: () => true, fetch: (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch });
  assert.equal(await codeOf(unlinked.test('gemini', 'c')), 'BACKEND_UNAVAILABLE');

  const urls: string[] = [];
  const linked = new AiBackendClient({
    baseUrl: nativeBackendBaseUrl('https://my-lifeos.example'),
    isOnline: () => true,
    fetch: (async (url: string) => (urls.push(url), jsonResponse(200, { success: true, provider: 'gemini' }))) as unknown as typeof fetch,
  });
  await linked.test('gemini', 'sealed');
  assert.deepEqual(urls, ['https://my-lifeos.example/api/ai/test']);
});
