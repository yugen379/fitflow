package com.fitflow.app.steps;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * Brings step counting back after a reboot or an app update.
 *
 * A reboot is the one event that genuinely loses steps: TYPE_STEP_COUNTER resets
 * to zero when the device restarts, so anything walked between the reboot and
 * our listener being registered is gone for good. Restarting promptly here is
 * what keeps that window down to seconds instead of "until the user next opens
 * the app", which could be a whole day.
 *
 * MY_PACKAGE_REPLACED matters for the same reason: an app update stops the
 * service, and without this the user would silently stop being counted after
 * every Play Store update.
 *
 * Android 15 forbids BOOT_COMPLETED receivers from starting several foreground
 * service types (dataSync, camera, mediaPlayback, phoneCall, mediaProjection,
 * microphone). `health`, which is what StepCounterService declares, is not on
 * that list — this is a large part of why `health` is the correct type here.
 *
 * The service is only restarted if the user had it switched on, so a user who
 * never enabled background counting never gets a service started behind their
 * back at boot.
 */
public class BootReceiver extends BroadcastReceiver {

    /** Mirrors the key the plugin writes when the user turns counting on. */
    static final String PREFS = "fitflow_steps_prefs";
    static final String KEY_ENABLED = "background_enabled";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }

        String action = intent.getAction();
        boolean relevant = Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action);
        if (!relevant) {
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_ENABLED, false)) {
            // The user never opted in. Do nothing at all.
            return;
        }

        try {
            // Re-checks the permission and the sensor internally, so a user who
            // revoked ACTIVITY_RECOGNITION since last boot does not cause a crash.
            StepCounterService.start(context);
        } catch (Exception ignored) {
            // A failed restart must never crash the boot broadcast; the user
            // opening the app will start it again.
        }
    }
}
