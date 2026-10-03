import type { AiProviderId } from './ai-contract';

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
  label: string;
  company: string;
  keyPlaceholder: string;
  keysUrl: string;
  steps: GuideStep[];
}

// Official provider URLs only.
const OPENAI_PLATFORM = 'https://platform.openai.com/';
const OPENAI_KEYS = 'https://platform.openai.com/api-keys';
const OPENAI_BILLING = 'https://platform.openai.com/settings/organization/billing/overview';
const ANTHROPIC_CONSOLE = 'https://console.anthropic.com/';
const ANTHROPIC_KEYS = 'https://console.anthropic.com/settings/keys';
const ANTHROPIC_BILLING = 'https://console.anthropic.com/settings/billing';

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    company: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keysUrl: OPENAI_KEYS,
    steps: [
      {
        title: 'Open the OpenAI API platform and sign in',
        body: "Go to the OpenAI API platform — not ChatGPT — and log in or sign up. A ChatGPT plan doesn't include API access.",
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
        body: 'API usage is billed separately from ChatGPT. If you later see a credit message, add credit or check limits here.',
        illustration: 'billing',
        link: { label: 'Open billing', url: OPENAI_BILLING },
      },
      {
        title: 'Paste it into LifeOS',
        body: 'Back in LifeOS, paste the key into the API Key field above and tap "Test Connection".',
        illustration: 'paste-key',
      },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    company: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    keysUrl: ANTHROPIC_KEYS,
    steps: [
      {
        title: 'Open the Anthropic Console and sign in',
        body: "Go to the Anthropic Console — not the Claude app — and sign in or sign up. A Claude plan doesn't include API access.",
        illustration: 'open-site',
        illustrationText: 'console.anthropic.com',
        link: { label: 'Open Anthropic Console', url: ANTHROPIC_CONSOLE },
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
        body: 'Select "Create Key", name it something like "LifeOS", and confirm.',
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
        body: 'API usage is billed separately from Claude plans. If you later see a credit message, add credit or check limits here.',
        illustration: 'billing',
        link: { label: 'Open billing', url: ANTHROPIC_BILLING },
      },
      {
        title: 'Paste it into LifeOS',
        body: 'Back in LifeOS, paste the key into the API Key field above and tap "Test Connection".',
        illustration: 'paste-key',
      },
    ],
  },
];

export function getProviderInfo(id: AiProviderId): AiProviderInfo {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}
