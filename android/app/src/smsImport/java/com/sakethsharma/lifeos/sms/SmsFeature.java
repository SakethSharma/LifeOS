package com.sakethsharma.lifeos.sms;

import com.getcapacitor.BridgeActivity;

/**
 * "smsImport" build flavor: the on-device SMS transaction importer is
 * included. This flavor's manifest (src/smsImport/AndroidManifest.xml)
 * declares READ_SMS. Distribute it only where the SMS permission is allowed
 * (e.g. Google Play after an approved Permissions Declaration).
 */
public final class SmsFeature {
    private SmsFeature() {}

    public static void register(BridgeActivity activity) {
        activity.registerPlugin(SmsInboxPlugin.class);
    }
}
