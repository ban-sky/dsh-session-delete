/**
 * Host half of `dsh-session-delete`.
 *
 * DSH itself only archives Sessions ("archive" keeps the log file and hides
 * the row). This plugin adds a real deletion: the Client posts to the
 * authenticated `/api/session-delete` route, the Host stops the Session, drops
 * it from the live registry, and removes its session directory from the JSONL
 * persistence root.
 *
 * The route is registered through `ctx.connection.fetch`, the same
 * authenticated exact-route registry that shipped feature packages (Session
 * log export, file upload) use. `connection.rpc.handle` cannot be used here:
 * it reads `owner.webServer` without declaring that injection, so it throws
 * `cannot get property "webServer" without inject` for every caller outside
 * the Connection package's own fiber.
 *
 * The Client half lives in `client.js`; this file only registers the route.
 *
 * @module dsh-session-delete
 */

import { rm } from 'node:fs/promises'
import { dirname, isAbsolute, relative, sep } from 'node:path'

/** Exact route below the shared `/api` channel; must match the Client half. */
const ROUTE_PATH = '/api/session-delete'

/** Wait budget for a running Agent to settle after `stopActivity` (ms). */
const SETTLE_LIMIT_MS = 3000
const SETTLE_STEP_MS = 100

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Register the Host side of the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 */
export function apply(ctx) {
  ctx.inject(['connection', 'sessionPersistence'], (child) => {
    child.effect(
      () =>
        child.connection.fetch.register({
          path: ROUTE_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let payload
            try {
              payload = await request.json()
            } catch {
              return jsonResponse(400, failure('bad-request', 'request body is not JSON'))
            }
            const result = await deleteSession(child, payload, request.signal).catch((error) =>
              failure('delete-failed', error instanceof Error ? error.message : String(error)),
            )
            return jsonResponse(200, result)
          },
        }),
      'session-delete: fetch route',
    )
  })
}

/**
 * Permanently delete one Session.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context carrying
 *   `sessionPersistence` and (optionally) `workspaceRegistry`, `sessions`, `agents`.
 * @param {unknown} payload - `{ sessionId: string }`.
 * @param {AbortSignal | undefined} signal - Request cancellation.
 * @returns {Promise<{ok: true, value: unknown} | {ok: false, error: object}>}
 */
async function deleteSession(ctx, payload, signal) {
  const sessionId =
    payload !== null && typeof payload === 'object' ? /** @type {{sessionId?: unknown}} */ (payload).sessionId : undefined

  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200) {
    return failure('bad-request', 'sessionId must be a non-empty string')
  }

  const persistence = ctx.sessionPersistence
  const registry = ctx.get('workspaceRegistry')
  const sessions = ctx.get('sessions')
  const agents = ctx.get('agents')

  // 1. Archive as a safety net: this stops running work and (when the Client
  //    call did not already do it) hides the Session from every list. An
  //    already-archived Session resolves immediately.
  if (registry !== undefined) {
    try {
      await registry.archiveSession(sessionId, { stopActivity: true })
    } catch {
      // Unknown or concurrently removed Session: fall through to the stat check.
    }
  }

  // 2. Let a cancelled turn unwind before the log writer is closed.
  for (let elapsed = 0; elapsed < SETTLE_LIMIT_MS; elapsed += SETTLE_STEP_MS) {
    const agent = agents?.get?.(sessionId)
    if (agent === undefined || agent.status !== 'running') break
    await sleep(SETTLE_STEP_MS)
  }
  if (signal?.aborted === true) {
    return failure('cancelled', 'the delete request was cancelled')
  }
  if (agents?.get?.(sessionId)?.status === 'running') {
    // A still-running turn can write into the directory again after the rm.
    // Refuse instead of leaving a half-deleted Session behind.
    return failure('busy', 'the Session is still running; try again once it stops')
  }

  // 3. Resolve the Session's on-disk directory. `findLog` is the backend's own
  //    exact lookup; `locate` is the pure fallback for a never-written Session.
  const snapshot = await persistence.stat(sessionId)
  if (snapshot === undefined) {
    return { ok: true, value: { deleted: false, reason: 'not-found' } }
  }

  let logPath
  if (typeof persistence.findLog === 'function') {
    const located = await persistence.findLog(sessionId)
    logPath = located?.sourcePath
  }
  if (logPath === undefined) {
    logPath = persistence.locate(snapshot.header).path
  }

  const dir = dirname(logPath)
  if (!isOwnedSessionDirectory(persistence.root, dir)) {
    return failure('refused', 'refusing to delete a path that is not a Session directory')
  }

  // 4. Close the write handle first: closing drains buffered events and
  //    releases the handle, so the directory cannot reappear afterwards.
  const tracker = persistence.tracker
  const writer = tracker?.writers?.get?.(sessionId)
  if (writer !== null && writer !== undefined && typeof writer.close === 'function') {
    try {
      await writer.close()
    } catch {
      // Closing is best-effort; the rm below is still the user's request.
    }
  }
  tracker?.pending?.delete?.(sessionId)

  // 5. Drop the Session from the live registry so `sessionController.list`
  //    (persistence + live Sessions) no longer returns it.
  const entry = sessions?.store?.get?.(sessionId)
  if (entry !== undefined) {
    try {
      sessions.detachEntered(entry)
    } catch {
      // A concurrent disposal is fine.
    }
  }

  // 6. Remove the directory that the session alone owns.
  await rm(dir, { recursive: true, force: true, maxRetries: 2 })

  return { ok: true, value: { deleted: true } }
}

/**
 * True when `dir` is exactly `<root>/<project>/<encoded-session-id>`.
 * Never accept the root, a project directory, or anything outside the root.
 *
 * @param {string} root - Configured persistence root.
 * @param {string} dir - Candidate Session directory.
 * @returns {boolean}
 */
function isOwnedSessionDirectory(root, dir) {
  if (typeof root !== 'string' || root.length === 0) return false
  const rel = relative(root, dir)
  if (rel.length === 0 || isAbsolute(rel)) return false
  const parts = rel.split(sep)
  return parts.length === 2 && parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

/**
 * Build a JSON response for the exact Fetch route.
 *
 * @param {number} status - HTTP status code.
 * @param {unknown} body - JSON-serializable result.
 * @returns {Response}
 */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * Build an RPC failure payload.
 *
 * @param {string} code - Machine-readable error code.
 * @param {string} message - Human-readable message.
 * @param {Record<string, unknown>} [details] - Extra structured data.
 * @returns {{ok: false, error: {code: string, message: string, details: Record<string, unknown>}}}
 */
function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } }
}
