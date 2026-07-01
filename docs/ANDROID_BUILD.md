# aera — Android build & Health Connect setup

This is the runbook for turning the web app into an installable Android APK that can
read your Galaxy Watch 4 workouts from Health Connect. Day-to-day development stays
in the browser (`npm run dev`); this is only needed to test the real watch data path.

## Prerequisites (on your machine)

- **Android Studio** (latest) + Android SDK
- **JDK 17** (bundled with recent Android Studio)
- A physical Android phone with **USB debugging** on (the emulator has no Health
  Connect / Samsung Health data)
- **Samsung Health** + **Health Connect** installed on the phone, with the Galaxy
  Watch 4 paired and syncing workouts into Samsung Health

## One-time: add the Android platform

```bash
npm run build            # produce dist/ (Capacitor copies this in)
npx cap add android      # generates the android/ project (first time only)
```

## Each time you change web code

```bash
npm run build
npx cap sync android     # copies dist/ + plugins into the native project
npx cap open android     # opens Android Studio; Run ▶ onto your device
```

## Health Connect manifest wiring

`capacitor-health` needs the following in
`android/app/src/main/AndroidManifest.xml`. Capacitor does **not** add these
automatically — do it once after `cap add android`.

Inside `<manifest>` (root), so the app can see the Health Connect app:

```xml
<queries>
  <package android:name="com.google.android.apps.healthdata" />
</queries>
```

Inside `<application>`, the permissions-rationale activity + Android 14 alias:

```xml
<activity
  android:name="androidx.health.connect.client.PermissionController"
  android:exported="true"
  android:permission="android.permission.health.READ_HEALTH_DATA">
  <intent-filter>
    <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
  </intent-filter>
</activity>
<activity-alias
  android:name="ViewPermissionUsageActivity"
  android:exported="true"
  android:targetActivity="com.getcapacitor.BridgeActivity"
  android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
  <intent-filter>
    <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
    <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
  </intent-filter>
</activity-alias>
```

Declare the read permissions we request (uses-permission, root of `<manifest>`):

```xml
<uses-permission android:name="android.permission.health.READ_EXERCISE" />
<uses-permission android:name="android.permission.health.READ_EXERCISE_ROUTE" />
<uses-permission android:name="android.permission.health.READ_HEART_RATE" />
<uses-permission android:name="android.permission.health.READ_DISTANCE" />
<uses-permission android:name="android.permission.health.READ_ACTIVE_CALORIES_BURNED" />
```

> Check the current [`capacitor-health` README](https://github.com/mley/capacitor-health)
> for the exact snippets — plugin versions occasionally adjust the activity names.

## Using it in the app

Record tab → **Sync from watch**:

1. First tap shows the Health Connect permission sheet — grant Exercise, Route, HR.
2. aera calls `Health.queryWorkouts({ includeRoute: true, includeHeartRate: true })`
   for the last 90 days.
3. Each run/ride is mapped to a normalized `Workout`, deduped by session id, and
   stored. Existing sessions are skipped.

## Distribution

- **Your phone:** install directly from Android Studio (Run ▶). Free.
- **Erika's phone (later):** the same repo builds an iOS target
  (`npx cap add ios`, `npx cap open ios`) — `capacitor-health` reads HealthKit there.
  Needs a Mac + Xcode; the importer code is already ecosystem-agnostic.
