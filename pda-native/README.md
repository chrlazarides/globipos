# GlobiPOS PDA — Android companion

An additional Tauri Android installer, not a replacement for the PDA PWA or POS
Terminal. App identity: `com.globipos.pda`, initial test version `0.1.0`.

The WebView opens the verified deployment `https://globipos.shop/pda/`.
The existing PDA supplies login, permissions, barcode handling and business
operations. This shell has no custom commands, device plugins, remote native
capabilities, POS database or updater. No credentials are embedded.
The initial load requires connectivity; do not assume PWA offline behaviour or
camera permissions are identical in Android WebView without device acceptance.

## GitHub test installer

Workflow: **Build PDA Android test installer**. It builds on GitHub, not in Replit,
and retains a debug-signed, sideloadable APK plus commit/hash report for 14 days.
It does not create a release, use POS signing secrets or publish updates.
The APK is for Chris's testing, not customer distribution. Debug signing may
change across runner machines: uninstalling to replace a test APK can lose its
local data. Never use it for an operational PDA with pending work.

Checks: `node --test pda-native/tests/config.test.mjs`.

## Customer release, separately approved

Before customer rollout: approve the version; provision a dedicated persistent
PDA Android signing identity through the secure secrets flow; build and verify a
release APK; extend the authenticated back-office Download App delivery to the
PDA asset. Customers must not need GitHub access. No signing keys are created,
copied or exposed by this addition.

## Android acceptance

Install on an Android 7+ handheld with current Android System WebView. Confirm
the PDA launcher is distinct from POS, normal staff login/logout and permissions,
hardware scanner wedge plus Enter, camera scan and permission handling, back
navigation, keyboard/rotation, offline restart/reconnect and pending-operation
recovery. Check account isolation. Physical scanner/camera support and offline
acceptance are unverified until these checks run.
