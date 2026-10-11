package com.sakethsharma.lifeos;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.sakethsharma.lifeos.sms.SmsInboxPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(SmsInboxPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
