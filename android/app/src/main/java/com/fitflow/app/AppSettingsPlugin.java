package com.fitflow.app;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens this app's system "App info" page in one tap, so the user can flip the
 * Camera permission without hunting through Settings. Android does not allow
 * deep-linking straight to a single permission toggle, so ACTION_APPLICATION_DETAILS_SETTINGS
 * (App info → Permissions → Camera) is the standard, reliable one-tap target.
 */
@CapacitorPlugin(name = "AppSettings")
public class AppSettingsPlugin extends Plugin {

    @PluginMethod
    public void openCameraSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", getContext().getPackageName(), null);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Unable to open app settings", e);
        }
    }
}
