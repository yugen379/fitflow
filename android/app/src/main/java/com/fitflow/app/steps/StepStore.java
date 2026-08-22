package com.fitflow.app.steps;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

/**
 * Daily step accounting, persisted to SharedPreferences.
 *
 * This is the piece that makes counting survive the app being closed, and it is
 * entirely built around one property of the Android hardware sensor:
 *
 *   Sensor.TYPE_STEP_COUNTER reports steps SINCE LAST BOOT, and the hardware
 *   keeps counting whether or not anybody is listening.
 *
 * So the count is never "how many events did we receive" — it is a difference
 * between the raw sensor value now and the raw value we last wrote down. If the
 * process was dead for six hours, the first event after it restarts carries all
 * six hours of steps in that difference. Nothing is lost by not being running,
 * which is why this design does not need Health Connect to fill a gap.
 *
 * Two discontinuities have to be handled explicitly:
 *
 *   1. REBOOT. The counter resets to zero, so a raw value LOWER than the one we
 *      stored means the device rebooted rather than that the user un-walked.
 *      The new value is then itself the delta (steps taken since boot).
 *   2. FIRST EVER READING. There is no previous value to subtract, so the first
 *      reading only establishes the baseline and contributes nothing. Steps
 *      taken between boot and the very first listener registration on a fresh
 *      install are genuinely unknowable and are not invented.
 *
 * ## Day attribution, honestly
 *
 * Steps are filed under the local date at the moment they are OBSERVED. While
 * the foreground service is running that is the same as when they were taken.
 * If the service is killed across midnight, the steps taken before midnight are
 * observed after it and land on the new day. That is a real limitation of a
 * cumulative counter with no per-step timestamps, and it is not papered over.
 */
public final class StepStore {

    private static final String PREFS = "fitflow_steps";

    private static final String KEY_DAY = "day";
    private static final String KEY_STEPS_TODAY = "steps_today";
    private static final String KEY_LAST_RAW = "last_raw";
    private static final String KEY_HAS_BASELINE = "has_baseline";
    private static final String KEY_HISTORY = "history";

    /** Days of history retained. Beyond this the oldest entries are dropped. */
    private static final int HISTORY_LIMIT = 400;

    private final SharedPreferences prefs;

    public StepStore(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Local date as YYYY-MM-DD. Local, not UTC: a day boundary the user does not recognise is a bug. */
    public static String todayKey() {
        Calendar calendar = Calendar.getInstance();
        return String.format(
                Locale.US,
                "%04d-%02d-%02d",
                calendar.get(Calendar.YEAR),
                calendar.get(Calendar.MONTH) + 1,
                calendar.get(Calendar.DAY_OF_MONTH));
    }

    public synchronized long getStepsToday() {
        rollDayIfNeeded();
        return prefs.getLong(KEY_STEPS_TODAY, 0L);
    }

    public synchronized String getDay() {
        rollDayIfNeeded();
        return prefs.getString(KEY_DAY, todayKey());
    }

    /**
     * Fold in a raw reading from TYPE_STEP_COUNTER.
     *
     * @param rawValue cumulative steps since boot, as reported by the sensor
     * @return today's total after applying the reading
     */
    public synchronized long applyRawReading(long rawValue) {
        if (rawValue < 0) {
            // A negative cumulative counter is not physically meaningful.
            return getStepsToday();
        }

        rollDayIfNeeded();

        long stepsToday = prefs.getLong(KEY_STEPS_TODAY, 0L);
        long lastRaw = prefs.getLong(KEY_LAST_RAW, 0L);
        boolean hasBaseline = prefs.getBoolean(KEY_HAS_BASELINE, false);

        long delta;
        if (!hasBaseline) {
            // First reading ever: establish the baseline, claim nothing.
            delta = 0L;
        } else if (rawValue >= lastRaw) {
            // The normal path. Covers time the process was dead, because the
            // hardware counter kept incrementing regardless.
            delta = rawValue - lastRaw;
        } else {
            // Counter went backwards: the device rebooted and the sensor
            // restarted from zero, so the new value IS the steps since boot.
            delta = rawValue;
        }

        // A single reading cannot plausibly carry more than a few days of
        // walking. Anything larger is a sensor glitch or a counter that wrapped,
        // and folding it in would permanently corrupt the day.
        if (delta > 200000L) {
            delta = 0L;
        }

        stepsToday += delta;

        prefs.edit()
                .putLong(KEY_STEPS_TODAY, stepsToday)
                .putLong(KEY_LAST_RAW, rawValue)
                .putBoolean(KEY_HAS_BASELINE, true)
                .apply();

        return stepsToday;
    }

    /**
     * Move to a new local day if the clock has passed midnight, archiving the
     * finished day. The raw sensor baseline is deliberately NOT reset: it tracks
     * the hardware counter, which knows nothing about days.
     */
    private void rollDayIfNeeded() {
        String today = todayKey();
        String stored = prefs.getString(KEY_DAY, null);

        if (stored == null) {
            prefs.edit().putString(KEY_DAY, today).apply();
            return;
        }
        if (stored.equals(today)) {
            return;
        }

        long finished = prefs.getLong(KEY_STEPS_TODAY, 0L);
        if (finished > 0) {
            writeHistory(stored, finished);
        }

        prefs.edit()
                .putString(KEY_DAY, today)
                .putLong(KEY_STEPS_TODAY, 0L)
                .apply();
    }

    private void writeHistory(String day, long steps) {
        try {
            JSONObject history = readHistoryObject();
            // Monotonic, matching the Firestore mirror: a day never goes down.
            long existing = history.optLong(day, 0L);
            history.put(day, Math.max(existing, steps));
            trim(history);
            prefs.edit().putString(KEY_HISTORY, history.toString()).apply();
        } catch (Exception ignored) {
            // History is a convenience; today's count is the thing that matters.
        }
    }

    private JSONObject readHistoryObject() {
        try {
            String raw = prefs.getString(KEY_HISTORY, null);
            return raw == null ? new JSONObject() : new JSONObject(raw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    /** Drop the oldest keys once the map outgrows HISTORY_LIMIT. Keys sort lexicographically because they are ISO dates. */
    private void trim(JSONObject history) throws Exception {
        if (history.length() <= HISTORY_LIMIT) {
            return;
        }
        List<String> keys = new ArrayList<>();
        for (Iterator<String> it = history.keys(); it.hasNext(); ) {
            keys.add(it.next());
        }
        java.util.Collections.sort(keys);
        int excess = keys.size() - HISTORY_LIMIT;
        for (int i = 0; i < excess; i++) {
            history.remove(keys.get(i));
        }
    }

    /** Stored history INCLUDING today, as a { "YYYY-MM-DD": steps } object. */
    public synchronized JSONObject getHistory() {
        rollDayIfNeeded();
        JSONObject history = readHistoryObject();
        try {
            history.put(prefs.getString(KEY_DAY, todayKey()), prefs.getLong(KEY_STEPS_TODAY, 0L));
        } catch (Exception ignored) {
            // Fall through with whatever archived days we have.
        }
        return history;
    }
}
