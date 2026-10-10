/**
 * Where the app finds the LifeOS AI backend (netlify/functions/ai-*).
 *
 * - Web / installed PWA: same origin as the app, so nothing to configure.
 * - Android (Capacitor) app: the web view runs from https://localhost, so it
 *   must call a deployed HTTPS backend explicitly. While none is set, AI
 *   features in the Android app show "AI isn't available here yet" and
 *   everything else keeps working.
 *
 * The address is supplied at build time (it's a public site URL, not a secret):
 *   ng build --configuration production --define "LIFEOS_AI_BACKEND_URL='https://your-site.example'"
 * The "Build LifeOS Android APK" workflow passes the repository variable
 * LIFEOS_AI_BACKEND_URL this way.
 */
declare const LIFEOS_AI_BACKEND_URL: string | undefined;

export const AI_BACKEND_NATIVE_BASE_URL = typeof LIFEOS_AI_BACKEND_URL === 'string' ? LIFEOS_AI_BACKEND_URL : '';

/**
 * The backend origin the Android app may call, or null when none is set.
 * HTTPS only — credentials pass through it — and no credentials, path or query.
 */
export function nativeBackendBaseUrl(configured: string = AI_BACKEND_NATIVE_BASE_URL): string | null {
  const value = configured.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const plainOrigin = !url.username && !url.password && !url.search && !url.hash && (url.pathname === '/' || url.pathname === '');
    return url.protocol === 'https:' && plainOrigin ? url.origin : null;
  } catch {
    return null;
  }
}
