# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# @capacitor-firebase/authentication bundles handlers for every provider (Facebook,
# etc.) but we only enable Google sign-in, so the Facebook SDK isn't on the classpath.
# R8 otherwise fails shrinking on these missing references — they're dead code for us.
-dontwarn com.facebook.**

# ---------------------------------------------------------------------------
# Capacitor + native plugins are loaded by REFLECTION at launch (plugin
# registration in BridgeActivity). If R8 renames/removes these classes the app
# crashes the instant it opens. Keep the bridge, every Plugin subclass, and the
# annotated method targets. (Root cause of "release APK installs but won't open".)
# ---------------------------------------------------------------------------
-keep public class * extends com.getcapacitor.Plugin
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep class io.capawesome.** { *; }

# The WebView JS bridge calls these by name from JavaScript.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# RevenueCat / Google Play Billing (added after v1.0.0 — the regression that
# broke launch once minification was on, because it had no keep rule).
-keep class com.revenuecat.purchases.** { *; }
-dontwarn com.revenuecat.purchases.**

# Firebase + Google Play services (auth, FCM, sign-in).
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**
