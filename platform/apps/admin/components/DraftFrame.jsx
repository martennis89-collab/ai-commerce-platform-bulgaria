"use client"

/**
 * Same-origin draft frame (M3-D1). Renders the merchant's own draft with the
 * shared storefront-core renderer. It trusts nothing it receives:
 * - messages are accepted only from the exact parent window and origin;
 * - the config is re-validated with the storefront schema before rendering;
 * - selection reports carry only a schema element id (the server re-resolves it).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import {
  DESIGNER_MESSAGE_SOURCE,
  FRAME_MESSAGE_SOURCE,
  readParentMessage,
} from "@platform/storefront-core/dist/bridge"
import { parseStorefrontConfig, resolveElement } from "@platform/storefront-schema"
import { StorefrontPage } from "@platform/storefront-core/template/components/StorefrontPage"

export default function DraftFrame() {
  const [render, setRender] = useState(null)
  const [tag, setTag] = useState(null)
  const rootRef = useRef(null)

  const post = useCallback((message) => {
    if (typeof window === "undefined" || window.parent === window) return
    window.parent.postMessage({ source: FRAME_MESSAGE_SOURCE, ...message }, window.location.origin)
  }, [])

  useEffect(() => {
    const onMessage = (event) => {
      const message = readParentMessage(event, { origin: window.location.origin, source: window.parent })
      if (!message) return
      if (message.type === "clear-selection") {
        setRender((r) => (r ? { ...r, selected_element_id: null } : r))
        return
      }
      try {
        const config = parseStorefrontConfig(message.render.config)
        setRender({ ...message.render, config })
      } catch {
        setRender(null)
      }
    }
    window.addEventListener("message", onMessage)
    post({ type: "ready" })
    return () => window.removeEventListener("message", onMessage)
  }, [post])

  // Selectable elements are keyboard-focusable and marked when selected.
  useEffect(() => {
    const root = rootRef.current
    if (!root || !render) return
    let selectedEl = null
    for (const el of root.querySelectorAll("[data-amb-element]")) {
      el.setAttribute("tabindex", "0")
      const selected = el.getAttribute("data-amb-element") === render.selected_element_id
      el.setAttribute("data-amb-selected", selected ? "true" : "false")
      if (selected) selectedEl = el
    }
    if (selectedEl) {
      const resolved = resolveElement(render.config, render.selected_element_id)
      const rect = selectedEl.getBoundingClientRect()
      setTag(resolved ? { label: resolved.label, top: Math.max(4, rect.top - 26), left: Math.max(4, rect.left) } : null)
    } else {
      setTag(null)
    }
  }, [render])

  const elementIdFrom = (target) => target?.closest?.("[data-amb-element]")?.getAttribute("data-amb-element") ?? null

  const onClick = (event) => {
    event.preventDefault()
    const id = elementIdFrom(event.target)
    if (id) post({ type: "select", element_id: id })
  }

  const onKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const id = elementIdFrom(event.target)
      if (id) {
        event.preventDefault()
        post({ type: "select", element_id: id })
      }
    }
    if (event.key === "Escape") {
      post({ type: "hover", element_id: null })
    }
  }

  return (
    <div className="amb-frame" ref={rootRef} onClickCapture={onClick} onKeyDown={onKeyDown}>
      {render ? (
        <StorefrontPage config={render.config} products={render.products} media={render.media} draft />
      ) : (
        <p className="amb-frame-loading" aria-live="polite">
          Зареждаме черновата…
        </p>
      )}
      {tag ? (
        <span className="amb-selection-tag" style={{ top: tag.top, left: tag.left }} aria-hidden="true">
          {tag.label}
        </span>
      ) : null}
    </div>
  )
}

export { DESIGNER_MESSAGE_SOURCE }
