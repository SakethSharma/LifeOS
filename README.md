# LifeOS
LifeOS – Your all-in-one personal life management app to track finances, health, habits, tasks, and insights in one place.

## AI setup (bring your own key)

AI Insights and the salary document reader use the user's own API keys for the
**OpenAI API**, the **Google Gemini API**, and/or the **Anthropic Claude API**,
or **Ollama** running on the user's own computer (no key, no per-request
charges). LifeOS ships no shared key and never pays for AI usage. ChatGPT,
Claude, and Gemini app subscriptions are separate products and don't include
API access.

Users can connect several providers (each keeps its own key) and choose which
one answers. A failed request is never silently retried through another
provider.

### How it works

```
App (browser / Android)  ──HTTPS──▶  LifeOS AI backend (Netlify Functions)  ──▶  OpenAI / Gemini / Anthropic
                                     netlify/functions/ai-*.mts
```

- **Connect**: the user pastes a key in **Info → AI Insights → Connect AI to LifeOS**. The app
  sends it once to `/api/ai/connect`. The backend makes a real, free call to
  the provider (a model listing) to check it, then encrypts the key with
  AES-256-GCM using `AI_CREDENTIAL_SECRET` and returns that sealed token plus
  a masked hint (`sk-••••••••1234`).
- **Unverified saves**: if the provider check can't finish (timeout, provider
  down, rate limit), the key is still sealed and saved, but marked "Not
  tested". A key the provider rejects is never saved.
- **Storage**: the device keeps only the sealed tokens (one per provider, each
  bound to its provider) and the active provider choice, in `localStorage`
  (`lifeos.ai.connections.v2`; the old single-provider `…connection.v1` entry is
  migrated automatically). It's kept apart from app settings,
  so data exports never include it. The raw key isn't stored anywhere, logged,
  or sent back to the app.
- **Requests**: `/api/ai/chat`, `/api/ai/extract`, `/api/ai/test` and `/api/ai/models` take the
  sealed token in the `x-lifeos-ai-credential` header. The backend decrypts it
  in memory for that one provider call.
- **Trade-off**: browser storage is not a server-side vault. Someone with
  access to the device's browser profile could use the sealed token *through
  the LifeOS backend* (not directly with the provider) until the user taps
  **Disconnect AI** or you rotate `AI_CREDENTIAL_SECRET`. Rotating the secret
  signs everyone out of AI; they reconnect by pasting their key again.
- **What AI sees**: aggregated numbers LifeOS already calculated: monthly
  totals, category totals, the six-month trend, and the five largest recent
  expenses (date, category, amount). When the calculator has been run, it also
  gets the salary/tax result, plus any images/PDFs the user attaches to a chat
  message. Transaction descriptions, notes, payment
  methods and ids are never sent. The accuracy rules (use only LifeOS numbers,
  never compute tax/PF/EMI) live server-side in `netlify/ai/prompts.ts`.

### Models

Each cloud provider uses the server default below unless the user picks a
model under **Info → Connect AI to LifeOS → Choose Model**. The list comes from
the provider's own free model listing (`/api/ai/models`), filtered to
text-chat models. The choice is stored per provider (not sensitive) and sent
as `model` with each request. The backend accepts only plain ids
(`[A-Za-z0-9._:-]`), so a model id can't change a provider URL.

### Ollama (local AI)

Ollama runs on the user's computer, so the app calls it **directly from the
browser** (`/api/tags` for installed models, `/api/chat` with `stream:false`).
The LifeOS backend can't reach a user's computer and never sees Ollama
traffic. Only the server address and model name are stored.

1. Install Ollama from https://ollama.com/download and start it.
2. Download a model: `ollama pull llama3.2`
3. Check it: `ollama list`
4. In LifeOS: **Info → Ollama → Set Up Ollama**. Keep `http://localhost:11434`,
   tap **Test Connection**, choose the model, then **Save Settings**.

Browser limits, which LifeOS can't work around:

- **Allowed origins**: Ollama allows `localhost` pages by default. When LifeOS
  is opened from a website, start Ollama with that exact origin, for example
  `OLLAMA_ORIGINS=https://your-site.netlify.app`. Never use `*`, which lets
  every website use your Ollama.
- **HTTPS → http://localhost**: Chrome, Edge and Firefox allow it, and newer
  Chrome versions may ask the user to allow the site to reach local apps.
  Safari blocks it. In that case, run LifeOS locally with `npm run serve:local`.
