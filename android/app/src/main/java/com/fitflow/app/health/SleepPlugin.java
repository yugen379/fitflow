package com.fitflow.app.health;

import android.content.Intent;

import androidx.activity.result.ActivityResult;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.records.SleepSessionRecord;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import kotlin.coroutines.Continuation;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlinx.coroutines.BuildersKt;

/**
 * Sleep from Health Connect (watches and bands write SleepSession records).
 *
 * capacitor-health-connect has no sleep type, so this small plugin asks for
 * READ_SLEEP and reads sessions itself, using the same connect-client the
 * other plugin ships. Health Connect's API is Kotlin coroutines; from Java the
 * suspend calls run inside runBlocking on a worker thread, never the UI thread.
 */
@CapacitorPlugin(name = "FitSleep")
public class SleepPlugin extends Plugin {

    private static final String READ_SLEEP = "android.permission.health.READ_SLEEP";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private HealthConnectClient client() {
        if (HealthConnectClient.getSdkStatus(getContext()) != HealthConnectClient.SDK_AVAILABLE) return null;
        return HealthConnectClient.getOrCreate(getContext());
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private boolean granted(HealthConnectClient c) throws InterruptedException {
        Set<String> perms = (Set<String>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
            (scope, cont) -> c.getPermissionController().getGrantedPermissions((Continuation) cont));
        return perms != null && perms.contains(READ_SLEEP);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        worker.execute(() -> {
            try {
                HealthConnectClient c = client();
                JSObject r = new JSObject();
                r.put("available", c != null);
                r.put("granted", c != null && granted(c));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not check sleep permission", e);
            }
        });
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (client() == null) {
            JSObject r = new JSObject();
            r.put("available", false);
            r.put("granted", false);
            call.resolve(r);
            return;
        }
        // One Health Connect sheet for everything FitFlow reads: the JS side
        // passes the full list, so the user is not shown two sheets in a row.
        Set<String> want = new HashSet<>(Collections.singletonList(READ_SLEEP));
        try {
            JSArray extra = call.getArray("permissions");
            if (extra != null) {
                for (int i = 0; i < extra.length(); i++) {
                    String p = extra.getString(i);
                    if (p != null && p.startsWith("android.permission.health.READ_")) want.add(p);
                }
            }
        } catch (Exception ignored) { /* sleep alone is still requested */ }
        Intent intent = PermissionController.createRequestPermissionResultContract()
            .createIntent(getContext(), want);
        startActivityForResult(call, intent, "onPermissionResult");
    }

    @ActivityCallback
    private void onPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        worker.execute(() -> {
            try {
                HealthConnectClient c = client();
                JSObject r = new JSObject();
                r.put("available", c != null);
                r.put("granted", c != null && granted(c));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not confirm sleep permission", e);
            }
        });
    }

    /**
     * Sleep sessions that ended in the last `days` days (default 2), with
     * minutes per stage. Stage codes follow SleepSessionRecord: 1 awake,
     * 2 sleeping, 3 out of bed, 4 light, 5 deep, 6 REM, 7 awake in bed.
     */
    @PluginMethod
    @SuppressWarnings({"unchecked", "rawtypes"})
    public void readSleep(PluginCall call) {
        int days = Math.max(1, Math.min(14, call.getInt("days", 2)));
        worker.execute(() -> {
            try {
                HealthConnectClient c = client();
                if (c == null || !granted(c)) {
                    JSObject r = new JSObject();
                    r.put("sessions", new JSArray());
                    r.put("granted", false);
                    call.resolve(r);
                    return;
                }
                Instant end = Instant.now();
                Instant start = end.minus(days, ChronoUnit.DAYS);
                ReadRecordsRequest<SleepSessionRecord> req = new ReadRecordsRequest<>(
                    JvmClassMappingKt.getKotlinClass(SleepSessionRecord.class),
                    TimeRangeFilter.Companion.between(start, end),
                    Collections.emptySet(),
                    true,
                    1000,
                    null);
                ReadRecordsResponse<SleepSessionRecord> resp = (ReadRecordsResponse<SleepSessionRecord>)
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                        (scope, cont) -> c.readRecords(req, (Continuation) cont));
                JSArray sessions = new JSArray();
                List<SleepSessionRecord> recs = resp.getRecords();
                for (SleepSessionRecord s : recs) {
                    JSObject o = new JSObject();
                    o.put("start", s.getStartTime().toString());
                    o.put("end", s.getEndTime().toString());
                    JSArray stages = new JSArray();
                    for (SleepSessionRecord.Stage st : s.getStages()) {
                        JSObject so = new JSObject();
                        so.put("stage", st.getStage());
                        so.put("start", st.getStartTime().toString());
                        so.put("end", st.getEndTime().toString());
                        stages.put(so);
                    }
                    o.put("stages", stages);
                    sessions.put(o);
                }
                JSObject r = new JSObject();
                r.put("sessions", sessions);
                r.put("granted", true);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not read sleep", e);
            }
        });
    }
}
