/**
 * Framework-free tests for the app side of LifeOS AI.
 * Run with: npm run test:ai
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AI_CREDENTIAL_HEADER, AI_ERROR_CODES, maskApiKey } from '../ai-contract';
import { AiRequestError, describeAiError } from '../ai-errors';
import { AiBackendClient } from '../ai-backend-client';
import { AI_CONNECTION_STORAGE_KEY, AiConnectionStorage } from '../ai-connection-storage';
import { AiChatSession } from '../ai-chat-session';
import { buildFinancialContext } from '../financial-context.builder';
import { AI_PROVIDERS } from '../ai-provider-guides';
import { clampStep, stepAfterSwipe } from '../../../features/ai-insights/components/ai-setup-carousel/carousel-navigation';
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
  assert.equal(await codeOf(spa.client.test('openai', 'c')), 'BACKEND_UNAVAILABLE');

  const gateway = makeClient(() => new Response('Bad gateway', { status: 504 }));
  assert.equal(await codeOf(gateway.client.test('openai', 'c')), 'TIMEOUT');

  const crash = makeClient(() => new Response('oops', { status: 500 }));
  assert.equal(await codeOf(crash.client.test('openai', 'c')), 'SERVER_ERROR');

  const noBackend = new AiBackendClient({ baseUrl: null, isOnline: () => true, fetch: fetch });
  assert.equal(await codeOf(noBackend.test('openai', 'c')), 'BACKEND_UNAVAILABLE');
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

test('storage: saves only the sealed credential and masked hint; disconnect removes it', () => {
  const mem = memoryStorage();
  const storage = new AiConnectionStorage(mem);

  storage.save({ provider: 'anthropic', credential: 'v1.iv.ct', keyHint: 'sk-ant-••••••••9876', connectedAt: 'now' });
  const raw = mem.map.get(AI_CONNECTION_STORAGE_KEY) ?? '';
  assert.ok(!/apiKey/i.test(raw), 'no raw key field is persisted');
  assert.deepEqual(storage.load()?.provider, 'anthropic');

  storage.clear();
  assert.equal(storage.load(), null);
});

test('storage: corrupt or unavailable storage degrades to "not connected"', () => {
  const mem = memoryStorage();
  mem.map.set(AI_CONNECTION_STORAGE_KEY, '{not json');
  assert.equal(new AiConnectionStorage(mem).load(), null);

  mem.map.set(AI_CONNECTION_STORAGE_KEY, JSON.stringify({ provider: 'someone-else', credential: 'x', keyHint: '' }));
  assert.equal(new AiConnectionStorage(mem).load(), null);

  const nothing = new AiConnectionStorage(null);
  assert.equal(nothing.load(), null);
  assert.equal(nothing.save({ provider: 'openai', credential: 'c', keyHint: '', connectedAt: '' }), false);
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
  const officialHosts = ['platform.openai.com', 'console.anthropic.com'];

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
  assert.ok(openAiFirst.includes('not the ChatGPT'), 'distinguishes ChatGPT from the API platform');
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
