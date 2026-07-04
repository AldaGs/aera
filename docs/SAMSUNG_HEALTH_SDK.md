# aera — Samsung Health Data SDK plugin setup

We read the Galaxy Watch 4's workouts **directly from Samsung Health** via Samsung's
Health Data SDK, instead of the (flaky) Samsung Health → Health Connect bridge.

The plugin is a small custom Capacitor plugin:

- `android/app/src/main/java/com/aera/app/SamsungHealthPlugin.kt` — native (Kotlin)
- `src/plugins/samsungHealth.ts` — JS bridge
- `src/importers/samsungHealth.ts` — maps sessions into normalized `Workout`s
- Registered in `MainActivity.java`; wired to Record → **Sync from watch**

## Why this works without Samsung's approval

Samsung's **developer mode** lets you **read** your own Samsung Health data on your
own device with no partner request. Partnership/approval is only needed to **write**
data or to **distribute publicly**. aera is personal + read-only → developer mode is
enough.

## One-time setup

### 1. Register as a Samsung developer
Create a free account at <https://developer.samsung.com>.

### 2. Download the Samsung Health Data SDK
From the Samsung Health developer site, download the SDK and copy the AAR into:

```
android/app/libs/samsung-health-data-api-1.1.0.aar
```

(If the version differs, update the filename in `android/app/build.gradle`.)
The AAR is git-ignored — each machine downloads its own.

### 3. Get your app's signature for developer mode
Developer mode is keyed to your app's package name + signing certificate hash.

- **Package name:** `com.aera.app`
- **Debug signature (SHA-256):** run in `android/`:
  ```bash
  ./gradlew signingReport
  ```
  Copy the **SHA-256** under `Variant: debug`.

### 4. Activate developer mode in Samsung Health
On the phone, in **Samsung Health**, open the hidden developer mode page (Samsung's
SDK guide: <https://developer.samsung.com/health/data/guide/developer-mode.html>)
and register `com.aera.app` + the SHA-256 from step 3, with the **Exercise** data
type, **Read** access.

> **minSdk 29 required.** The Samsung Health Data SDK AAR declares `minSdkVersion 29`,
> so `android/variables.gradle` sets `minSdkVersion = 29` (was 26 for Health Connect).
> Fine for us — the Galaxy Watch 4 companion phone runs well above Android 10.

### 5. Build & run
```bash
npm run build
npx cap sync android
npx cap open android     # ▶ Run onto your phone
```

Then in aera: **Record → Sync from watch** → grant Samsung's permission sheet.

## Real SDK shape (verified against samsung-health-data-api 1.1.0)

The initial cut guessed the API; the AAR was then introspected with `javap` (using
Android Studio's bundled JDK) and the plugin rewritten to the real model:

- `store.readData(EXERCISE)` → `List<HealthDataPoint>`; each point exposes `getUid()`
  (used as the stable dedup id) and `getValue(field)`.
- The exercise detail lives in one field: `getValue(DataType.ExerciseType.SESSIONS)`
  → `List<ExerciseSession>`. There is **no** per-point `DURATION/DISTANCE/CALORIES`
  (those were wrong guesses; `TOTAL_*` exist only as aggregate operations).
- `ExerciseSession` has fully-typed getters: `duration: Duration`, `distance: Float?`
  (m), `calories: Float` (kcal), `exerciseType: PredefinedExerciseType` (enum — its
  `.name` like `RUNNING/WALKING/BIKING/HIKING` flows straight through `mapSport`),
  `meanHeartRate`, and crucially **`route: List<ExerciseLocation>`** (lat/lng/alt/ts)
  + **`log: List<ExerciseLog>`** (per-sample `heartRate`/timestamp).

Because route + HR are embedded in the session from the normal read, the **first
build already imports full workouts with maps** — no separate associated-data call.

> To re-introspect the AAR later:
> `javap -classpath <cache>/…/samsung-health-data-api-1.1.0-api.jar \`
> `'com.samsung.android.sdk.health.data.data.entries.ExerciseSession'`

### Note: permission method name
Capacitor's `Plugin` already defines `requestPermissions(PluginCall)`, so ours is
named **`requestHealthPermissions`** (matched in `plugins/samsungHealth.ts`).

## Route + HR need their own read permissions
On-device, EXERCISE-only reads returned sessions with **empty** `getRoute()`/`getLog()`.
`ExerciseType` exposes no associated-read builder (only `SleepType` does), so route/HR
are **not** associated data here — they're gated behind separate read permissions, like
Health Connect's ExerciseRoute grant. The plugin now requests **EXERCISE +
EXERCISE_LOCATION + HEART_RATE** (EXERCISE required; the other two best-effort so a
declined location grant still imports summary data).

## Android status bar (edge-to-edge)
`targetSdk 36` forces edge-to-edge on Android 15, so the WebView draws under the status
bar. Android does **not** expose the regular status bar via CSS `env(safe-area-inset-*)`
(only display cutouts), so the fix lives in `MainActivity.java`: an
`OnApplyWindowInsetsListener` pads the WebView by the system-bar insets.

## Staging
1. ✅ Plugin reads full sessions and compiles clean against the real AAR.
2. ⬜ On-device run: grant EXERCISE + EXERCISE_LOCATION + HEART_RATE on Samsung's sheet,
   verify an outdoor run imports with its map + HR zones. Confirm `exerciseType.name`
   values map as expected. (Pre-permission imports have no route — re-sync after.)
3. ⬜ iOS: `capacitor-health` already covers HealthKit, so Erika's phone reuses the
   normalized model without this Samsung plugin.
