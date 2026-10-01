/**
 * Where the app finds the LifeOS AI backend (netlify/functions/ai-*).
 *
 * - Web / installed PWA: same origin as the app, so nothing to configure.
 * - Android (Capacitor) app: the web view runs from https://localhost, so it
 *   must call the deployed site explicitly. Set this to the deployed LifeOS
 *   URL, e.g. 'https://your-site.netlify.app' (no trailing slash). While empty,
 *   AI features in the Android app show "AI isn't available here yet" and
 *   everything else keeps working.
 */
export const AI_BACKEND_NATIVE_BASE_URL = '';