- **localhost is the current device**: on a phone, `localhost` is the phone.
  The Android app can't reach Ollama on a PC. LifeOS accepts plain `http` only
  for localhost/127.0.0.1/::1, and requires `https` for any other host, so
  financial data never crosses a network unencrypted.
- **Attachments**: images need a vision model (for example
  `llama3.2-vision`). Ollama can't read PDFs, and LifeOS says so before
  sending anything.

### ChatGPT

ChatGPT is shown as information only. Its subscriptions (Go, Plus, Pro) don't
include API access. OpenAI's "Sign in with ChatGPT" (announced in September
2026) is limited to approved launch partners, and there's no self-serve way
for an app like LifeOS to use a subscription. LifeOS never asks for ChatGPT
passwords, cookies, or session tokens. To use OpenAI models, add an OpenAI API
key.

### Netlify environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_CREDENTIAL_SECRET` | **Yes** | At least 32 random characters. Encrypts users' keys. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Never commit it. |
| `AI_OPENAI_MODEL` | No | Defaults to `gpt-4.1-mini`. |
| `AI_GEMINI_MODEL` | No | Defaults to `gemini-flash-latest` (Google's alias for the current Flash model). |
| `AI_ANTHROPIC_MODEL` | No | Defaults to `claude-haiku-4-5-20251001`. |
| `AI_PROVIDER_TIMEOUT_MS` | No | Defaults to `9000`, which keeps provider calls inside Netlify's default 10-second function limit. Raise it only if your site's function timeout is higher. |
| `AI_ALLOWED_ORIGINS` | No | Extra comma-separated CORS origins. `https://localhost` and `capacitor://localhost` (the Android app) are always allowed. |

Without `AI_CREDENTIAL_SECRET` the app still works. AI shows "There's an issue
connecting to AI right now" and nothing else is affected.

### Local development

`ng serve` and static servers such as `http-server` don't run the AI backend.
With one of those, Test Connection shows "AI backend isn't running". Use the
local server instead. It serves the production build and runs the same
handlers as Netlify (`netlify/ai/handlers.ts`):

```
# once: create a git-ignored .env with a random secret (the value is not printed)
node -e "require('fs').writeFileSync('.env', 'AI_CREDENTIAL_SECRET=' + require('crypto').randomBytes(48).toString('base64url') + '\n', { flag: 'wx' })"

npm run build
npm run serve:local        # → http://localhost:8080
```

- It listens on `127.0.0.1` only. API keys are sent to it over plain HTTP, so
  don't expose it to other devices. `LIFEOS_HOST` can override this, with a
  warning. Use the deployed HTTPS site for phones.
- `PORT` changes the port. If the port is taken (for example by
  `http-server`), the server stops with a clear message.
- If you change `AI_CREDENTIAL_SECRET`, saved AI connections stop working and
  you'll need to reconnect once.
- The Netlify CLI (`npx netlify-cli dev`) also works.

### Android (Capacitor) app

The Android web view runs from `https://localhost`, so it can't reach the
backend by a relative path. Set `AI_BACKEND_NATIVE_BASE_URL` in
`src/app/core/ai/ai-backend.config.ts` to your deployed site URL (for example
`https://your-site.netlify.app`) before building the APK. While it's empty,
the Android app shows "AI isn't available here yet" and everything else works.

### Tests

```
npm test          # tax engine + AI app/backend tests + functions type-check
npm run test:ai   # AI tests only
```

### Providers, errors and billing pages

Provider adapters live in `netlify/ai/providers/` (one file per provider). Each
classifies its own documented error codes, so out-of-credit, billing not set
up, spend or usage caps, rate limits, bad keys, and permission problems reach
the app as distinct codes. When a cause is ambiguous, the app uses cautious
"may be" wording. "Open Usage Credits" opens only the official billing pages
listed in `src/app/core/ai/ai-provider-guides.ts`:

| Provider | Billing page | Keys |
| --- | --- | --- |
| OpenAI API | https://platform.openai.com/settings/organization/billing/overview | https://platform.openai.com/api-keys |
| Google Gemini API | https://aistudio.google.com/billing | https://aistudio.google.com/apikey |
| Anthropic Claude API | https://platform.claude.com/settings/billing | https://platform.claude.com/settings/keys |

Gemini keys are sent in the `x-goog-api-key` header, never in the URL.

LifeOS has no budgets or financial-goals data yet, so AI answers can't cover
them. The prompt tells the model to say that information isn't available,
not to guess.
