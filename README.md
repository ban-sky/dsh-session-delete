# dsh-session-delete

Permanently delete a Session from the DSH Web UI — right where you expect it:
the last row of the Session’s **“…” menu**, in red.

The built-in **归档**（archive）only hides a Session and keeps its log. This
plugin removes the Session for real:

1. **确认** — the row opens a confirmation dialog with the Session title.
2. **归档** — the Session is archived with `stopActivity`, which cancels running
   work, hides the row immediately, and clears it from the current selection.
3. **删除** — the Host closes the Session’s log writer, detaches the live
   Session, removes it from the in-memory registry, and deletes the Session’s
   own directory under the JSONL persistence root.
4. **刷新** — the Session list is refreshed, so the row disappears everywhere.

Nothing outside the Session’s own directory is touched, and the Host refuses
any path that is not exactly `<root>/<project>/<session-id>`.

## How the Client reaches the Host

The confirmation dialog calls a document-relative HTTP route:

```text
POST api/session-delete        # resolves against the UI's own base URL
{ "sessionId": "…" }
```

The Host registers it as `ctx.connection.fetch.register({ path: '/api/session-delete', … })`
inside the authenticated `/api` channel that DSH already exposes to the
browser (the same channel used by Session-log export and file upload). Auth,
Host/Origin checks and reverse-proxy forwarding are therefore identical to the
rest of the Web UI; no extra configuration is needed. The Client keeps the
leading slash off on purpose: that is DSH’s own convention, and it keeps the
request on the right origin when the UI is served under a prefix-stripping
proxy.

> **Why not `ctx.connection.rpc.handle()`?** In the currently shipped
> `dsh-client-connection`, `HostConnectionRpc.handle()` registers its route via
> `owner.effect(() => owner.webServer.register(route))`, but the Connection
> service never declares a `webServer` injection. Cordis therefore throws
> `cannot get property "webServer" without inject` for every third-party caller,
> and the route never appears (the request then answers that generic unknown
> path). The `fetch` registry does not touch `webServer`, so it works from any
> plugin context.

## Install

Source and releases: <https://github.com/ban-sky/dsh-session-delete>

### On another device from the packaged tarball

The release artifact is `dsh-session-delete-1.0.0.tgz`. Copy it to the target
device (a stable path, e.g. `/data/dsh/plugins/`), then run on that device:

```bash
dsh plugin --profile web add /data/dsh/plugins/dsh-session-delete-1.0.0.tgz
```

or, from a DSH agent on that device:

```text
plugin_manager action=install_bundle target=/data/dsh/plugins/dsh-session-delete-1.0.0.tgz
```

Both add the package to the profile, append `dsh-session-delete` to
`dsh.profile.bundles`, and report `restart-required`. Restart the DSH Web
process once, then refresh the page; the row appears at the bottom of a
Session’s “…” menu.

The tarball must stay where you put it: the profile records a `file:` dependency
on it, and a later `pnpm install` in the profile needs the file. Keeping the
tarball under the mounted DSH home (`/data/dsh/...`) survives container
recreations.

Download the same tarball straight from GitHub:

```text
https://github.com/ban-sky/dsh-session-delete/raw/main/dist/dsh-session-delete-1.0.0.tgz
```

Verify it with the published checksum:

```bash
sha256sum -c dsh-session-delete-1.0.0.tgz.sha256
```

### From the GitHub repository (clone install)

```bash
git clone https://github.com/ban-sky/dsh-session-delete /data/dsh/plugins/dsh-session-delete
dsh plugin --profile web add /data/dsh/plugins/dsh-session-delete
```

A clone install records a `link:` dependency, so `git pull` in that directory is
enough to upgrade (then restart DSH).

### From this source directory (development)

```text
plugin_manager action=install_bundle target=/data/dsh/home/插件制作/dsh-session-delete
```

or with the DSH CLI:

```bash
dsh plugin --profile web add /data/dsh/home/插件制作/dsh-session-delete
```

