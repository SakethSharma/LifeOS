import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PermissionState } from '@capacitor/core';
import type { SmsInbox, SmsPermission } from '../engine/sms-import.engine';
import type { RawSms } from '../models/sms-import.model';

/** The app's own Android plugin: android/app/src/main/java/.../sms/SmsInboxPlugin.java */
interface SmsInboxPlugin {
  checkPermissions(): Promise<{ sms: PermissionState }>;
  requestPermissions(options?: { permissions: string[] }): Promise<{ sms: PermissionState }>;
  query(options: { from: number; to: number; offset: number; limit: number }): Promise<{ messages: RawSms[] }>;
  openAppSettings(): Promise<void>;
}

const SmsInboxNative = registerPlugin<SmsInboxPlugin>('SmsInbox');

/**
 * Bridge to the native SMS inbox. Only the Android app has it; in a browser
 * (or the PWA) isAvailable() is false and nothing is ever requested.
 */
export class NativeSmsInbox implements SmsInbox {
  /** Running as the Android app (whether or not this build includes SMS import). */
  isAndroidApp(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  /** The Android plugin is only in the "smsImport" build flavor. */
  isAvailable(): boolean {
    return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('SmsInbox');
  }

  async checkPermission(): Promise<SmsPermission> {
    if (!this.isAvailable()) return 'denied';
    return toPermission((await SmsInboxNative.checkPermissions()).sms);
  }

  async requestPermission(): Promise<SmsPermission> {
    if (!this.isAvailable()) return 'denied';
    return toPermission((await SmsInboxNative.requestPermissions({ permissions: ['sms'] })).sms);
  }

  async query(options: { from: number; to: number; offset: number; limit: number }): Promise<RawSms[]> {
    const { messages } = await SmsInboxNative.query(options);
    return Array.isArray(messages) ? messages : [];
  }

  /** For a permanently denied permission: the user enables it in Android Settings. */
  async openAppSettings(): Promise<void> {
    if (this.isAvailable()) await SmsInboxNative.openAppSettings();
  }
}

function toPermission(state: PermissionState): SmsPermission {
  if (state === 'granted') return 'granted';
  // 'prompt-with-rationale' means Android will still show the dialog.
  return state === 'denied' ? 'denied' : 'prompt';
}
