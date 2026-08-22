package com.fitflow.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.fitflow.app.steps.BackgroundStepsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the local one-tap "open app settings" plugin before the bridge starts.
        registerPlugin(AppSettingsPlugin.class);
        // Background step counting. Owns the foreground service that keeps
        // counting while the app is closed; see steps/StepCounterService.java.
        registerPlugin(BackgroundStepsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
