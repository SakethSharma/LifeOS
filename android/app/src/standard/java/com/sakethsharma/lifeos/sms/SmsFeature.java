package com.sakethsharma.lifeos.sms;

import com.getcapacitor.BridgeActivity;

/**
 * "standard" build flavor (the default): no SMS plugin and no SMS permission.
 * Every other LifeOS feature is identical; the app shows SMS import as not
 * included in this version.
 */
public final class SmsFeature {
    private SmsFeature() {}

    public static void register(BridgeActivity activity) {
        // SMS import is not part of this build.
    }
}
