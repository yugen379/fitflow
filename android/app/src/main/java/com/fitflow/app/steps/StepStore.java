package com.fitflow.app.steps;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.provider.Settings;

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
    private static final String KEY_WEIGHT_KG = "weight_kg";
    private static final String KEY_LAST_ELAPSED = "last_elapsed_ms";
    private static final String KEY_BOOT_COUNT = "boot_count";
    private static final String KEY_PEAK_RAW = "peak_raw";
    private static final String KEY_DROP_STEPS = "drop_steps";
    private static final String KEY_DETECTOR_STEPS = "detector_steps";

    // Plausibility guards — identical to src/services/backgroundStepPolicy.ts.
    static final long MAX_PLAUSIBLE_DELTA = 200000L;
    static final long MAX_STEPS_PER_SECOND = 5L;
    static final long CADENCE_SLACK_STEPS = 60L;
    static final long MAX_PLAUSIBLE_DAY_STEPS = 100000L;

    /**
     * Calorie constants, kept identical to src/lib/stepFormulas.ts. The
     * notification and the in-app card must never disagree about the same day,
     * so both sides use kcal/step = 0.04 scaled linearly by bodyweight against a
     * 70 kg reference.
     */
    private static final double KCAL_PER_STEP = 0.04d;
    private static final double REFERENCE_WEIGHT_KG = 70.0d;

    /** Days of history retained. Beyond this the oldest entries are dropped. */
    private static final int HISTORY_LIMIT = 400;

    private final SharedPreferences prefs;
    private final Context appContext;

    public StepStore(Context context) {
        this.appContext = context.getApplicationContext();
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
        return sanitizeDaySteps(prefs.getLong(KEY_STEPS_TODAY, 0L));
    }

    public synchronized String getDay() {
        rollDayIfNeeded();
        return prefs.getString(KEY_DAY, todayKey());
    }

    /**
     * Remember the user's bodyweight so the notification can show calories.
     * Ignored unless it is physically plausible — the service must never render
     * a calorie figure derived from a junk profile value.
     */
    public synchronized void setWeightKg(double weightKg) {
        if (weightKg >= 25.0d && weightKg <= 300.0d) {
            prefs.edit().putFloat(KEY_WEIGHT_KG, (float) weightKg).apply();
        }
    }

    /** Stored bodyweight, or the 70 kg reference when the profile has none. */
    public synchronized double getWeightKg() {
        float stored = prefs.getFloat(KEY_WEIGHT_KG, 0f);
        return stored >= 25f && stored <= 300f ? stored : REFERENCE_WEIGHT_KG;
    }

    /** Active kilocalories for a step count, matching stepFormulas.caloriesFor. */
    public synchronized long caloriesFor(long steps) {
        if (steps <= 0) return 0L;
        return Math.round(steps * KCAL_PER_STEP * (getWeightKg() / REFERENCE_WEIGHT_KG));
    }

    /**
     * Fold in a raw reading from TYPE_STEP_COUNTER.
     *
     * @param rawValue cumulative steps since boot, as reported by the sensor
     * @return today's total after applying the reading
     */
    public synchronized long applyRawReading(long rawValue) {
        return applyRawReading(rawValue, SystemClock.elapsedRealtime(), readBootCount());
    }

    /**
     * The arithmetic, with the device clock passed in. Mirrors
     * src/services/backgroundStepPolicy.ts line for line — change both.
     *
     * The 1,103,660-step bug: some OEM HALs drop TYPE_STEP_COUNTER to a small
     * value WITHOUT a reboot (e.g. when another listener registers) and later
     * jump back to the real cumulative total. The old "lower reading = reboot"
     * rule booked every drop as a reboot and every jump back as ~150k new
     * steps. Now: a reboot must be real, a rise must be walkable in the time
     * elapsed, and a day can never pass MAX_PLAUSIBLE_DAY_STEPS. Because a
     * drop and its jump back can be hours apart (beating the cadence check),
     * the highest raw value this boot is remembered and a return to it only
     * credits the steps walked above it.
     */
    /**
     * One TYPE_STEP_DETECTOR event. Held as a backup and credited only when the
     * counter's own delta has to be rejected (reset / jump) — never on top of a
     * healthy counter delta. Mirrors addDetectorSteps in backgroundStepPolicy.ts.
     */
    public synchronized void addDetectorSteps(long n) {
        if (n <= 0) return;
        long prev = Math.max(0L, prefs.getLong(KEY_DETECTOR_STEPS, 0L));
        prefs.edit().putLong(KEY_DETECTOR_STEPS, prev + n).apply();
    }

    synchronized long applyRawReading(long rawValue, long elapsedMs, int bootCount) {
        if (rawValue < 0) {
            // A negative cumulative counter is not physically meaningful.
            return getStepsToday();
        }

        rollDayIfNeeded();

        long stepsToday = sanitizeDaySteps(prefs.getLong(KEY_STEPS_TODAY, 0L));
        long lastRaw = prefs.getLong(KEY_LAST_RAW, 0L);
        boolean hasBaseline = prefs.getBoolean(KEY_HAS_BASELINE, false);
        long lastElapsed = prefs.getLong(KEY_LAST_ELAPSED, -1L);
        int lastBoot = prefs.getInt(KEY_BOOT_COUNT, -1);
        long peak = Math.max(prefs.getLong(KEY_PEAK_RAW, -1L), lastRaw);
        long dropSteps = lastRaw < peak ? Math.max(0L, prefs.getLong(KEY_DROP_STEPS, 0L)) : 0L;
        boolean fresh = !hasBaseline || lastElapsed < 0
                || didReboot(lastBoot, bootCount, lastElapsed, elapsedMs);
        long pending = Math.max(0L, prefs.getLong(KEY_DETECTOR_STEPS, 0L));

        if (!fresh && rawValue == lastRaw) {
            // Counter unchanged: pending detector steps are not reflected yet.
            prefs.edit()
                    .putLong(KEY_STEPS_TODAY, stepsToday)
                    .putLong(KEY_LAST_ELAPSED, elapsedMs)
                    .putInt(KEY_BOOT_COUNT, bootCount)
                    .apply();
            return stepsToday;
        }

        long delta;
        if (!hasBaseline || lastElapsed < 0) {
            // First reading ever, or state saved before these guards existed:
            // establish the baseline, claim nothing.
            delta = 0L;
        } else if (didReboot(lastBoot, bootCount, lastElapsed, elapsedMs)) {
            // A REAL reboot: the counter restarted from zero, so the value is
            // the steps since boot — if it could have been walked since boot.
            delta = rawValue <= cadenceCeiling(Math.min(elapsedMs, msSinceMidnight())) ? rawValue : 0L;
        } else if (rawValue < lastRaw) {
            // Dropped without a reboot: a sensor reset, not walking.
            delta = 0L;
        } else if (lastRaw < peak && rawValue >= peak) {
            // Jump back to the real cumulative value after a drop. Only steps
            // above the old peak are new, less what the drop already credited.
            delta = rawValue - peak - dropSteps;
            if (delta > cadenceCeiling(Math.min(elapsedMs - lastElapsed, msSinceMidnight()))) {
                delta = 0L;
            }
        } else {
            // The normal path. Covers time the process was dead, because the
            // hardware counter kept incrementing regardless.
            delta = rawValue - lastRaw;
            if (delta > cadenceCeiling(Math.min(elapsedMs - lastElapsed, msSinceMidnight()))) {
                delta = 0L; // faster than a human can walk: a sensor jump
            }
        }

        if (delta < 0 || delta > MAX_PLAUSIBLE_DELTA
                || stepsToday + delta > MAX_PLAUSIBLE_DAY_STEPS) {
            delta = 0L;
        }

        if (!fresh && delta == 0L && pending > 0L) {
            // The counter moved but its delta was rejected: use the detector,
            // under the same cadence and day ceilings.
            long fallback = Math.min(pending, cadenceCeiling(elapsedMs - lastElapsed));
            delta = stepsToday + fallback <= MAX_PLAUSIBLE_DAY_STEPS ? fallback : 0L;
        }

        stepsToday += delta;

        long nextPeak = fresh ? rawValue : Math.max(peak, rawValue);
        long nextDropSteps = rawValue < nextPeak ? dropSteps + delta : 0L;

        prefs.edit()
                .putLong(KEY_PEAK_RAW, nextPeak)
                .putLong(KEY_DROP_STEPS, nextDropSteps)
                .putLong(KEY_DETECTOR_STEPS, 0L)
                .putLong(KEY_STEPS_TODAY, stepsToday)
                .putLong(KEY_LAST_RAW, rawValue)
                .putBoolean(KEY_HAS_BASELINE, true)
                .putLong(KEY_LAST_ELAPSED, elapsedMs)
                .putInt(KEY_BOOT_COUNT, bootCount)
                .apply();

        return stepsToday;
    }

    /**
     * Forget the raw baseline so the next reading credits nothing. Called when
     * the user switches background counting on after it was off.
     */
    public synchronized void resetBaseline() {
        prefs.edit()
                .putBoolean(KEY_HAS_BASELINE, false)
                .putLong(KEY_DROP_STEPS, 0L)
                .putLong(KEY_DETECTOR_STEPS, 0L)
                .remove(KEY_PEAK_RAW)
                .apply();
    }

    /** ms since local midnight: no single reading may credit steps from before today. */
    static long msSinceMidnight() {
        Calendar c = Calendar.getInstance();
        long now = c.getTimeInMillis();
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return Math.max(0L, now - c.getTimeInMillis());
    }

    static boolean didReboot(int lastBoot, int bootCount, long lastElapsed, long elapsedMs) {
        if (lastBoot >= 0 && bootCount >= 0) {
            return bootCount != lastBoot;
        }
        // No boot counter on this OEM: elapsed-since-boot only grows within a boot.
        return lastElapsed >= 0 && elapsedMs < lastElapsed;
    }

    /** Most steps a person could take in {@code elapsedMs}. */
    static long cadenceCeiling(long elapsedMs) {
        return (Math.max(0L, elapsedMs) / 1000L) * MAX_STEPS_PER_SECOND + CADENCE_SLACK_STEPS;
    }

    /** A stored day above the ceiling is corrupt: treat it as zero, never display it. */
    static long sanitizeDaySteps(long steps) {
        return steps > 0 && steps <= MAX_PLAUSIBLE_DAY_STEPS ? steps : 0L;
    }

    private int readBootCount() {
        try {
            return Settings.Global.getInt(appContext.getContentResolver(), Settings.Global.BOOT_COUNT, -1);
        } catch (Exception e) {
            return -1;
        }
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

        long finished = sanitizeDaySteps(prefs.getLong(KEY_STEPS_TODAY, 0L));
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
            JSONObject history = raw == null ? new JSONObject() : new JSONObject(raw);
            // Days banked by the pre-v1.6.4 counter can hold impossible totals
            // (1.1M seen in the wild). Never surface them.
            List<String> corrupt = new ArrayList<>();
            for (Iterator<String> it = history.keys(); it.hasNext(); ) {
                String day = it.next();
                if (sanitizeDaySteps(history.optLong(day, 0L)) == 0L) corrupt.add(day);
            }
            for (String day : corrupt) history.remove(day);
            return history;
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
            history.put(prefs.getString(KEY_DAY, todayKey()), sanitizeDaySteps(prefs.getLong(KEY_STEPS_TODAY, 0L)));
        } catch (Exception ignored) {
            // Fall through with whatever archived days we have.
        }
        return history;
    }
}
