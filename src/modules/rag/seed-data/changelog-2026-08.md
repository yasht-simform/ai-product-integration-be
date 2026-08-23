# CloudPulse Changelog — August 2026

August's release is another patch release, version 3.5.1, shipped on August 6th to fix two bugs
that surfaced shortly after July's full-text search launch and SSO usage patterns evolved at a
few larger Azure AD-integrated Enterprise customers.

## [3.5.1] - 2026-08-06

This is a patch release, following on from 3.5.0's search endpoint and mobile app launch in July.
There are no new features in this release — just fixes.

### Fixed

- **Duplicate search results.** The `GET /v1/search` endpoint, introduced in 3.5.0, was returning
  duplicate entries for a task when that task matched a search on more than one of its labels — a
  task labeled both `urgent` and `backend`, for instance, could appear twice in the results for a
  query like `label:urgent label:backend` instead of once. Search results are now correctly
  de-duplicated by task, regardless of how many labels matched.
- **Azure AD SSO login loop.** Enterprise customers using SAML 2.0 SSO with Azure AD as their
  identity provider could encounter a login loop — being redirected back to the login page
  repeatedly instead of reaching the workspace — when a user's Azure AD group claims exceeded 200
  entries. This occurred because the SAML assertion containing that many group memberships exceeded
  an internal size limit during processing. Assertions with large group claim lists are now handled
  correctly, and affected users should be able to log in normally without any changes needed on the
  Azure AD side.
- Fixed a visual glitch in the sidebar on narrow screens, where the mobile app promotional banner
  introduced in July would occasionally reappear after being dismissed, instead of staying hidden
  for the rest of the session.

## Additional Notes

The search de-duplication bug only affected multi-label queries — a search using a single `label:`
filter, or no label filter at all, was never affected and returned correct results throughout
3.5.0's availability. Any integration built against `GET /v1/search` that was working around the
duplication by de-duplicating results client-side can safely remove that workaround, though leaving
it in place is harmless since it will simply have no effect going forward.

The Azure AD login loop was specific to organizations with unusually large or deeply nested Azure
AD group structures — most affected customers were Enterprise accounts with several hundred security
groups synced into a single user's claims. Organizations that were not experiencing login loops
prior to this release were not affected by the underlying issue and require no action; this fix is
purely corrective for the specific group-claim-size condition described above. Customers who
previously worked around the issue by trimming a user's group memberships in Azure AD to stay under
200 entries no longer need to do so, though there's no harm in leaving those changes in place either.

Both fixes apply automatically to the hosted CloudPulse service and require no configuration changes
on the customer side. As with any patch release, no database migration or API contract change
accompanies this update.
