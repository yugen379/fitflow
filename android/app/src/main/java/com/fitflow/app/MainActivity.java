package com.fitflow.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.fitflow.app.steps.BackgroundStepsPlugin;
import com.fitflow.app.health.SleepPlugin;
import com.fitflow.app.gps.GpsTrackerPlugin;

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
        // GPS walk / run / ride recording; see gps/LocationTrackingService.java.
        registerPlugin(GpsTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
