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

### 5. Build & run
```bash
npm run build
npx cap sync android
npx cap open android     # ▶ Run onto your phone
```

Then in aera: **Record → Sync from watch** → grant Samsung's permission sheet.

## On-device iteration (expected)

Because the SDK can't be compiled against on the dev machine, 1–2 field names may
need confirming with Android Studio autocomplete. Everything uncertain is flagged
in `SamsungHealthPlugin.kt` as `[A] [B] [C]`:

- **[A] time accessors** — if `p.startTime` / `p.endTime` don't resolve, autocomplete
  `p.` to find the Instant getters.
- **[B] field constants** — confirm `DataType.ExerciseType.EXERCISE_TYPE / DURATION /
  DISTANCE / CALORIES` exist (autocomplete `DataType.ExerciseType.`). Fix any that
  differ. Also confirm `getValueOrNull`'s reflection finds `getValue`; if not,
  replace its body with direct `point.getValue(field)` calls.
- **[C] route + HR** — currently returns empty, so the **first successful build
  imports summary-level workouts** (type, time, distance, calories) with **no map**.
  Once summary import works, we add the associated-data read for the GPS route +
  per-sample heart rate (that unlocks the map, splits, HR zones).

### Exercise type codes
`exerciseTypeToString()` maps Samsung codes (1002=run, 1001=walk, 11007=cycle,
13001=hike). If a synced activity shows as `TYPE_<n>`, tell me the number and I'll
add it.

## Staging
1. ✅ Summary-level import (this cut) — proves the SDK path end-to-end.
2. ⬜ Route + HR associated-data read — full maps/splits/zones.
3. ⬜ iOS: `capacitor-health` already covers HealthKit, so Erika's phone reuses the
   normalized model without this Samsung plugin.
