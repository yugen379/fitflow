package com.fitflow.app.gps;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import java.util.Locale;

/**
 * Foreground service that records a GPS walk / run / ride.
 *
 * Mirrors steps/StepCounterService: typed foreground service, ongoing
 * notification, state in durable storage (GpsTrackStore) so the WebView can die
 * and come back without losing a single fix.
 *
 * ## Android 14+ rules
 *
 *   android:foregroundServiceType="location" + FOREGROUND_SERVICE_LOCATION,
 *   and ACCESS_FINE_LOCATION must be granted at the moment startForeground()
 *   runs, or it throws SecurityException. The service is only ever started from
 *   the visible app on a user tap (GpsTrackerPlugin.start), which is the case
 *   Android allows without ACCESS_BACKGROUND_LOCATION: a location FGS started
 *   while the app is in the foreground keeps "while-in-use" access after the
 *   user leaves the app. FitFlow therefore never asks for background location.
 *
 * Plain android.location.LocationManager with GPS_PROVIDER (no Play Services
 * dependency): 1 s / 0 m updates, which is what a pace readout needs.
 *
 * If the system kills the process mid-session, START_STICKY brings the service
 * back with a null intent. Restarting a location FGS from the background is not
 * always permitted; if promotion fails the session is parked as PAUSED (nothing
 * lost) and the user resumes it from the app.
 */
public class LocationTrackingService extends Service implements LocationListener {

    public static final String ACTION_START = "com.fitflow.app.gps.START";
    public static final String ACTION_PAUSE = "com.fitflow.app.gps.PAUSE";
    public static final String ACTION_RESUME = "com.fitflow.app.gps.RESUME";
    public static final String ACTION_STOP = "com.fitflow.app.gps.STOP";
    public static final String EXTRA_ACTIVITY = "activity";

    private static final String CHANNEL_ID = "fitflow_gps_tracking";
    private static final int NOTIFICATION_ID = 4712;
    private static final long NOTIFICATION_TICK_MS = 5_000L;

    private static volatile boolean running = false;
    /** Last provider status the plugin can surface ("GPS turned off"). */
    private static volatile boolean providerEnabled = true;

    private GpsTrackStore store;
    private LocationManager locationManager;
    private boolean listening = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            updateNotification();
            handler.postDelayed(this, NOTIFICATION_TICK_MS);
        }
    };

    public static boolean isRunning() {
        return running;
    }

    public static boolean isProviderEnabled() {
        return providerEnabled;
    }

    public static boolean hasFineLocation(Context context) {
        return ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean isGpsEnabled(Context context) {
        LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        try {
            return lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        } catch (Exception e) {
            return false;
        }
    }

    public static boolean hasGpsHardware(Context context) {
        return context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS);
    }

    static void send(Context context, String action, String activity) {
        Intent intent = new Intent(context, LocationTrackingService.class);
        intent.setAction(action);
        if (activity != null) intent.putExtra(EXTRA_ACTIVITY, activity);
        if (ACTION_STOP.equals(action) || ACTION_PAUSE.equals(action)) {
            if (!running) {
                return; // nothing to tell; the store was already updated by the plugin
            }
            context.startService(intent);
        } else {
            ContextCompat.startForegroundService(context, intent);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        store = new GpsTrackStore(this);
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            store.finish();
            shutdown();
            return START_NOT_STICKY;
        }

        // Every start path must promote promptly (startForegroundService contract),
        // and promotion needs the location permission on Android 14+.
        if (!hasFineLocation(this)) {
            store.pause();
            shutdown();
            return START_NOT_STICKY;
        }
        try {
            promote();
        } catch (Exception e) {
            // Background-start restriction (e.g. a sticky restart) or a missing
            // permission. Park the session; the user resumes it in the app.
            store.pause();
            shutdown();
            return START_NOT_STICKY;
        }

        if (ACTION_PAUSE.equals(action)) {
            store.pause();
            stopListening();
        } else if (ACTION_RESUME.equals(action)) {
            store.resume();
            startListening();
        } else if (ACTION_START.equals(action)) {
            // begin() was already called by the plugin; nothing to reset here.
            startListening();
        } else {
            // Sticky restart (null intent): carry on with whatever the store says.
            String state = store.getState();
            if (GpsTrackStore.STATE_RECORDING.equals(state)) {
                startListening();
            } else if (!GpsTrackStore.STATE_PAUSED.equals(state)) {
                shutdown();
                return START_NOT_STICKY;
            }
        }
        running = true;
        handler.removeCallbacks(tick);
        handler.post(tick);
        return START_STICKY;
    }

    private void startListening() {
        if (listening || locationManager == null) return;
        try {
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper());
            listening = true;
            providerEnabled = isGpsEnabled(this);
        } catch (SecurityException | IllegalArgumentException e) {
            listening = false;
        }
    }

    private void stopListening() {
        if (!listening || locationManager == null) return;
        try {
            locationManager.removeUpdates(this);
        } catch (Exception ignored) {
            // Already removed.
        }
        listening = false;
    }

    @Override
    public void onLocationChanged(@NonNull Location loc) {
        store.append(
                loc.getLatitude(),
                loc.getLongitude(),
                loc.getTime() > 0 ? loc.getTime() : System.currentTimeMillis(),
                loc.hasAccuracy() ? loc.getAccuracy() : null,
                loc.hasAltitude() ? loc.getAltitude() : null,
                loc.hasSpeed() ? loc.getSpeed() : null);
    }

    @Override
    public void onProviderEnabled(@NonNull String provider) {
        providerEnabled = true;
        updateNotification();
    }

    @Override
    public void onProviderDisabled(@NonNull String provider) {
        providerEnabled = false;
        updateNotification();
    }

    /** Required below API 29; a no-op since. */
    @Override
    @Deprecated
    public void onStatusChanged(String provider, int status, Bundle extras) {
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void shutdown() {
        handler.removeCallbacks(tick);
        stopListening();
        running = false;
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {
            // Was not in the foreground.
        }
        stopSelf();
    }

    private void promote() {
        Notification n = buildNotification();
        // Typed promotion is mandatory from Android 14 and must match the
        // manifest's foregroundServiceType; it is accepted from API 29.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void updateNotification() {
        if (!running) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification());
    }

    private static String label(String activity) {
        if ("run".equals(activity)) return "Run";
        if ("cycle".equals(activity)) return "Ride";
        return "Walk";
    }

    private Notification buildNotification() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pending = null;
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            pending = PendingIntent.getActivity(
                    this, 1, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        long secs = store.getElapsedMs() / 1000L;
        String time = secs >= 3600
                ? String.format(Locale.US, "%d:%02d:%02d", secs / 3600, (secs % 3600) / 60, secs % 60)
                : String.format(Locale.US, "%d:%02d", secs / 60, secs % 60);
        // 1 mi = 1609.344 m exactly (same factor as src/lib/units.ts).
        String km = store.isMiles()
                ? String.format(Locale.US, "%.2f mi", store.getDistanceM() / 1609.344)
                : String.format(Locale.US, "%.2f km", store.getDistanceM() / 1000.0);
        boolean paused = GpsTrackStore.STATE_PAUSED.equals(store.getState());
        String text = !providerEnabled
                ? "GPS is off — turn on Location to keep recording"
                : paused ? "Paused · tap to open FitFlow" : "Recording your route · tap to open";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(label(store.getActivity()) + " · " + time + " · " + km)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setContentIntent(pending)
                .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Activity recording", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shown while FitFlow records a walk, run or ride with GPS");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }
}
