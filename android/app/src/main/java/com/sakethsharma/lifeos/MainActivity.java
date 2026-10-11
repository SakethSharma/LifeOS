package com.sakethsharma.lifeos;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.sakethsharma.lifeos.sms.SmsFeature;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        // SmsFeature is flavor-specific: a no-op in "standard", the SMS plugin in "smsImport".
        SmsFeature.register(this);
        super.onCreate(savedInstanceState);
    }
}
