package com.fitflow.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the local one-tap "open app settings" plugin before the bridge starts.
        registerPlugin(AppSettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
