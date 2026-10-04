import type { AiProviderChoice, AiProviderId } from './ai-contract';
import { AI_PROVIDER_IDS, OLLAMA_PROVIDER, isAiProviderId } from './ai-contract';

/** Where AI setup lives. Deep links: /info#ai-connect and /info#ai-key-guide. */
export const AI_SETUP_ROUTE = '/info';

/** Opens "Connect AI to LifeOS" on the Info page. */
export const AI_CONNECT_FRAGMENT = 'ai-connect';

/** Opens "How to Get Your AI API Key" (the carousel) on the Info page. */
export const AI_KEY_GUIDE_FRAGMENT = 'ai-key-guide';

/** Which schematic picture a setup step shows. Illustrations are drawn by the carousel, not screenshots. */
export type GuideIllustration = 'open-site' | 'find-keys' | 'create-key' | 'copy-key' | 'billing' | 'paste-key';

export interface GuideStep {
  title: string;
  body: string;
  illustration: GuideIllustration;
  /** Text shown in the illustration's address bar / highlight, if any. */
  illustrationText?: string;
  link?: { label: string; url: string };
}

export interface AiProviderInfo {
  id: AiProviderId;
  /** Full name, e.g. "OpenAI API" — never just "ChatGPT", which is a separate subscription product. */
  label: string;
  /** Used in "Connected to …". */
  shortName: string;
  company: string;
  keyPlaceholder: string;
  keysUrl: string;
  /** Official billing / usage-credits page. The only URL "Open Usage Credits" may open. */
  billingUrl: string;
  steps: GuideStep[];
}

// Official provider URLs only — checked against each provider's documentation.
const OPENAI_PLATFORM = 'https://platform.openai.com/';
const OPENAI_KEYS = 'https://platform.openai.com/api-keys';
const OPENAI_BILLING = 'https://platform.openai.com/settings/organization/billing/overview';
// ai.google.dev → API keys / Billing.
const GEMINI_STUDIO = 'https://aistudio.google.com/';
const GEMINI_KEYS = 'https://aistudio.google.com/apikey';
const GEMINI_BILLING = 'https://aistudio.google.com/billing';
// console.anthropic.com now redirects (301) to platform.claude.com.
const ANTHROPIC_CONSOLE = 'https://platform.claude.com/';
const ANTHROPIC_KEYS = 'https://platform.claude.com/settings/keys';
const ANTHROPIC_BILLING = 'https://platform.claude.com/settings/billing';

