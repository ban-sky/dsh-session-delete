# Changelog

## 1.1.0 — 2026-11-25

DSH 0.2.2 compatibility and DSHgo / mobile WebView polish.

### Added

- Native Session context-menu action for DSH **0.2.2+**:
  `ctx.contextMenus.register({ id: 'session-delete.delete', target: 'session',
  order: 700, danger: true })`, rendered after rename / fork / copy id /
  archive (600) with the shipped menu styling and a registered
  `contextMenu.icon` entry (`session-delete.trash`).
- Version detection through the `contextMenus` service: the legacy
  `sidebar.workspaces.session.menu.item` row (order 500) stays for DSH 0.2.1
  and is withdrawn automatically once `contextMenus` is available, so the
  action never appears twice.
- Narrow-screen dialog (≤ 759px): bottom-sheet layout, `env(safe-area-inset-*)`
  padding, 44px full-width buttons, scrollable body, `100dvh` sizing with a
  `vh` fallback, and `role="dialog"` so DSHgo’s mobile stylesheet applies.

### Changed

- README documents the two menu implementations, DSHgo behavior, and the
  compatibility matrix; `INSTALL.zh-CN.md` gained a DSHgo section.
- Verified against DSH `0.2.2-rc.5` contracts: `/api` exact fetch route,
  JSONL persistence (`stat` / `findLog` / `locate` / writer tracking),
  `workspaceRegistry.archiveSession`, `SessionStore.detachEntered`, and
  `uiWorkspace.archiveSession` are unchanged.

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
