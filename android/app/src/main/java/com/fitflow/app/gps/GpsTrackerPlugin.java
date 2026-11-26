package com.fitflow.app.gps;

import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONArray;

/**
 * WebView bridge for GPS activity recording (LocationTrackingService).
 *
 * checkPermissions() / requestPermissions() come from the Capacitor base class
 * and report the two aliases below. Background location is deliberately NOT
 * declared or requested: recording is always started from the visible app,
 * which keeps while-in-use access for the life of the foreground service.
 *
 * Errors are rejected with stable codes the UI maps to plain messages:
 *   PERMISSION_DENIED, PRECISE_REQUIRED, GPS_DISABLED, NO_GPS, ALREADY_ACTIVE, START_FAILED.
 */
@CapacitorPlugin(
        name = "GpsTracker",
        permissions = {
                @Permission(alias = "location", strings = {
                        android.Manifest.permission.ACCESS_FINE_LOCATION,
                        android.Manifest.permission.ACCESS_COARSE_LOCATION}),
                @Permission(alias = "notifications", strings = {android.Manifest.permission.POST_NOTIFICATIONS})
        })
public class GpsTrackerPlugin extends Plugin {

    private GpsTrackStore store;

    @Override
    public void load() {
        store = new GpsTrackStore(getContext());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("location", getPermissionState("location").toString());
        r.put("preciseLocation", LocationTrackingService.hasFineLocation(getContext()));
        r.put("notifications", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                ? PermissionState.GRANTED.toString() : getPermissionState("notifications").toString());
        r.put("gpsHardware", LocationTrackingService.hasGpsHardware(getContext()));
        r.put("gpsEnabled", LocationTrackingService.isGpsEnabled(getContext()));
        r.put("state", store.getState());
        r.put("serviceRunning", LocationTrackingService.isRunning());
        call.resolve(r);
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Unable to open location settings", e);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String activity = call.getString("activity", "walk");
        if (!"walk".equals(activity) && !"run".equals(activity) && !"cycle".equals(activity)) activity = "walk";
        String state = store.getState();
        if (GpsTrackStore.STATE_RECORDING.equals(state) || GpsTrackStore.STATE_PAUSED.equals(state)) {
            call.reject("A recording is already in progress", "ALREADY_ACTIVE");
            return;
        }
        if (!preflight(call)) return;
        store.begin(activity, "mi".equals(call.getString("distanceUnit", "km")));
        try {
            LocationTrackingService.send(getContext(), LocationTrackingService.ACTION_START, activity);
        } catch (Exception e) {
            // ForegroundServiceStartNotAllowedException and friends: the app
            // must be visible. Leave nothing half-started behind.
            store.clear();
            call.reject("Could not start recording: " + e.getMessage(), "START_FAILED");
            return;
        }
        call.resolve(current(0));
    }

    /** The km / mi switch flipped mid-recording: the notification follows on its next tick. */
    @PluginMethod
    public void setDistanceUnit(PluginCall call) {
        store.setMiles("mi".equals(call.getString("unit", "km")));
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        store.pause();
        LocationTrackingService.send(getContext(), LocationTrackingService.ACTION_PAUSE, null);
        call.resolve(current(Integer.MAX_VALUE));
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (!GpsTrackStore.STATE_PAUSED.equals(store.getState())) {
            call.resolve(current(Integer.MAX_VALUE));
            return;
        }
        if (!preflight(call)) return;
        try {
            LocationTrackingService.send(getContext(), LocationTrackingService.ACTION_RESUME, null);
        } catch (Exception e) {
            call.reject("Could not resume recording: " + e.getMessage(), "START_FAILED");
            return;
        }
        call.resolve(current(Integer.MAX_VALUE));
    }

    /** Stops recording and returns the whole session. The session stays stored until clear(). */
    @PluginMethod
    public void stop(PluginCall call) {
        store.finish();
        LocationTrackingService.send(getContext(), LocationTrackingService.ACTION_STOP, null);
        call.resolve(current(0));
    }

    /** Live stats plus the points recorded since index `since`. */
    @PluginMethod
    public void getCurrent(PluginCall call) {
        Integer since = call.getInt("since", 0);
        call.resolve(current(since == null ? 0 : Math.max(0, since)));
    }

    /** Forget the stored session (after it has been saved, or discarded by the user). */
    @PluginMethod
    public void clear(PluginCall call) {
        if (LocationTrackingService.isRunning()) {
            store.finish();
            LocationTrackingService.send(getContext(), LocationTrackingService.ACTION_STOP, null);
        }
        store.clear();
        call.resolve();
    }

    // ------------------------------------------------------------------

    private boolean preflight(PluginCall call) {
        if (!LocationTrackingService.hasFineLocation(getContext())) {
            boolean coarse = androidx.core.content.ContextCompat.checkSelfPermission(getContext(),
                    android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
            if (coarse) {
                // Android 12+ lets the user grant only approximate location,
                // which cannot use the GPS provider at all.
                call.reject("Precise location is required to record a route", "PRECISE_REQUIRED");
            } else {
                call.reject("Location permission is required to record a route", "PERMISSION_DENIED");
            }
            return false;
        }
        if (!LocationTrackingService.hasGpsHardware(getContext())) {
            call.reject("This device has no GPS", "NO_GPS");
            return false;
        }
        if (!LocationTrackingService.isGpsEnabled(getContext())) {
            call.reject("Location is turned off", "GPS_DISABLED");
            return false;
        }
        return true;
    }

    private JSObject current(int since) {
        JSObject r = new JSObject();
        r.put("state", store.getState());
        r.put("activity", store.getActivity());
        r.put("startedAt", store.getStartedAt());
        r.put("elapsedMs", store.getElapsedMs());
        r.put("pointCount", store.getPointCount());
        r.put("gpsEnabled", LocationTrackingService.isGpsEnabled(getContext()));
        JSONArray pts = since == Integer.MAX_VALUE ? new JSONArray() : store.readPoints(since);
        try {
            r.put("points", new JSArray(pts.toString()));
        } catch (Exception e) {
            r.put("points", new JSArray());
        }
        r.put("since", since == Integer.MAX_VALUE ? store.getPointCount() : since);
        return r;
    }
}
