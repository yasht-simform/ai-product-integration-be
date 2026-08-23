# CloudPulse Changelog — February 2026

February's release was smaller in scope than January's major version bump, but it addressed two
long-requested items: quieter Slack notifications for busy channels, and broader single sign-on
support for Enterprise customers whose identity provider speaks SAML rather than OIDC. Version
3.1.0 shipped on February 11th.

## [3.1.0] - 2026-02-11

### Added

- **Threaded Slack notifications.** Previously, every task status change posted a brand-new message
  to the configured Slack channel, which meant an active board could flood a channel with dozens of
  standalone messages over the course of a day. As of 3.1.0, task status changes now post as
  threaded replies under the original task notification message instead of creating new top-level
  messages. This keeps channels readable while preserving the full history of a task's status
  changes in one place for anyone who opens the thread.
- **SAML 2.0 SSO support.** Enterprise plans previously supported single sign-on only through OIDC.
  With this release, Enterprise customers can now configure SAML 2.0 as their SSO protocol instead,
  which unlocks compatibility with identity providers that only expose a SAML integration (some
  older on-premises Active Directory Federation Services deployments, for example). OIDC remains
  fully supported and existing OIDC configurations are unaffected — SAML is an additional option,
  not a replacement.

### Improved

- **Rate limit headers on every response.** The `X-RateLimit-Remaining` header, which tells API
  consumers how many requests they have left in the current window, was previously only attached to
  responses once a client had already been rate-limited (i.e., on 429 responses). Starting with
  3.1.0, this header is included on every API response, successful or not, so integrations can
  proactively back off before hitting a limit instead of only reacting after being throttled.
- Fixed a visual glitch in the sidebar on narrow screens, where the workspace switcher's dropdown
  arrow occasionally rendered a pixel out of alignment with the label text.
- Improved loading spinner consistency across pages, extending January's unification work to the
  Slack integration settings screen, which had been missed in the previous pass.

## Why This Matters

The Slack threading change came directly out of customer feedback: teams running high-velocity
boards with dozens of daily status changes had started muting the CloudPulse Slack channel entirely
because of notification volume, which defeated the purpose of the integration. Threading keeps the
signal without the noise — the parent message still shows up in the channel, but subsequent updates
live in the thread where they're available on demand rather than pushed to everyone's face.

On the identity side, SAML 2.0 support was the single most requested Enterprise feature in the
second half of 2025 according to support ticket volume, primarily from customers migrating off
legacy on-premises identity systems that don't yet support OIDC. Setup instructions for both
protocols, including the exact metadata CloudPulse needs from an identity provider and the
attributes it expects back, are covered in the SSO Configuration Guide.

The rate-limit header change is a small one on the surface but should meaningfully reduce the
number of integrations that get throttled unexpectedly — any client polling the API on a schedule
can now read `X-RateLimit-Remaining` on a normal 200 response and slow down before it ever sees a
429, rather than having to hit the wall first to find out where the wall was.

No database migrations or configuration changes are required to pick up this release; both new
features are additive and existing integrations continue to work exactly as before.
