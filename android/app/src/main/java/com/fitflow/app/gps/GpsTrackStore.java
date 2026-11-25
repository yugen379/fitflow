package com.fitflow.app.gps;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Durable storage for the GPS session in progress.
 *
 * Points go to an append-only CSV in the app's private files dir, one line per
 * fix, written as they arrive. Session state (activity, running/paused, active
 * time, segment) lives in SharedPreferences. Both survive the WebView being
 * destroyed and the process being killed, so a recording is never lost just
 * because Android reclaimed the app's memory mid-run; the web layer re-reads
 * everything with getCurrent() when it comes back.
 *
 * Exactly one session exists at a time. It is cleared only by an explicit
 * clear() after the web layer has saved it.
 */
public class GpsTrackStore {

    public static final String STATE_IDLE = "idle";
    public static final String STATE_RECORDING = "recording";
    public static final String STATE_PAUSED = "paused";
    public static final String STATE_STOPPED = "stopped";

    private static final String PREFS = "fitflow_gps_session";
    private static final String FILE = "gps_session.csv";

    private final Context context;

    public GpsTrackStore(Context context) {
        this.context = context.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private File file() {
        return new File(context.getFilesDir(), FILE);
    }

    // ------------------------------------------------------------------ state

    public synchronized String getState() {
        return prefs().getString("state", STATE_IDLE);
    }

    public synchronized String getActivity() {
        return prefs().getString("activity", "walk");
    }

    public synchronized int getSegment() {
        return prefs().getInt("segment", 0);
    }

    public synchronized long getStartedAt() {
        return prefs().getLong("startedAt", 0L);
    }

    public synchronized int getPointCount() {
        return prefs().getInt("count", 0);
    }

    public synchronized double getDistanceM() {
        return Double.longBitsToDouble(prefs().getLong("distanceBits", Double.doubleToLongBits(0d)));
    }

    /** Active (non-paused) milliseconds, live. */
    public synchronized long getElapsedMs() {
        SharedPreferences p = prefs();
        long active = p.getLong("activeMs", 0L);
        if (STATE_RECORDING.equals(p.getString("state", STATE_IDLE))) {
            long resumedAt = p.getLong("resumedAt", 0L);
            if (resumedAt > 0) active += Math.max(0L, System.currentTimeMillis() - resumedAt);
        }
        return active;
    }

    public synchronized void begin(String activity) {
        //noinspection ResultOfMethodCallIgnored
        file().delete();
        long now = System.currentTimeMillis();
        prefs().edit()
                .clear()
                .putString("state", STATE_RECORDING)
                .putString("activity", activity)
                .putLong("startedAt", now)
                .putLong("resumedAt", now)
                .putLong("activeMs", 0L)
                .putInt("segment", 0)
                .putInt("count", 0)
                .commit();
    }

    public synchronized void pause() {
        if (!STATE_RECORDING.equals(getState())) return;
        long active = getElapsedMs();
        prefs().edit().putString("state", STATE_PAUSED).putLong("activeMs", active).putLong("resumedAt", 0L).commit();
    }

    public synchronized void resume() {
        if (!STATE_PAUSED.equals(getState())) return;
        prefs().edit()
                .putString("state", STATE_RECORDING)
                .putLong("resumedAt", System.currentTimeMillis())
                .putInt("segment", getSegment() + 1)
                .putBoolean("hasLast", false)
                .commit();
    }

    public synchronized void finish() {
        String s = getState();
        if (STATE_IDLE.equals(s) || STATE_STOPPED.equals(s)) return;
        long active = getElapsedMs();
        prefs().edit().putString("state", STATE_STOPPED).putLong("activeMs", active).putLong("resumedAt", 0L).commit();
    }

    public synchronized void clear() {
        //noinspection ResultOfMethodCallIgnored
        file().delete();
        prefs().edit().clear().commit();
    }

    // ----------------------------------------------------------------- points

    /**
     * Append one fix. Also keeps a rough running distance for the notification
     * (accuracy-gated, spike-gated). The in-app numbers come from the full
     * filter + smoother in src/lib/gpsMath.ts and are the ones that get saved.
     */
    public synchronized void append(double lat, double lng, long t, Float acc, Double alt, Float spd) {
        if (!STATE_RECORDING.equals(getState())) return;
        int seg = getSegment();
        String line = String.format(Locale.US, "%.7f,%.7f,%d,%s,%s,%s,%d\n",
                lat, lng, t,
                acc == null ? "" : String.format(Locale.US, "%.1f", acc),
                alt == null ? "" : String.format(Locale.US, "%.1f", alt),
                spd == null ? "" : String.format(Locale.US, "%.2f", spd),
                seg);
        try (FileOutputStream out = new FileOutputStream(file(), true)) {
            out.write(line.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            return;
        }

        SharedPreferences p = prefs();
        SharedPreferences.Editor ed = p.edit().putInt("count", p.getInt("count", 0) + 1);
        if (acc == null || acc <= 25f) {
            if (p.getBoolean("hasLast", false)) {
                double lastLat = Double.longBitsToDouble(p.getLong("lastLat", 0L));
                double lastLng = Double.longBitsToDouble(p.getLong("lastLng", 0L));
                long lastT = p.getLong("lastT", 0L);
                double d = haversine(lastLat, lastLng, lat, lng);
                double dt = Math.max(0.001, (t - lastT) / 1000.0);
                double vmax = "cycle".equals(getActivity()) ? 25 : "run".equals(getActivity()) ? 8 : 4;
                float radius = acc == null ? 5f : acc;
                if (d / dt <= vmax && d >= radius) {
                    ed.putLong("distanceBits", Double.doubleToLongBits(getDistanceM() + d));
                    ed.putLong("lastLat", Double.doubleToLongBits(lat)).putLong("lastLng", Double.doubleToLongBits(lng)).putLong("lastT", t);
                }
            } else {
                ed.putBoolean("hasLast", true)
                        .putLong("lastLat", Double.doubleToLongBits(lat)).putLong("lastLng", Double.doubleToLongBits(lng)).putLong("lastT", t);
            }
        }
        ed.apply();
    }

    /** Points from index `since` (0-based line number) onward. */
    public synchronized JSONArray readPoints(int since) {
        JSONArray arr = new JSONArray();
        File f = file();
        if (!f.exists()) return arr;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            int i = 0;
            while ((line = r.readLine()) != null) {
                if (i++ < since) continue;
                String[] c = line.split(",", -1);
                if (c.length < 7) continue; // a torn final line from a kill mid-write
                try {
                    JSONObject o = new JSONObject();
                    o.put("lat", Double.parseDouble(c[0]));
                    o.put("lng", Double.parseDouble(c[1]));
                    o.put("t", Long.parseLong(c[2]));
                    if (!c[3].isEmpty()) o.put("acc", Double.parseDouble(c[3]));
                    if (!c[4].isEmpty()) o.put("alt", Double.parseDouble(c[4]));
                    if (!c[5].isEmpty()) o.put("spd", Double.parseDouble(c[5]));
                    o.put("seg", Integer.parseInt(c[6].trim()));
                    arr.put(o);
                } catch (Exception ignored) {
                    // Skip a malformed line rather than lose the session.
                }
            }
        } catch (IOException ignored) {
            // Return what was read.
        }
        return arr;
    }

    static double haversine(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371008.8;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
    }
}
