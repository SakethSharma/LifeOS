# LifeOS
LifeOS – Your all-in-one personal life management app to track finances, health, habits, tasks, and insights in one place.

## AI setup (bring your own key)

AI Insights and the salary document reader use the user's own OpenAI or
Anthropic API key. LifeOS ships no shared key.

### How it works

```
App (browser / Android)  ──HTTPS──▶  LifeOS AI backend (Netlify Functions)  ──▶  OpenAI / Anthropic
                                     netlify/functions/ai-*.mts
```

- **Connect**: the user pastes a key in **Info → AI Insights → Connect AI to LifeOS**. The app
  sends it once to `/api/ai/connect`. The backend makes a real, free call to
  the provider (a model listing) to check it, then encrypts the key with
  AES-256-GCM using `AI_CREDENTIAL_SECRET` and returns that sealed token plus
  a masked hint (`sk-••••••••1234`).
- **Storage**: the device keeps only the sealed token and the hint, in
  `localStorage` (`lifeos.ai.connection.v1`). It's kept apart from app settings,
  so data exports never include it. The raw key isn't stored anywhere, logged,
  or sent back to the app.
- **Requests**: `/api/ai/chat`, `/api/ai/extract` and `/api/ai/test` take the
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

### Netlify environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_CREDENTIAL_SECRET` | **Yes** | At least 32 random characters. Encrypts users' keys. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Never commit it. |
| `AI_OPENAI_MODEL` | No | Defaults to `gpt-4.1-mini`. |
| `AI_ANTHROPIC_MODEL` | No | Defaults to `claude-haiku-4-5-20251001`. |
| `AI_PROVIDER_TIMEOUT_MS` | No | Defaults to `9000`, which keeps provider calls inside Netlify's default 10-second function limit. Raise it only if your site's function timeout is higher. |
| `AI_ALLOWED_ORIGINS` | No | Extra comma-separated CORS origins. `https://localhost` and `capacitor://localhost` (the Android app) are always allowed. |

Without `AI_CREDENTIAL_SECRET` the app still works. AI shows "There's an issue
connecting to AI right now" and nothing else is affected.

### Local development

`ng serve` does not run the functions. Use the Netlify CLI, which serves the
app and `/api/ai/*` together:

```
echo AI_CREDENTIAL_SECRET=<your-local-secret> > .env
npx netlify-cli dev
```

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