const PASTE_STEP_BODY = 'Back in LifeOS, paste the key into its provider\'s API Key field above and tap "Save & Test".';

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI API',
    shortName: 'OpenAI API',
    company: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keysUrl: OPENAI_KEYS,
    billingUrl: OPENAI_BILLING,
    steps: [
      {
        title: 'Open the OpenAI API platform and sign in',
        body: "Go to the OpenAI API platform — not ChatGPT — and log in or sign up. ChatGPT plans (Go, Plus and others) don't include API access.",
        illustration: 'open-site',
        illustrationText: 'platform.openai.com',
        link: { label: 'Open OpenAI platform', url: OPENAI_PLATFORM },
      },
      {
        title: 'Open API keys',
        body: 'Open the settings or dashboard menu and choose "API keys".',
        illustration: 'find-keys',
        illustrationText: 'API keys',
        link: { label: 'Go to API keys', url: OPENAI_KEYS },
      },
      {
        title: 'Create a new secret key',
        body: 'Select "Create new secret key", name it something you\'ll recognise, like "LifeOS", and confirm.',
        illustration: 'create-key',
        illustrationText: '+ Create new secret key',
      },
      {
        title: 'Copy the key and keep it private',
        body: "Copy it right away — it's shown only once. Keep it private, like a password.",
        illustration: 'copy-key',
        illustrationText: 'sk-••••••••••••',
      },
      {
        title: 'Check your API billing',
        body: 'API usage is billed separately from ChatGPT. Add credit or check limits here if you see a billing message later.',
        illustration: 'billing',
        link: { label: 'Open billing', url: OPENAI_BILLING },
      },
      {
        title: 'Paste it into LifeOS and test',
        body: PASTE_STEP_BODY,
        illustration: 'paste-key',
      },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini API',
    shortName: 'Google Gemini',
    company: 'Google',
    keyPlaceholder: 'AIza...',
    keysUrl: GEMINI_KEYS,
    billingUrl: GEMINI_BILLING,
    steps: [
      {
        title: 'Open Google AI Studio and sign in',
        body: 'Go to Google AI Studio — the developer site, not the Gemini app — and sign in with your Google account. The Gemini app and the Gemini API are separate products.',
        illustration: 'open-site',
        illustrationText: 'aistudio.google.com',
        link: { label: 'Open Google AI Studio', url: GEMINI_STUDIO },
      },
      {
        title: 'Open "Get API key"',
        body: 'In AI Studio, open the API keys page ("Get API key").',
        illustration: 'find-keys',
        illustrationText: 'Get API key',
        link: { label: 'Go to API keys', url: GEMINI_KEYS },
      },
      {
        title: 'Create an API key',
        body: 'Select "Create API key" and choose or create a Google Cloud project for it.',
        illustration: 'create-key',
        illustrationText: '+ Create API key',
      },
      {
        title: 'Copy the key and keep it private',
        body: 'Copy the key and keep it private, like a password. Never share it or post it anywhere.',
        illustration: 'copy-key',
        illustrationText: 'AIza••••••••••',
      },
      {
        title: 'Check free tier and billing',
        body: 'Google offers a limited free tier in many regions. For higher limits or paid models, set up billing in AI Studio.',
        illustration: 'billing',
        link: { label: 'Open billing', url: GEMINI_BILLING },
      },
      {
        title: 'Paste it into LifeOS and test',
        body: PASTE_STEP_BODY,
        illustration: 'paste-key',
      },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude API',
    shortName: 'Anthropic Claude',
    company: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    keysUrl: ANTHROPIC_KEYS,
    billingUrl: ANTHROPIC_BILLING,
    steps: [
      {
        title: 'Open the Claude Console and sign in',
        body: "Go to the Claude Console — not the Claude app — and sign in or sign up. Claude plans (Pro, Max and others) don't include API access.",
        illustration: 'open-site',
        illustrationText: 'platform.claude.com',
        link: { label: 'Open Claude Console', url: ANTHROPIC_CONSOLE },
      },
      {
        title: 'Open API keys',
        body: 'Open Settings and choose "API keys".',
        illustration: 'find-keys',
        illustrationText: 'API keys',
        link: { label: 'Go to API keys', url: ANTHROPIC_KEYS },
      },
      {
        title: 'Create a key',
        body: 'Select "Create Key", name it something you\'ll recognise, like "LifeOS", and confirm.',
        illustration: 'create-key',
        illustrationText: '+ Create Key',
      },
      {
        title: 'Copy the key and keep it private',
        body: "Copy it right away — it's shown only once. Keep it private, like a password.",
        illustration: 'copy-key',
        illustrationText: 'sk-ant-••••••••••',
      },
      {
        title: 'Check your API billing',
        body: 'API usage is billed separately from Claude plans. Add credit or check limits here if you see a billing message later.',
        illustration: 'billing',
        link: { label: 'Open billing', url: ANTHROPIC_BILLING },
      },
      {
        title: 'Paste it into LifeOS and test',
        body: PASTE_STEP_BODY,
        illustration: 'paste-key',
      },
    ],
  },
];

export function getProviderInfo(id: AiProviderId): AiProviderInfo {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}

export const OLLAMA_INFO = {
  label: 'Ollama (local)',
  shortName: 'Ollama',
  downloadUrl: 'https://ollama.com/download',
  libraryUrl: 'https://ollama.com/library',
} as const;

/** ChatGPT is a consumer app, not an API LifeOS can use. Shown as information only. */
export const CHATGPT_INFO = {
  label: 'ChatGPT',
  siteUrl: 'https://chatgpt.com/',
} as const;

/** Full display name for any selectable provider, e.g. "OpenAI API" or "Ollama (local)". */
export function providerLabel(id: AiProviderChoice): string {
  return id === OLLAMA_PROVIDER ? OLLAMA_INFO.label : getProviderInfo(id).label;
}

/** Short display name, e.g. "Google Gemini" or "Ollama". */
export function providerShortName(id: AiProviderChoice): string {
  return id === OLLAMA_PROVIDER ? OLLAMA_INFO.shortName : getProviderInfo(id).shortName;
}

/** True when requests go to a cloud provider (so financial context leaves the device). */
export function isCloudProvider(id: AiProviderChoice | null): id is AiProviderId {
  return isAiProviderId(id);
}

/**
 * The official billing page for a provider. Looked up from the fixed list
 * above only — never built from user input or key values.
 */
export function getBillingUrl(id: AiProviderChoice): string | null {
  return isAiProviderId(id) && AI_PROVIDER_IDS.includes(id) ? getProviderInfo(id).billingUrl : null;
}
