"use client"

/**
 * The contextual designer — DESIGN.md §3. The merchant's draft is the canvas;
 * the conversation rail, revision history and preview controls frame it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DESIGNER_MESSAGE_SOURCE, readFrameMessage } from "@platform/storefront-core/dist/bridge"
import { createApi } from "../lib/api"
import { errorCopy, relativeTime, t } from "../lib/strings"

const useIsMobile = () => {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)")
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return mobile
}

export default function Designer({ backendUrl, token }) {
  const api = useMemo(() => createApi(backendUrl, token), [backendUrl, token])
  const isMobile = useIsMobile()
  const [state, setState] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [messages, setMessages] = useState([])
  const [selection, setSelection] = useState(null)
  const [notice, setNotice] = useState(null)
  const [banner, setBanner] = useState(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [device, setDevice] = useState("desktop")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [mobileView, setMobileView] = useState("store")
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(null)
  const [capturing, setCapturing] = useState(null)
  const frameRef = useRef(null)
  const frameReady = useRef(false)
  const signatureRef = useRef(null)
  const threadRef = useRef(null)

  const reload = useCallback(async () => {
    try {
      let next = await api.state()
      if (!next.session_id && next.can_design) {
        const session = await api.createSession()
        next = { ...next, session_id: session.id }
      }
      setState(next)
      setLoadError(false)
      if (next.session_id) {
        const session = await api.session(next.session_id)
        setMessages(session.messages)
      }
    } catch {
      setLoadError(true)
    }
  }, [api])

  useEffect(() => {
    reload()
  }, [reload])

  // Render the draft into the same-origin frame whenever it changes.
  const postRender = useCallback(() => {
    const frame = frameRef.current
    if (!frame?.contentWindow || !state || !frameReady.current) return
    frame.contentWindow.postMessage(
      {
        source: DESIGNER_MESSAGE_SOURCE,
        type: "render",
        render: {
          config: state.head.config,
          products: state.products,
          media: state.media,
          selected_element_id: selection?.element_id ?? null,
        },
      },
      window.location.origin
    )
  }, [state, selection])

  useEffect(() => {
    postRender()
  }, [postRender])

  const select = useCallback(
    async (elementId) => {
      setNotice(null)
      try {
        const resolved = await api.select(elementId)
        setSelection({ element_id: resolved.element_id, label: resolved.label })
        if (isMobile) setMobileView("store")
      } catch {
        setSelection(null)
        setNotice(t.selectionGone)
      }
    },
    [api, isMobile]
  )

  useEffect(() => {
    const onMessage = (event) => {
      const message = readFrameMessage(event, { origin: window.location.origin, source: frameRef.current?.contentWindow })
      if (!message) return
      if (message.type === "ready") {
        frameReady.current = true
        postRender()
      } else if (message.type === "select") {
        select(message.element_id)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [postRender, select])

  // Live session stream with reconnect; refetch full state when the draft or preview moves.
  useEffect(() => {
    if (!state?.session_id) return
    const controller = new AbortController()
    let stopped = false
    const run = async () => {
      let delay = 1000
      while (!stopped) {
        try {
          await api.stream(
            state.session_id,
            (event, data) => {
              if (event !== "designer") return
              setBanner(null)
              delay = 1000
              setMessages(data.messages)
              const signature = JSON.stringify(data.signature)
              if (signatureRef.current !== null && signatureRef.current !== signature) {
                reload()
              }
              signatureRef.current = signature
            },
            controller.signal
          )
        } catch {
          if (stopped) return
          setBanner({ kind: "warning", text: t.reconnecting })
        }
        if (stopped) return
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 10000)
      }
    }
    run()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [api, state?.session_id, reload])

  useEffect(() => {
    threadRef.current?.scrollTo?.({ top: threadRef.current.scrollHeight })
  }, [messages])

  const handleError = useCallback(
    (error) => {
      if (error?.status === 429) {
        setNotice(t.rateLimited(Math.max(1, Math.ceil((error.data.retry_after_seconds ?? 60) / 60))))
      } else if (error?.status === 409 && error.data.message === "turn_in_progress") {
        setNotice(t.turnInProgress)
      } else if (error?.status === 409) {
        setNotice(t.conflict)
        reload()
      } else if (error?.data?.message === "selection_not_found") {
        setSelection(null)
        setNotice(t.selectionGone)
      } else {
        setNotice(t.genericFailure)
      }
    },
    [reload]
  )

  const send = async (event) => {
    event?.preventDefault()
    const content = draft.trim()
    if (!content || sending || !state?.session_id) return
    setSending(true)
    setNotice(null)
    try {
      const result = await api.send(state.session_id, content, selection?.element_id ?? null)
      setMessages((m) => [...m, result.merchant_message, result.assistant_message])
      setDraft("")
    } catch (error) {
      handleError(error)
    } finally {
      setSending(false)
    }
  }

  const undo = async () => {
    if (!state) return
    setNotice(null)
    try {
      await api.undo(state.head.id)
      setNotice(t.undoDone)
      await reload()
    } catch (error) {
      handleError(error)
    }
  }

  const restore = async (revisionId) => {
    if (!state) return
    setConfirming(null)
    try {
      await api.restore(revisionId, state.head.id)
      await reload()
    } catch (error) {
      handleError(error)
    }
  }

  const promote = async () => {
    setMenuOpen(false)
    setNotice(null)
    try {
      await api.promote()
      await reload()
    } catch (error) {
      handleError(error)
    }
  }

  const screenshot = async (deploymentId, viewport) => {
    setCapturing(viewport)
    try {
      await api.screenshot(deploymentId, viewport)
      await reload()
    } catch (error) {
      handleError(error)
    } finally {
      setCapturing(null)
    }
  }

  if (loadError && !state) {
    return (
      <div className="amb-admin">
        <main className="login">
          <div className="login-panel">
            <p role="alert">{t.loadFailed}</p>
            <button className="btn btn-primary" onClick={reload}>
              {t.retry}
            </button>
          </div>
        </main>
      </div>
    )
  }
  if (!state) {
    return (
      <div className="amb-admin">
        <main className="login">
          <p aria-live="polite">{t.loading}</p>
        </main>
      </div>
    )
  }

  const latest = state.deployments[0] ?? null
  const latestReady = state.deployments.find((d) => d.status === "ready") ?? null
  const building = latest && (latest.status === "queued" || latest.status === "building")
  const unpromoted = state.head.id !== state.preview_revision_id && !(building && latest.revision_id === state.head.id)
  const busyTurn = messages.some((m) => m.role === "assistant" && (m.status === "queued" || m.status === "running"))
  const canUndo = state.can_design && Boolean(state.head.parent_revision_id)

  const promoteStatus = building ? (
    <span>{t.promoteRunning}</span>
  ) : latest?.status === "failed" ? (
    <span className="status-failed">{t.promoteFailed}</span>
  ) : latest?.status === "ready" && !unpromoted ? (
    <span className="status-ok">
      {t.promoteDone}{" "}
      {latest.url ? (
        <a href={latest.url} target="_blank" rel="noreferrer noopener">
          {t.openPreview}
        </a>
      ) : null}
    </span>
  ) : null

  // Rendered in the rail and, on phones, in the bottom sheet: each placement needs its own label/textarea id.
  const renderComposer = (placement) => (
    <form className="composer" onSubmit={send}>
      {selection ? (
        <span className="chip">
          <span>{t.selected(selection.label)}</span>
          <button type="button" aria-label={t.clearSelection} onClick={() => setSelection(null)}>
            ✕
          </button>
        </span>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {state.can_design ? (
        <div className="composer-row">
          <label className="visually-hidden" htmlFor={`designer-composer-${placement}`}>
            {t.composerLabel}
          </label>
          <textarea
            id={`designer-composer-${placement}`}
            rows={1}
            value={draft}
            placeholder={t.composerPlaceholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="btn btn-primary" type="submit" disabled={sending || busyTurn || !draft.trim()}>
            {t.send}
          </button>
        </div>
      ) : (
        <p className="notice">{t.readOnly}</p>
      )}
    </form>
  )

  const thread = (
    <div className="thread" ref={threadRef} aria-live="polite">
      {messages.length === 0 ? <p className="empty-thread">{t.emptyConversation}</p> : null}
      {messages.map((m) => (
        <Message key={m.id} message={m} headId={state.head.id} canUndo={canUndo} onUndo={undo} />
      ))}
    </div>
  )

  return (
    <div className="amb-admin">
      <div className={`designer${isMobile && unpromoted && state.can_deploy ? " has-sticky" : ""}`}>
        <header className="topbar">
          <h1 className="store-name">{state.store.name}</h1>
          <span className="badge">{t.draftBadge}</span>
          <span className="topbar-spacer" />
          <div className="segmented desktop-only" role="group" aria-label={t.store}>
            <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>
              {t.desktop}
            </button>
            <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>
              {t.mobile}
            </button>
          </div>
          <span className="promote-status desktop-only" aria-live="polite">
            {promoteStatus}
          </span>
          <button className="btn btn-text desktop-only" type="button" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}>
            {t.history}
          </button>
          <button className="btn btn-text desktop-only" type="button" onClick={undo} disabled={!canUndo}>
            {t.undo}
          </button>
          <button className="btn btn-quiet rail-toggle" type="button" onClick={() => setRailOpen((o) => !o)} aria-expanded={railOpen}>
            {t.conversation}
          </button>
          {state.can_deploy ? (
            <button className="btn btn-primary desktop-only" type="button" onClick={promote} disabled={building || !unpromoted}>
              {t.promote}
            </button>
          ) : null}
          <button
            className="btn btn-quiet mobile-only"
            type="button"
            aria-label={t.more}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            …
          </button>
          {menuOpen ? (
            <div className="menu" role="menu">
              <button className="btn" role="menuitem" type="button" onClick={() => (setHistoryOpen(true), setMenuOpen(false))}>
                {t.history}
              </button>
              <button className="btn" role="menuitem" type="button" onClick={() => (undo(), setMenuOpen(false))} disabled={!canUndo}>
                {t.undo}
              </button>
              {state.can_deploy ? (
                <button className="btn" role="menuitem" type="button" onClick={promote} disabled={building || !unpromoted}>
                  {t.promote}
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        {isMobile ? (
          <div className="segmented mobile-tabs" role="tablist" style={{ margin: "8px 12px", justifySelf: "start" }}>
            <button type="button" role="tab" aria-pressed={mobileView === "store"} onClick={() => setMobileView("store")}>
              {t.store}
            </button>
            <button type="button" role="tab" aria-pressed={mobileView === "conversation"} onClick={() => setMobileView("conversation")}>
              {t.conversation}
            </button>
          </div>
        ) : null}

        <main className="canvas" hidden={isMobile && mobileView !== "store"}>
          <div className={`frame-box${device === "mobile" && !isMobile ? " is-mobile" : ""}`}>
            <iframe ref={frameRef} src="/frame" title={t.frameTitle} />
          </div>
        </main>

        <aside
          className="rail"
          aria-label={t.conversation}
          data-open={isMobile ? String(mobileView === "conversation") : String(railOpen)}
          hidden={isMobile && mobileView !== "conversation"}
        >
          {banner ? <div className={`banner banner-${banner.kind}`}>{banner.text}</div> : null}
          {thread}
          {renderComposer("rail")}
        </aside>

        {isMobile && mobileView === "store" && selection ? <div className="sheet">{renderComposer("sheet")}</div> : null}

        {isMobile && unpromoted && state.can_deploy && !selection && mobileView === "store" ? (
          <div className="sticky-promote">
            <button className="btn btn-primary" type="button" onClick={promote} disabled={building}>
              {building ? t.promoteRunning : t.promote}
            </button>
          </div>
        ) : null}

        {historyOpen ? (
          <section className="drawer" aria-label={t.history}>
            <div className="drawer-head">
              <h2>{t.history}</h2>
              <button className="btn btn-text" type="button" onClick={() => setHistoryOpen(false)}>
                {t.close}
              </button>
            </div>
            <div className="drawer-body">
              <ul className="revision-list">
                {state.revisions.map((r) => (
                  <li key={r.id} className={`revision${r.id === state.head.id ? " is-head" : ""}`}>
                    <div className="revision-top">
                      <strong>{t.version(r.sequence)}</strong>
                      {r.id === state.head.id ? <span className="badge">{t.draftBadge}</span> : null}
                      {r.id === state.preview_revision_id ? <span className="badge badge-preview">{t.inPreviewBadge}</span> : null}
                    </div>
                    <p className="revision-summary">{r.summary}</p>
                    <div className="revision-meta">
                      {r.author_type === "merchant" ? t.authorYou : t.authorAmboras} · {relativeTime(r.created_at)}
                    </div>
                    {r.id !== state.head.id && state.can_design ? (
                      confirming === r.id ? (
                        <div className="confirm">
                          <p>{t.restoreConfirm(r.sequence)}</p>
                          <div className="confirm-actions">
                            <button className="btn btn-primary" type="button" onClick={() => restore(r.id)}>
                              {t.confirmRestore}
                            </button>
                            <button className="btn btn-quiet" type="button" onClick={() => setConfirming(null)}>
                              {t.keep}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn btn-text" type="button" onClick={() => setConfirming(r.id)}>
                          {t.restore}
                        </button>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>

              <div className="drawer-section">
                <h3>{t.screenshots}</h3>
                {latestReady && state.can_design ? (
                  <div className="shot-actions">
                    <button className="btn btn-quiet" type="button" disabled={Boolean(capturing)} onClick={() => screenshot(latestReady.id, "mobile")}>
                      {capturing === "mobile" ? t.capturing : t.takeMobile}
                    </button>
                    <button className="btn btn-quiet" type="button" disabled={Boolean(capturing)} onClick={() => screenshot(latestReady.id, "desktop")}>
                      {capturing === "desktop" ? t.capturing : t.takeDesktop}
                    </button>
                  </div>
                ) : (
                  <p className="notice">{t.noPreviewYet}</p>
                )}
                <div className="shots">
                  {state.screenshots.map((s) => (
                    <figure key={s.id} className="shot">
                      <img src={s.url} alt={`${t.screenshots} (${s.viewport === "mobile" ? t.mobile : t.desktop})`} />
                      <figcaption>
                        {s.viewport === "mobile" ? t.mobile : t.desktop} · {relativeTime(s.created_at)}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function Message({ message, headId, canUndo, onUndo }) {
  if (message.role === "merchant") {
    return (
      <div className="msg msg-merchant">
        {message.selected_element ? <span className="msg-context">{t.selected(message.selected_element.label)}</span> : null}
        {message.content}
      </div>
    )
  }
  if (message.status === "queued" || message.status === "running") {
    return (
      <div className="msg msg-assistant activity" role="status">
        <span className="status-dot" aria-hidden="true" />
        {t.running}
      </div>
    )
  }
  const lastChange = message.changes[message.changes.length - 1]
  return (
    <div className="msg msg-assistant">
      {message.status === "failed" ? <span className="msg-error">{errorCopy(message.error_code)}</span> : null}
      {message.status === "cancelled" ? <span>{t.cancelled}</span> : null}
      {message.status === "completed" && message.content ? <span>{message.content}</span> : null}
      {message.changes.map((c) => (
        <div key={c.revision_id} className="change-line">
          <span>{t.applied(c.summary, c.sequence)}</span>
          {canUndo && c === lastChange && c.revision_id === headId ? (
            <button className="btn btn-text" type="button" onClick={onUndo}>
              {t.undo}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
