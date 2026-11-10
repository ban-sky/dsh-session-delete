# Changelog

## 1.0.0 — 2026-11-10

First official release.

### Added

- Red **Delete session** row as the last item of a Session’s “…” menu
  (`sidebar.workspaces.session.menu.item`, order 500).
- Confirmation dialog with the Session title; Escape / mask / Cancel dismiss it,
  focus is restored, and an in-dialog error is shown on failure.
- Permanent deletion on the Host: archive (stop activity) → wait for the Agent to
  settle (max 3 s) → close the log writer → drop pending state → detach the live
  Session → remove the Session’s own `<root>/<project>/<session-id>` directory.
- Strict path guard: only directories exactly two levels below the persistence
  root are ever removed; root, project directories and paths outside the root are
  refused.
- Idempotent behavior: a Session that is already gone is reported as
  `deleted: false, reason: "not-found"` instead of an error.
- `zh` / `en` locale, light/dark theming via `--dsw-*` tokens, new gradient
  plugin icon.

### Fixed

- Client → Host calls use the authenticated exact Fetch route
  `/api/session-delete` instead of `ctx.connection.rpc.handle()`, whose
  implementation reads `owner.webServer` without declaring the injection and
  throws `cannot get property "webServer" without inject` for third-party
  callers.
- The Client posts to a document-relative `api/session-delete`, so the route
  follows reverse proxies and Docker deployments without extra configuration.

### Verified

- DSH `0.2.1-rc.5`, Web profile, Node.js 24.
- End-to-end: create a scratch Session, delete it from the menu, confirm the row
  disappears and the Session directory is gone.
