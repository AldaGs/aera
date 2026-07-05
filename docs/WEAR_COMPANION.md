# aera — Wear OS HR companion

A tiny Wear OS app on the Galaxy Watch streams **live heart rate** to the phone
over the Wearable Data Layer, so phone-recorded runs get real-time HR, zones and
training load. The watch also mirrors the current **interval step** and **buzzes**
on transitions.

No Samsung partnership needed: HR comes from Google's open **Health Services**
(`MeasureClient`), which works on Wear OS 3+ (Galaxy Watch 4 and up).

## Pieces

- **Watch module** `android/wear/` (applicationId `com.aera.app`, same as phone):
  - `HrService` — foreground service; Health Services HR → `/aera/hr` to phone.
  - `MainActivity` — big HR number + interval step/countdown + Start/Stop.
  - `PhoneListener` — receives `/aera/step`, `/aera/cue`, `/aera/stop`.
- **Phone** `WearBridgePlugin.kt` + `WearMessageListener.kt` — send step/cue/stop,
  receive `/aera/hr`; exposed to JS via `src/plugins/wearHr.ts`.
- **Recording** `src/record/hr.ts` wires HR into `RecordingEngine.hrProvider`;
  `LiveRecorder` shows a **Watch** chip + HR; `fireCue` also buzzes the watch.

## Why pairing works

The Data Layer only bridges two apps that share the **same `applicationId` and are
signed with the same key**. Both modules use `com.aera.app`; in one Android Studio
project the **debug keystore is shared automatically**, so debug builds pair with no
extra setup. For a release, sign `:app` and `:wear` with the same key.

## Build & run (dev)

```bash
npm run build && npx cap sync android
npx cap open android
```

1. **Pair the watch to Android Studio** — on the watch enable Developer options →
   *Wireless debugging*, then Android Studio → *Pair Devices Using Wi-Fi*.
2. Deploy the **`app`** run config to the phone.
3. Switch the run config to **`wear`** and deploy to the watch. Grant **Body
   sensors** (and notifications) on the watch when prompted.
4. On the watch, open **aera → Start**. On the phone, start a run → the recorder
   shows a **Watch** chip and live **HR**. Finish → the saved run has HR + zones.
5. Start an **interval plan** on the phone → the watch shows the step (e.g.
   *Work 3/5*) with a countdown and **buzzes** on each transition.

## Notes / gotchas

- `npx cap sync` does **not** touch `settings.gradle`'s `include ':wear'`, the
  `:wear` module, `MainActivity.java`, or the `app` wearable dependency — they
  persist across syncs.
- Health Services keeps sampling with the screen off only while the foreground
  service + ongoing notification are alive (handled by `HrService`).
- Dependency versions in `android/wear/build.gradle` (Health Services, Wearable)
  may need a bump on first build depending on the installed SDK — adjust if Gradle
  complains.
- Logcat tags: `aera-wear` (watch) and `WearBridge` (phone) trace the `/aera/*`
  round-trips.
- VO₂max is not available live; aera still estimates effort post-hoc from HR.
