package com.fitflow.app.review;

import android.app.Activity;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/**
 * Google Play In-App Review.
 *
 * requestReview() asks Play for a ReviewInfo and then launches the review
 * card over the app. It resolves when the flow has FINISHED, which says
 * nothing about what happened inside it. By design the Play API never tells
 * the app:
 *   - whether the card was actually shown (Play applies its own quota and may
 *     silently show nothing, e.g. if this user was asked recently),
 *   - whether the user rated, or what they rated.
 * So the result carries no "rated" field, and the app must carry on exactly
 * the same way whatever happens.
 *
 * WHEN to ask is decided in JS (src/lib/reviewPrompt.ts); this plugin only
 * performs the request.
 *
 * The card only appears on a build installed from Google Play (internal test,
 * closed test or production track). A sideloaded APK runs the whole flow
 * successfully and shows nothing — `installerIsPlay` in the result says which
 * case this is.
 *
 * Web / iOS: there is no plugin, and src/services/reviewService.ts does not
 * call it there.
 */
@CapacitorPlugin(name = "Review")
public class ReviewPlugin extends Plugin {

    private static final String PLAY_STORE = "com.android.vending";

    @PluginMethod
    public void requestReview(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            call.reject("No foreground activity", "NO_ACTIVITY");
            return;
        }
        final ReviewManager manager;
        try {
            manager = ReviewManagerFactory.create(getContext());
        } catch (Exception e) {
            call.reject("In-app review is not available", "UNAVAILABLE", e);
            return;
        }
        // Listeners run on the main thread, which is where launchReviewFlow
        // has to be called from.
        manager.requestReviewFlow().addOnCompleteListener(request -> {
            if (!request.isSuccessful()) {
                Exception e = request.getException();
                call.reject("Play could not prepare the review flow", "REQUEST_FAILED", e);
                return;
            }
            ReviewInfo info = request.getResult();
            Activity current = getActivity();
            if (current == null || current.isFinishing()) {
                call.reject("Activity went away before the review flow", "NO_ACTIVITY");
                return;
            }
            manager.launchReviewFlow(current, info).addOnCompleteListener(flow -> {
                // Completes whether or not the card was shown, and whether or
                // not the user rated. Nothing more is knowable.
                JSObject result = new JSObject();
                result.put("flowFinished", true);
                result.put("installerIsPlay", installedFromPlay());
                call.resolve(result);
            });
        });
    }

    @SuppressWarnings("deprecation") // getInstallerPackageName is the only option below API 30
    private boolean installedFromPlay() {
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            String installer;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                InstallSourceInfo info = pm.getInstallSourceInfo(pkg);
                installer = info.getInstallingPackageName();
            } else {
                installer = pm.getInstallerPackageName(pkg);
            }
            return PLAY_STORE.equals(installer);
        } catch (Exception e) {
            return false;
        }
    }
}
