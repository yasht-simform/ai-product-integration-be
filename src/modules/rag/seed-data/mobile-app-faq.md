# CloudPulse Mobile App FAQ

Answers to common questions about CloudPulse Mobile, covering supported devices, notifications,
offline access, and biometric login.

## What devices does CloudPulse Mobile support?

CloudPulse Mobile v1.0 requires iOS 14 or later, or Android 10 or later. It was released as part of
v3.5.0 on July 9, 2026, and is available as a free download for both platforms — the mobile app
itself has no separate cost beyond your existing CloudPulse subscription plan.

## Does CloudPulse Mobile support push notifications?

Yes. Push notifications are one of the three headline features of v1.0, alongside offline board
viewing and biometric login. Push notifications follow the same per-board preferences configured
under **Settings → Notifications** on the web app — if you've disabled notifications for a
specific board, you won't receive a push notification for activity on that board either.

## Can I use CloudPulse without an internet connection on mobile?

Partially. CloudPulse Mobile supports offline board viewing, but it is read-only while offline —
you can browse boards, tasks, and comments that were already loaded, but you cannot create or edit
anything until connectivity is restored. Any edits made after connectivity returns are synced
automatically; there is no manual "sync now" button required.

## What happens to changes I try to make while offline?

Because offline mode is read-only, the mobile app does not queue edits made while disconnected —
editing controls (creating tasks, adding comments, changing statuses) are disabled in the UI until
the app detects it's back online. This is different from an offline-queue model; CloudPulse Mobile
v1.0 does not support making edits offline and syncing them later.

## Does CloudPulse Mobile support biometric login?

Yes. CloudPulse Mobile supports biometric login via Face ID or Touch ID on iOS, and fingerprint
authentication on Android. Biometric login can be enabled from the app's own
**Settings → Security → Biometric Login** screen after your first standard login on that device;
it is not enabled by default on install.

## Is two-factor authentication required on mobile?

Two-factor authentication (TOTP or SMS) is an account-level setting configured under
**Settings → Security** and applies the same way regardless of whether you log in from the web app
or CloudPulse Mobile — enabling it on the web enforces it on your next mobile login too. Biometric
login is a separate, additional convenience layer on top of your existing account authentication,
not a replacement for two-factor authentication.

## Does the web app have the same offline capability as the mobile app?

No. Offline viewing is exclusive to CloudPulse Mobile as of v3.5.0; the web app has no offline mode
of any kind and requires an active connection at all times.

## Which plan tiers can use CloudPulse Mobile?

CloudPulse Mobile is available to all plan tiers — Free, Pro, and Enterprise — with no
mobile-specific feature restrictions beyond whatever limits already apply to your plan (for
example, a Free workspace's 3-board cap applies whether you're viewing boards on the web or on
mobile).

## Can I manage billing from the mobile app?

CloudPulse Mobile v1.0 focuses on board and task viewing, push notifications, offline viewing, and
biometric login. Billing management (viewing invoices, updating payment methods) is performed
through **Settings → Billing** on the web app.

## How do I download CloudPulse Mobile?

CloudPulse Mobile is available from the Apple App Store for iOS 14+ devices and the Google Play
Store for Android 10+ devices. Search for "CloudPulse" in either store, or scan the QR code shown
on `cloudpulse.io/mobile`.
