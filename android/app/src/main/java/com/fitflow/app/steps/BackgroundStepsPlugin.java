package com.fitflow.app.steps;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.util.Iterator;

/**
 * WebView bridge for the background step counter.
 *
 * The native side (StepCounterService + StepStore) is the source of truth for
 * the step count. This plugin does three things and no more: it reports and
 * requests the permissions the service needs, it turns the service on and off,
 * and it hands the stored counts to the web layer.
 *
 * It deliberately does NOT do any counting itself. When the WebView is not
 * running there is nobody here to count, which is the entire reason the service
 * exists.
 *
 * ## The permission the user actually has to grant
 *
 * Three separate grants gate this, and they are surfaced separately because
 * they fail separately:
 *
 *   1. ACTIVITY_RECOGNITION (runtime, API 29+) — gates the sensor itself AND is
 *      the prerequisite that makes a `health` foreground service legal.
 *   2. POST_NOTIFICATIONS (runtime, API 33+) — the ongoing notification. The
 *      service still runs without it; the user just cannot see that it is on.
 *   3. Battery optimisation exemption — NOT a runtime permission. Without it
 *      aggressive OEM battery managers (Xiaomi, Samsung, Huawei and friends)
 *      will kill even a foreground service after some hours, and the user sees
 *      counting mysteriously stop overnight. This is the one people mean when
 *      they say "allow the app to run in the background".
 *
 * On (3) this opens the system battery-optimisation LIST rather than firing the
 * direct ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS dialog. The direct dialog
 * needs the REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission, which is a flagged
 * permission requiring a Play Console policy declaration and review. The
 * settings screen needs no permission and lands the user on the same toggle.
 */
@CapacitorPlugin(
        name = "BackgroundSteps",
        permissions = {
                @Permission(alias = "activityRecognition", strings = {android.Manifest.permission.ACTIVITY_RECOGNITION}),
                @Permission(alias = "notifications", strings = {android.Manifest.permission.POST_NOTIFICATIONS})
        })
public class BackgroundStepsPlugin extends Plugin {

    /** Mirrors BootReceiver, so a reboot only restarts what the user switched on. */
    private static final String PREFS = BootReceiver.PREFS;
    private static final String KEY_ENABLED = BootReceiver.KEY_ENABLED;

    private StepStore store;
    private BroadcastReceiver stepReceiver;

    @Override
    public void load() {
        store = new StepStore(getContext());

        // Live updates while the WebView is open. The service broadcasts on
        // every sensor burst; when the WebView is gone this simply is not
        // registered and the count is read from the store on next launch.
        stepReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) {
                    return;
                }
                JSObject payload = new JSObject();
                payload.put("steps", intent.getLongExtra(StepCounterService.EXTRA_STEPS, 0L));
                payload.put("day", intent.getStringExtra(StepCounterService.EXTRA_DAY));
                notifyListeners("stepsChanged", payload);
            }
        };

        IntentFilter filter = new IntentFilter(StepCounterService.BROADCAST_STEPS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Explicitly not exported: this is an internal, same-package signal,
            // and an exported receiver would let any app spoof step counts.
            getContext().registerReceiver(stepReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(stepReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (stepReceiver != null) {
            try {
                getContext().unregisterReceiver(stepReceiver);
            } catch (Exception ignored) {
                // Already gone.
            }
            stepReceiver = null;
        }
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------

    /** Everything the UI needs to decide what to show, in one round trip. */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("sensorAvailable", StepCounterService.hasStepSensor(getContext()));
        result.put("activityRecognition", getPermissionState("activityRecognition").toString());
        result.put("notifications", notificationsState());
        result.put("batteryOptimizationExempt", isIgnoringBatteryOptimizations());
        result.put("serviceRunning", StepCounterService.isRunning());
        result.put("enabled", prefs().getBoolean(KEY_ENABLED, false));
        call.resolve(result);
    }

    /**
     * POST_NOTIFICATIONS did not exist before API 33; there it is granted by
     * default and asking would return a permanently-denied-looking state.
     */
    private String notificationsState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return PermissionState.GRANTED.toString();
        }
        return getPermissionState("notifications").toString();
    }

    private boolean isIgnoringBatteryOptimizations() {
        try {
            PowerManager manager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            return manager != null && manager.isIgnoringBatteryOptimizations(getContext().getPackageName());
        } catch (Exception e) {
            // Checking needs no permission, but some OEM builds still throw.
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Permissions
    // ------------------------------------------------------------------

    @PluginMethod
    public void requestActivityPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // No runtime permission existed; the manifest entry is enough.
            getStatus(call);
            return;
        }
        requestPermissionForAlias("activityRecognition", call, "activityPermissionResult");
    }

    @PermissionCallback
    private void activityPermissionResult(PluginCall call) {
        // Granting is the whole point of asking, so start immediately rather
        // than making the user tap a second button.
        if (getPermissionState("activityRecognition") == PermissionState.GRANTED) {
            setEnabled(true);
            StepCounterService.start(getContext());
        }
        getStatus(call);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            getStatus(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        getStatus(call);
    }

    /**
     * Opens the system battery-optimisation list so the user can set FitFlow to
     * "Not optimised" / "Unrestricted". Android does not allow deep-linking to a
     * single app's row, so this is the closest reliable target — the same
     * compromise the existing AppSettings plugin makes for the camera toggle.
     */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // Not every OEM ships that screen; fall back to this app's info page.
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.fromParts("package", getContext().getPackageName(), null));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception inner) {
                call.reject("Unable to open battery settings", inner);
            }
        }
    }

    // ------------------------------------------------------------------
    // Service control
    // ------------------------------------------------------------------

    @PluginMethod
    public void start(PluginCall call) {
        if (!StepCounterService.hasStepSensor(getContext())) {
            call.reject("This device has no step counter sensor");
            return;
        }
        if (!StepCounterService.hasActivityPermission(getContext())) {
            call.reject("Physical activity permission is required");
            return;
        }
        setEnabled(true);
        StepCounterService.start(getContext());
        getStatus(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        setEnabled(false);
        StepCounterService.stop(getContext());
        getStatus(call);
    }

    /**
     * Hand the service the user's bodyweight so the ongoing notification can
     * show calories that match the in-app card exactly. Optional: with no
     * weight stored the store falls back to the 70 kg reference rather than
     * hiding the figure.
     */
    @PluginMethod
    public void setBody(PluginCall call) {
        Double weightKg = call.getDouble("weightKg");
        if (weightKg != null) {
            store.setWeightKg(weightKg);
        }
        call.resolve();
    }

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    @PluginMethod
    public void getToday(PluginCall call) {
        JSObject result = new JSObject();
        result.put("day", store.getDay());
        result.put("steps", store.getStepsToday());
        call.resolve(result);
    }

    /** All retained days as a { "YYYY-MM-DD": steps } map, today included. */
    @PluginMethod
    public void getHistory(PluginCall call) {
        JSObject days = new JSObject();
        try {
            JSONObject history = store.getHistory();
            for (Iterator<String> it = history.keys(); it.hasNext(); ) {
                String key = it.next();
                days.put(key, history.optLong(key, 0L));
            }
        } catch (Exception ignored) {
            // An empty map is a truthful answer when storage is unreadable.
        }
        JSObject result = new JSObject();
        result.put("days", days);
        call.resolve(result);
    }

    // ------------------------------------------------------------------

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void setEnabled(boolean enabled) {
        prefs().edit().putBoolean(KEY_ENABLED, enabled).apply();
    }
}
