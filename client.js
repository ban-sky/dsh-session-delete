/**
 * Client half of `dsh-session-delete`.
 *
 * Adds one destructive row at the bottom of a Session's "..." menu and a
 * confirmation dialog on the frame-wide overlay. The dialog first archives the
 * Session (which stops running work and clears the selection), then asks the
 * Host to delete the Session's log directory, then refreshes the Session list.
 *
 * @module dsh-session-delete/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory(require) {
    const React = require('react')
    const { useEffect, useRef, useState, useSyncExternalStore } = React
    const h = React.createElement

    const NS = 'session-delete'
    const ROUTE = 'api/session-delete'
    const MENU_SLOT = 'sidebar.workspaces.session.menu.item'
    const OVERLAY_SLOT = 'shell.overlay'

    const zh = {
      'menu.deleteSession': '删除会话',
      'confirm.title': '删除会话？',
      'confirm.desc': '“{title}”将从会话列表和磁盘中永久删除，且无法恢复。',
      'confirm.cancel': '取消',
      'confirm.delete': '删除',
      'confirm.deleting': '删除中…',
      'error.connection': '无法连接 Host，会话未删除。',
      'error.delete': '删除失败，会话未删除。',
      'error.busy': '会话仍在运行，请等它停止后再试。',
      'error.refused': '出于安全考虑，已拒绝删除该会话。',
      'error.bad-request': '请求无效，会话未删除。',
      'error.delete-failed': '会话已归档，但磁盘文件删除失败。',
      'error.unauthorized': '登录状态已失效，请刷新页面后重试。',
      'error.http': '删除请求失败（HTTP {status}），会话未删除。',
    }

    const en = {
      'menu.deleteSession': 'Delete session',
      'confirm.title': 'Delete this session?',
      'confirm.desc': '“{title}” will be permanently removed from the session list and from disk. This cannot be undone.',
      'confirm.cancel': 'Cancel',
      'confirm.delete': 'Delete',
      'confirm.deleting': 'Deleting…',
      'error.connection': 'Cannot reach the Host; the session was not deleted.',
      'error.delete': 'Delete failed; the session was not deleted.',
      'error.busy': 'The session is still running; try again once it stops.',
      'error.refused': 'Refusing to delete that path for safety.',
      'error.bad-request': 'Invalid request; the session was not deleted.',
      'error.delete-failed': 'The session was archived, but its files could not be removed.',
      'error.unauthorized': 'Your sign-in has expired. Refresh the page and try again.',
      'error.http': 'The delete request failed (HTTP {status}); the session was not deleted.',
    }

    /**
     * Host error code → locale key. `delete-failed` is special: the Host may
     * have already closed the log writer, so the row stays archived instead
     * of being unarchived.
     */
    const ERROR_KEYS = {
      'busy': 'error.busy',
      'refused': 'error.refused',
      'bad-request': 'error.bad-request',
      'delete-failed': 'error.delete-failed',
    }

    // ---------------------------------------------------------------------
    // Shared confirmation request (module scope: the menu row opens it and
    // the overlay dialog consumes it).
    // ---------------------------------------------------------------------

    /** @type {{sessionId: string, displayTitle: string} | null} */
    let request = null
    const listeners = new Set()

    const subscribe = (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const getSnapshot = () => request
    const emit = () => {
      for (const listener of listeners) listener()
    }
    const openConfirm = (next) => {
      request = { ...next, previousFocus: typeof document !== 'undefined' ? document.activeElement : null }
      emit()
    }
    const closeConfirm = () => {
      if (request === null) return
      request = null
      emit()
    }

    /**
     * Call the Host's exact Fetch route. The path is document-relative (the
     * same convention as DSH's own `/api` client calls), so the request still
     * lands on the right origin when the UI is served under a proxy prefix.
     * The browser attaches the signed session cookie automatically.
     *
     * @param {string} sessionId - Session to delete.
     * @returns {Promise<{ok: boolean, value?: unknown, error?: {code?: string, message?: string}}>}
     */
    const postDelete = async (sessionId) => {
      const response = await fetch(ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (response.status === 401 || response.status === 403) {
        const error = new Error('unauthorized')
        error.code = 'unauthorized'
        throw error
      }
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        error.code = 'http'
        error.status = response.status
        throw error
      }
      return await response.json()
    }

    // ---------------------------------------------------------------------
    // Styles. Only `--dsw-alias-*` / `--dsw-*` theme tokens are referenced so
    // the row follows the active light/dark theme. Class names are prefixed
    // with `dsd-` to stay out of every shipped stylesheet's way.
    // ---------------------------------------------------------------------

    const CSS = `
.dsd-menu-item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;cursor:pointer;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary);text-align:left}
.dsd-menu-item:hover:not(:disabled),.dsd-menu-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover));outline:none}
.dsd-menu-item-icon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-state-error-primary)}
.dsd-menu-item-icon svg{width:14px;height:14px;display:block}
.dsd-menu-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px;pointer-events:auto}
.dsd-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;backdrop-filter:var(--dsw-mask-blur);background:var(--dsw-alias-bg-mask-1);pointer-events:auto}
.dsd-dialog{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;gap:16px;width:min(380px,100%);padding:22px 0 20px;border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}
.dsd-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:0 14px 0 24px}
.dsd-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsd-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:var(--dsw-radius-sm);background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:18px;line-height:1;padding:0}
.dsd-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsd-close:disabled{opacity:.4;cursor:default}
.dsd-description{margin:0;padding:0 24px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);word-break:break-word}
.dsd-error{margin:0;padding:0 24px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary);word-break:break-word}
.dsd-footer{display:flex;justify-content:flex-end;gap:8px;padding:0 24px}
.dsd-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;border:none;border-radius:var(--dsw-radius-md);cursor:pointer;font-size:14px;line-height:22px;padding:0 14px;background:transparent;color:var(--dsw-alias-label-primary)}
.dsd-button:disabled{opacity:.4;cursor:default}
.dsd-button-outline{border:.5px solid var(--dsw-alias-border-l3)}
.dsd-button-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsd-button-danger{color:var(--dsw-alias-state-error-primary)}
.dsd-button-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover))}
`

    // ---------------------------------------------------------------------
    // Icons (14px, stroke uses currentColor).
    // ---------------------------------------------------------------------

    const TrashIcon = () =>
      h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        h('path', { d: 'M1.28149 3.88831H14.7187' }),
        h('path', {
          d: 'M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833',
        }),
        h('path', {
          d: 'M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831',
        }),
        h('path', { d: 'M6.44946 6.98926V11.1238' }),
        h('path', { d: 'M9.55054 6.98926V11.1238' }),
      )

    /**
     * Build the Client half.
     * @param {object} ctx - Client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-delete: dictionaries')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'session-delete'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'session-delete: styles')

      /** One destructive row at the bottom of a Session's "..." menu. */
      function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, t }) {
        const [, setMenuOpen] = useMenuOpenState()
        return h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'dsd-menu-item',
            onClick: () => {
              setMenuOpen(false)
              openConfirm({ sessionId, displayTitle })
            },
          },
          h('span', { className: 'dsd-menu-item-icon', 'aria-hidden': true }, TrashIcon()),
          h('span', { className: 'dsd-menu-item-label' }, t('menu.deleteSession')),
        )
      }

      /** The confirmation dialog, rendered into the frame-wide overlay. */
      function DeleteSessionConfirmDialog({ t }) {
        const pending = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState(null)
        const dialogRef = useRef(null)
        const cancelRef = useRef(null)
        const busyRef = useRef(false)
        busyRef.current = busy

        useEffect(() => {
          if (pending === null) return undefined
          setBusy(false)
          setError(null)
          const previous = pending.previousFocus
          const focusTimer = setTimeout(() => cancelRef.current?.focus(), 0)
          const onKeyDown = (event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              if (!busyRef.current) closeConfirm()
              return
            }
            if (event.key !== 'Tab') return
            const dialog = dialogRef.current
            if (dialog === null) return
            const nodes = Array.from(
              dialog.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
              ),
            )
            if (nodes.length === 0) return
            const first = nodes[0]
            const last = nodes[nodes.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first.focus()
            }
          }
          document.addEventListener('keydown', onKeyDown, true)
          return () => {
            clearTimeout(focusTimer)
            document.removeEventListener('keydown', onKeyDown, true)
            if (previous instanceof HTMLElement && document.contains(previous)) previous.focus()
          }
        }, [pending])

        if (pending === null) return null

        const title = pending.displayTitle || pending.sessionId

        const confirm = async () => {
          if (busyRef.current) return
          setBusy(true)
          setError(null)
          const sessionId = pending.sessionId
          const uiWorkspace = ctx.get('uiWorkspace')

          // Archive first: stops running work, clears the open selection and
          // hides the row immediately. Failure is not fatal — the Host step
          // repeats the archive as a safety net.
          let archived = false
          if (uiWorkspace !== undefined) {
            try {
              await uiWorkspace.archiveSession(sessionId, { stopActivity: true })
              archived = true
            } catch {
              // The session may already be gone; let the Host decide.
            }
          }

          try {
            let result
            try {
              result = await postDelete(sessionId)
            } catch (error) {
              if (archived && uiWorkspace !== undefined && error?.code !== 'delete-failed') {
                uiWorkspace.unarchiveSession(sessionId).catch(() => {})
              }
              setBusy(false)
              if (error?.code === 'unauthorized') {
                setError(t('error.unauthorized'))
              } else if (error?.code === 'http') {
                setError(t('error.http', { status: error.status }))
              } else {
                setError(t('error.connection'))
              }
              return
            }
            if (result === null || result.ok !== true) {
              const code = result?.error?.code
              const key = code !== undefined ? ERROR_KEYS[code] : undefined
              if (code !== 'delete-failed' && archived && uiWorkspace !== undefined) {
                // The Host refused before touching anything: restore the row.
                uiWorkspace.unarchiveSession(sessionId).catch(() => {})
              }
              setBusy(false)
              setError(t(key ?? 'error.delete'))
              return
            }
            closeConfirm()
            try {
              ctx.get('sessions')?.refresh?.()?.catch?.(() => {})
            } catch {
              // The row is already gone through the archived set; a failed
              // refresh must not turn a successful delete into an error.
            }
          } catch {
            if (archived && uiWorkspace !== undefined) {
              uiWorkspace.unarchiveSession(sessionId).catch(() => {})
            }
            setBusy(false)
            setError(t('error.connection'))
          }
        }

        return h(
          'div',
          { className: 'dsd-overlay', onClick: () => { if (!busyRef.current) closeConfirm() } },
          h('div', { className: 'dsd-mask' }),
          h(
            'div',
            {
              ref: dialogRef,
              className: 'dsd-dialog',
              role: 'dialog',
              'aria-modal': true,
              'aria-labelledby': 'dsd-confirm-title',
              onClick: (event) => event.stopPropagation(),
            },
            h(
              'div',
              { className: 'dsd-header' },
              h('h2', { id: 'dsd-confirm-title', className: 'dsd-title' }, t('confirm.title')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsd-close',
                  'aria-label': t('confirm.cancel'),
                  disabled: busy,
                  onClick: () => closeConfirm(),
                },
                '×',
              ),
            ),
            h('p', { className: 'dsd-description' }, t('confirm.desc', { title })),
            error === null ? null : h('p', { className: 'dsd-error', role: 'alert' }, error),
            h(
              'div',
              { className: 'dsd-footer' },
              h(
                'button',
                {
                  ref: cancelRef,
                  type: 'button',
                  className: 'dsd-button dsd-button-outline',
                  disabled: busy,
                  onClick: () => closeConfirm(),
                },
                t('confirm.cancel'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsd-button dsd-button-outline dsd-button-danger',
                  disabled: busy,
                  onClick: () => { void confirm() },
                },
                busy ? t('confirm.deleting') : t('confirm.delete'),
              ),
            ),
          ),
        )
      }

      ctx.slots.inject(MENU_SLOT, () =>
        ctx.slots.register(
          { name: MENU_SLOT, id: 'session-delete', order: 500, locale: NS },
          DeleteSessionMenuItem,
        ),
      )

      ctx.slots.inject(OVERLAY_SLOT, () =>
        ctx.slots.register(
          { name: OVERLAY_SLOT, id: 'session-delete.confirm', order: 300, locale: NS },
          DeleteSessionConfirmDialog,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