A `restart-required` result means a plain page refresh is not enough: restart
the DSH Web process once. After that, refresh the page; the row appears at the
bottom of a Session’s “…” menu.

### Upgrading an existing install

The profile already contains `dsh-session-delete`, so the plugin manager refuses
a second install with `already-installed`. Remove the old entry first, install
the new tarball, then restart:

```text
plugin_manager action=remove_bundle target=dsh-session-delete
plugin_manager action=install_bundle target=/data/dsh/plugins/dsh-session-delete-1.0.0.tgz
```

(Or `dsh plugin --profile web remove dsh-session-delete` followed by the `add`
command above.)

## Docker deployments

- Nothing Docker-specific is required: the Client uses a **relative** URL
  (`/api/session-delete`), so it follows whatever host/port/prefix your reverse
  proxy exposes. If `/api/*` reaches DSH (it must, for the UI itself), this route
  is reachable too.
- DSH authentication is unchanged. On deployments where DSH itself is behind an
  auth proxy (for example `ONEPANEL_DSH_AUTH_PROXY=1`), the browser’s signed
  cookie and the proxy’s trusted-host checks apply exactly as for `/api/rpc`.
- The plugin is installed into the **profile** (`/data/dsh/profiles/web`). A
  tarball install records a `file:` dependency on the `.tgz`, so keep that file
  under the mounted DSH home (for example `/data/dsh/plugins/`); a directory
  install records a `link:` and links from the source path. Either way it
  survives container restarts as long as the DSH home volume is mounted.
- After replacing the container image, verify the plugin is still enabled
  (`plugin_manager … list_plugins`, entry `include:session-delete`). If the
  profile was recreated from scratch, or `pnpm install` pruned the dependency
  because the tarball moved, re-run the install command.

## Behavior details

- Works for open, idle, and archived Sessions.
- A running Session is cancelled first; deletion waits up to 3 s for the turn to
  settle before the log writer is closed. If it is still running after that, the
  Host refuses with `busy` instead of leaving a half-deleted Session behind.
- If the Host cannot be reached, the Session is unarchived again and an error is
  shown in the dialog. HTTP 401/403 is reported as an expired sign-in.
- Deleting a Session that no longer exists is treated as success (idempotent).
- All text is localized (`zh` / `en`); styling uses only `--dsw-*` theme tokens
  and follows light/dark themes.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Error “无法连接 Host” | The page still runs the old client bundle, or the plugin was not restarted after install. Restart DSH, then hard-refresh the page. |
| Row missing from the “…” menu | `include:session-delete` is not active (see `plugin_manager list_plugins`) or the client bundle failed to load. Check the browser console for `dsh-session-delete`. |
| “登录状态已失效” (HTTP 401/403) | The browser session cookie expired; reopen the URL printed by `dsh web` and retry. |
| “会话仍在运行” (`busy`) | The turn did not stop within 3 s. Stop the Session first, then retry. |
| “磁盘文件删除失败” (`delete-failed`) | The Session is already archived/hidden but the directory could not be removed (permissions, read-only volume). Remove it manually under `<persistence root>/<project>/<session-id>`. |

## Uninstall

```text
plugin_manager action=remove_bundle target=dsh-session-delete
```

## Files

| Path | Purpose |
| --- | --- |
| `index.js` | Host half: registers the exact `/api/session-delete` fetch route and performs the deletion. |
| `client.js` | Client half: menu row, confirmation dialog, styles, locale dictionaries. |
| `cordis.patch.yml` | Bundle patch that mounts the Host half. |
| `locale/*.json` | Plugin display metadata (title / description). |
| `icon.svg` | Plugin icon. |
| `docs/deletion-rules.zh-CN.md` | The exact Host deletion rules and directory layout, for review. |
| `dist/dsh-session-delete-1.0.0.tgz` | Packaged, installable release artifact (+ `.sha256`). |
| `CHANGELOG.md` | Release notes. |

## License

MIT
