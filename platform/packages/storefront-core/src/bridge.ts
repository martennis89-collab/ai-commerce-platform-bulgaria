/**
 * Preview bridge protocol (Level 3 §4, M3-D1/D6).
 *
 * The designer page (parent) renders the merchant's draft inside a same-origin
 * frame and the two talk through `postMessage`. Every message is untrusted
 * input until it passes these readers:
 * - the event origin must equal the exact expected origin (never `*`);
 * - the event source must be the exact expected window (the frame's
 *   contentWindow for the parent, `window.parent` for the frame);
 * - the payload must match a strict shape.
 *
 * A selection reported through the bridge is only a hint: the server
 * re-resolves the element id against the caller's own current draft.
 */
import { ELEMENT_ID_MAX_LENGTH, ELEMENT_ID_RE } from "@platform/storefront-schema"

export const DESIGNER_MESSAGE_SOURCE = "amboras-designer" as const
export const FRAME_MESSAGE_SOURCE = "amboras-frame" as const

export type RenderPayload = {
  config: unknown
  products: unknown[]
  media: Record<string, { url: string }>
  selected_element_id: string | null
}

export type ParentToFrame =
  | { source: typeof DESIGNER_MESSAGE_SOURCE; type: "render"; render: RenderPayload }
  | { source: typeof DESIGNER_MESSAGE_SOURCE; type: "clear-selection" }

export type FrameToParent =
  | { source: typeof FRAME_MESSAGE_SOURCE; type: "ready" }
  | { source: typeof FRAME_MESSAGE_SOURCE; type: "select"; element_id: string }
  | { source: typeof FRAME_MESSAGE_SOURCE; type: "hover"; element_id: string | null }

export type BridgeEvent = { origin: string; source: unknown; data: unknown }
export type BridgeExpectation = { origin: string; source: unknown }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype

const hasExactKeys = (v: Record<string, unknown>, keys: string[]) => {
  const own = Object.keys(v)
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(v, k))
}

export function isElementId(value: unknown): value is string {
  return typeof value === "string" && value.length <= ELEMENT_ID_MAX_LENGTH && ELEMENT_ID_RE.test(value)
}

function trusted(event: BridgeEvent, expected: BridgeExpectation): boolean {
  return (
    typeof expected.origin === "string" &&
    expected.origin.length > 0 &&
    expected.origin !== "*" &&
    expected.origin !== "null" &&
    event.origin === expected.origin &&
    expected.source != null &&
    event.source === expected.source
  )
}

/** Parent side: accepts only well-formed messages from the exact frame window and origin. */
export function readFrameMessage(event: BridgeEvent, expected: BridgeExpectation): FrameToParent | null {
  if (!trusted(event, expected) || !isPlainObject(event.data)) {
    return null
  }
  const data = event.data
  if (data.source !== FRAME_MESSAGE_SOURCE) {
    return null
  }
  if (data.type === "ready" && hasExactKeys(data, ["source", "type"])) {
    return { source: FRAME_MESSAGE_SOURCE, type: "ready" }
  }
  if (data.type === "select" && hasExactKeys(data, ["source", "type", "element_id"]) && isElementId(data.element_id)) {
    return { source: FRAME_MESSAGE_SOURCE, type: "select", element_id: data.element_id }
  }
  if (
    data.type === "hover" &&
    hasExactKeys(data, ["source", "type", "element_id"]) &&
    (data.element_id === null || isElementId(data.element_id))
  ) {
    return { source: FRAME_MESSAGE_SOURCE, type: "hover", element_id: data.element_id as string | null }
  }
  return null
}

/** Frame side: accepts only well-formed messages from the exact parent window and origin. */
export function readParentMessage(event: BridgeEvent, expected: BridgeExpectation): ParentToFrame | null {
  if (!trusted(event, expected) || !isPlainObject(event.data)) {
    return null
  }
  const data = event.data
  if (data.source !== DESIGNER_MESSAGE_SOURCE) {
    return null
  }
  if (data.type === "clear-selection" && hasExactKeys(data, ["source", "type"])) {
    return { source: DESIGNER_MESSAGE_SOURCE, type: "clear-selection" }
  }
  if (data.type !== "render" || !hasExactKeys(data, ["source", "type", "render"]) || !isPlainObject(data.render)) {
    return null
  }
  const render = data.render
  if (
    !hasExactKeys(render, ["config", "products", "media", "selected_element_id"]) ||
    !Array.isArray(render.products) ||
    !isPlainObject(render.media) ||
    !(render.selected_element_id === null || isElementId(render.selected_element_id))
  ) {
    return null
  }
  const media: Record<string, { url: string }> = {}
  for (const [id, entry] of Object.entries(render.media)) {
    if (!/^media_[0-9A-Z]{26}$/.test(id) || !isPlainObject(entry) || typeof entry.url !== "string" || !/^https?:\/\//.test(entry.url)) {
      return null
    }
    media[id] = { url: entry.url }
  }
  return {
    source: DESIGNER_MESSAGE_SOURCE,
    type: "render",
    render: {
      config: render.config,
      products: render.products,
      media,
      selected_element_id: render.selected_element_id as string | null,
    },
  }
}
