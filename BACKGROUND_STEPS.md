# Background step counting

How FitFlow counts steps while it is closed, and why it is built this way.

**The rule: nothing here depends on Health Connect.** Health Connect is an optional
extra source. If the user never installs it, never connects it, or uninstalls it, step
counting still works exactly the same.

---

## The four tiers

Resolved in `src/hooks/useSteps.ts`. Exactly one is ever the visible source, and the UI
always says which.

| # | Tier | Counts with app closed? | Needs |
|---|------|--------------------------|-------|
| 1 | **FitFlow foreground service** (`android/.../steps/`) | **Yes** | Android build, hardware step sensor, `ACTIVITY_RECOGNITION` |
| 2 | Health Connect (`services/healthService.ts`) | Yes | Health Connect installed + connected — **optional** |
| 3 | Hardware counter, foreground only (`lib/nativePedometer.ts`) | No | `@capgo/capacitor-pedometer`, `ACTIVITY_RECOGNITION` |
| 4 | Accelerometer heuristic (`lib/pedometer.ts`) | No | Any browser with `devicemotion` |

Tiers 3 and 4 feed the same local day store; tiers 1 and 2 fold in on top with a `max`,
never an overwrite, so the number cannot jump backwards when one tier hands over to
another.

---

## Why a foreground service, specifically

A sensor listener cannot be held from the background on modern Android:

- a **plain `Service`** is killed by background-execution limits within minutes;
- **WorkManager / JobScheduler** are *scheduled*, not continuous, and cannot hold a
  sensor subscription at all;
- a **foreground service** with its mandatory ongoing notification is the only sanctioned
  way to keep a sensor subscription open indefinitely.

The notification is the deal being struck: the user always sees that this is running.

### The Android 14+ typed-service rules

The app targets SDK 36, so the service must declare a type and hold the matching
permission or `startForeground()` throws.

```xml
<service android:name=".steps.StepCounterService"
         android:foregroundServiceType="health" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_HEALTH" />
```

`health` is the right type for three independent reasons:

1. Google documents it as covering *"long-running use cases to support apps in the fitness
   category such as exercise trackers."*
2. It accepts `ACTIVITY_RECOGNITION` as its prerequisite runtime permission — which this
   feature needs anyway to read the sensor.
3. It is **not** on Android 15's list of types that may not be started from a
   `BOOT_COMPLETED` receiver (`dataSync`, `camera`, `mediaPlayback`, `phoneCall`,
   `mediaProjection`, `microphone`). `dataSync` would have failed this test and broken
   reboot recovery.

The `BODY_SENSORS_BACKGROUND` / `READ_HEALTH_DATA_IN_BACKGROUND` caveat on the `health`
type does **not** apply here: it covers body sensors such as heart rate.
`TYPE_STEP_COUNTER` is not a body sensor and is gated by `ACTIVITY_RECOGNITION`.

---

## The counting arithmetic

`Sensor.TYPE_STEP_COUNTER` reports **steps since last boot**, and the hardware keeps
counting whether or not anything is listening. So the count is never "how many events did
we receive" — it is a difference between the raw value now and the raw value last written
down.

```
delta = raw >= lastRaw ? raw - lastRaw : raw
```

**This is the whole mechanism.** If the process was dead for six hours, the first reading
after it restarts carries all six hours in that difference. Nothing is lost by not
running, which is exactly why Health Connect is not needed to fill a gap.

Three discontinuities are handled explicitly:

- **Reboot** — the counter resets to zero, so a reading *lower* than the stored one means
  a restart, and the new value is itself the delta. Treating it as a subtraction would
  produce a large negative and wipe the day.
- **First reading ever** — nothing to subtract from, so it only establishes the baseline
  and claims nothing. Steps between boot and first-ever registration are genuinely
  unknowable and are not invented.
- **Midnight** — the day total resets but the **raw baseline is deliberately carried
  over**, because the hardware counter knows nothing about days. Resetting it would make
  the first reading after midnight look like a reboot and gift the user a full day.

Implemented in `StepStore.java`, mirrored line-for-line in
`src/services/backgroundStepPolicy.ts` so `npm run proof:steps` can prove it — the reboot
case is otherwise close to untestable, since proving it on a device means rebooting the
phone mid-walk.

> **If you change the arithmetic in one, change it in the other.**

---

## The three permissions

They fail independently, so the UI (`components/BackgroundStepsCard.tsx`) shows them as
three separate rows rather than one button that silently half-works.

| Grant | Required? | What breaks without it |
|-------|-----------|------------------------|
| `ACTIVITY_RECOGNITION` | **Yes** | Nothing counts at all. Also the prerequisite for a legal `health` FGS. |
| `POST_NOTIFICATIONS` | No | Counting still works; the user cannot see that it is on. |
| Battery-optimisation exemption | No, but decisive | OEM power managers (Xiaomi, Samsung, Huawei) kill even a foreground service after some hours, and counting silently stops overnight. |

### Why the battery exemption is not a one-tap dialog

The direct `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` dialog requires the
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` permission, which is **flagged** and needs its own
Play Console policy declaration and review. Instead the app opens the system
battery-optimisation *list* (`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`), which needs
no permission and lands the user on the same toggle. Switching to the one-tap dialog means
adding the flagged permission **and** filing the declaration.

---

## Honest limits

Stated in the app, not just here:

- **No hardware step sensor → this tier is unavailable.** Falls back to the in-app
  accelerometer, which only counts while the app is open.
- **Steps between a reboot and the service restarting are lost.** The boot receiver keeps
  that window to seconds.
- **If the service is killed across midnight**, steps taken before midnight are observed
  afterwards and land on the new day. A cumulative counter carries no per-step timestamps,
  so this cannot be corrected after the fact.
- **iOS has no equivalent here.** The service is Android-only; iOS falls back to tiers 3
  and 4.

---

## Files

```
android/app/src/main/java/com/fitflow/app/steps/
  StepCounterService.java     foreground service, sensor listener, notification
  StepStore.java              daily accounting + reboot/midnight handling
  BootReceiver.java           restart after reboot / app update
  BackgroundStepsPlugin.java  Capacitor bridge (permissions, control, reads)

src/lib/backgroundSteps.ts            typed wrapper over the plugin
src/services/backgroundStepPolicy.ts  the arithmetic, mirrored + proven
src/components/BackgroundStepsCard.tsx  the three-permission UI
src/hooks/useSteps.ts                 tier resolution
```

Gate: `npm run proof:steps`.

## Play Console

See `PLAY_DATA_SAFETY.md` § 4. The foreground-service-type declaration requires a
demonstration **video**; `RECEIVE_BOOT_COMPLETED` and `ACTIVITY_RECOGNITION` need stated
purposes. Data Safety answers are unchanged — step counts were already declared under
*Health and fitness → Fitness info*.
