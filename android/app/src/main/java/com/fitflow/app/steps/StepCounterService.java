package com.fitflow.app.steps;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * The foreground service that counts steps while FitFlow is closed.
 *
 * This is what makes background counting real rather than a claim. It holds a
 * registered listener on Sensor.TYPE_STEP_COUNTER for as long as the user wants
 * counting on, which keeps the process alive through Doze and out of reach of
 * the ordinary background-execution limits that would otherwise kill it minutes
 * after the user swipes the app away.
 *
 * ## Why a foreground service specifically
 *
 * A plain Service is killed under background execution limits. WorkManager is
 * scheduled, not continuous, and cannot hold a sensor listener. JobScheduler is
 * the same. A foreground service, with its mandatory ongoing notification, is
 * the only sanctioned way on modern Android to keep a sensor subscription open
 * indefinitely. The notification is the deal: the user always sees that this is
 * running, which is exactly the transparency it should have.
 *
 * ## Android 14+ typed foreground services
 *
 * The app targets SDK 36, so the service MUST declare a type and hold the
 * matching permission, or startForeground throws. This one is:
 *
 *   android:foregroundServiceType="health"  +  FOREGROUND_SERVICE_HEALTH
 *
 * The `health` type additionally requires a prerequisite runtime permission,
 * and ACTIVITY_RECOGNITION is on the accepted list for it. That is checked
 * before promoting to the foreground, because calling startForeground without
 * it is a guaranteed SecurityException on a real device.
 *
 * `health` is deliberately the right type here (Google documents it as covering
 * "long-running use cases to support apps in the fitness category such as
 * exercise trackers") AND it is not on Android 15's list of types that may not
 * be started from BOOT_COMPLETED — which is what lets counting resume after a
 * reboot. `dataSync` would have been wrong on both counts.
 *
 * ## Battery
 *
 * TYPE_STEP_COUNTER is a hardware-backed composite sensor. It counts on a
 * low-power co-processor without waking the CPU, and SENSOR_DELAY_NORMAL with a
 * batch latency lets the hardware buffer readings and deliver them in bursts.
 * The cost of this service is the notification, not the counting.
 */
public class StepCounterService extends Service implements SensorEventListener {

    public static final String ACTION_START = "com.fitflow.app.steps.START";
    public static final String ACTION_STOP = "com.fitflow.app.steps.STOP";

    /** Broadcast so the Capacitor plugin can push live updates to the WebView. */
    public static final String BROADCAST_STEPS = "com.fitflow.app.steps.UPDATED";
    public static final String EXTRA_STEPS = "steps";
    public static final String EXTRA_DAY = "day";

    private static final String CHANNEL_ID = "fitflow_step_counter";
    private static final int NOTIFICATION_ID = 4711;

    /**
     * Let the sensor hardware batch up to a minute of readings before waking the
     * app. Steps are not time-critical to the second, and this is the single
     * biggest lever on the power cost of staying subscribed.
     */
    private static final int BATCH_LATENCY_US = 60 * 1000 * 1000;

    /** Rewriting the notification on every burst is wasteful; once a minute is plenty. */
    private static final long NOTIFICATION_MIN_INTERVAL_MS = 60_000L;

    private SensorManager sensorManager;
    private Sensor stepCounter;
    private StepStore store;

    private boolean listening = false;
    private long lastNotificationAt = 0L;

    /** True when the service is currently promoted and counting. */
    private static volatile boolean running = false;

    public static boolean isRunning() {
        return running;
    }

    /** Whether this device has the hardware counter at all. */
    public static boolean hasStepSensor(Context context) {
        SensorManager manager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        return manager != null && manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null;
    }

    /**
     * ACTIVITY_RECOGNITION is both the sensor gate AND the prerequisite that
     * makes a `health` foreground service legal, so it is checked in one place.
     */
    public static boolean hasActivityPermission(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return true;
        }
        return ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED;
    }

    /** Start (or no-op if already running). Safe to call from the plugin or the boot receiver. */
    public static void start(Context context) {
        if (!hasActivityPermission(context) || !hasStepSensor(context)) {
            return;
        }
        Intent intent = new Intent(context, StepCounterService.class);
        intent.setAction(ACTION_START);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, StepCounterService.class);
        intent.setAction(ACTION_STOP);
        try {
            context.startService(intent);
        } catch (Exception ignored) {
            // Nothing running to stop.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            stepCounter = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        }
        store = new StepStore(this);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            shutdown();
            return START_NOT_STICKY;
        }

        if (stepCounter == null || !hasActivityPermission(this)) {
            // Promoting without the prerequisite permission throws on Android 14+,
            // so bail out cleanly rather than crashing the app on launch.
            shutdown();
            return START_NOT_STICKY;
        }

        try {
            startInForeground();
        } catch (Exception e) {
            // Missing type permission, or a background-start restriction.
            shutdown();
            return START_NOT_STICKY;
        }

        if (!listening) {
            listening = sensorManager.registerListener(
                    this, stepCounter, SensorManager.SENSOR_DELAY_NORMAL, BATCH_LATENCY_US);
        }
        running = listening;

        // START_STICKY: if the system reclaims this under memory pressure we want
        // it back. No lost steps either way — the hardware counter kept counting
        // and the next reading carries the difference — but being restarted keeps
        // the day boundary observed on time.
        return START_STICKY;
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

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event == null || event.sensor == null || event.sensor.getType() != Sensor.TYPE_STEP_COUNTER) {
            return;
        }
        if (event.values == null || event.values.length == 0) {
            return;
        }

        long raw = (long) event.values[0];
        long stepsToday = store.applyRawReading(raw);
        String day = store.getDay();

        // Tell the WebView, if it happens to be alive. When it is not, this is a
        // no-op and the count is simply read from the store on next launch.
        Intent broadcast = new Intent(BROADCAST_STEPS);
        broadcast.setPackage(getPackageName());
        broadcast.putExtra(EXTRA_STEPS, stepsToday);
        broadcast.putExtra(EXTRA_DAY, day);
        sendBroadcast(broadcast);

        maybeUpdateNotification(stepsToday);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // Step counts have no meaningful accuracy channel.
    }

    private void shutdown() {
        if (listening && sensorManager != null) {
            sensorManager.unregisterListener(this);
            listening = false;
        }
        running = false;
        try {
            // ServiceCompat, not the bare stopForeground(boolean): that overload is
            // deprecated from API 33 and the compat call picks the right one per level.
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {
            // Was not in the foreground.
        }
        stopSelf();
    }

    private void startInForeground() {
        Notification notification = buildNotification(store.getStepsToday());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ requires the type at promotion time, and it must match
            // the type declared in the manifest.
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        lastNotificationAt = SystemClock.elapsedRealtime();
    }

    private void maybeUpdateNotification(long steps) {
        long now = SystemClock.elapsedRealtime();
        if (now - lastNotificationAt < NOTIFICATION_MIN_INTERVAL_MS) {
            return;
        }
        lastNotificationAt = now;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(steps));
        }
    }

    private Notification buildNotification(long steps) {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pending = null;
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            pending = PendingIntent.getActivity(
                    this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(String.format(java.util.Locale.US, "%,d steps today", steps))
                .setContentText("FitFlow is counting your steps")
                .setSmallIcon(android.R.drawable.ic_menu_directions)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setOngoing(true)
                // Nothing here is time-sensitive, and a step count is not worth
                // interrupting anyone for.
                .setSilent(true)
                .setShowWhen(false)
                .setContentIntent(pending)
                .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Step counting",
                // MIN so it sits collapsed at the bottom of the shade with no
                // sound, no vibration and no badge. It has to exist; it does not
                // have to be noticed.
                NotificationManager.IMPORTANCE_MIN);
        channel.setDescription("Shows that FitFlow is counting your steps in the background.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
