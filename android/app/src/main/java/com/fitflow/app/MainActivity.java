package com.fitflow.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.fitflow.app.steps.BackgroundStepsPlugin;
import com.fitflow.app.health.SleepPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the local one-tap "open app settings" plugin before the bridge starts.
        registerPlugin(AppSettingsPlugin.class);
        // Background step counting. Owns the foreground service that keeps
        // counting while the app is closed; see steps/StepCounterService.java.
        registerPlugin(BackgroundStepsPlugin.class);
        // Sleep from Health Connect (the health plugin has no sleep type).
        registerPlugin(SleepPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
