/**
 * Merchant API client (M3-D3). The bearer token lives only in React memory:
 * it is never written to localStorage, sessionStorage or cookies.
 */
export class ApiError extends Error {
  constructor(status, data) {
    super((data && data.message) || `HTTP ${status}`)
    this.status = status
    this.data = data || {}
  }
}

export async function login(backendUrl, email, password) {
  const res = await fetch(`${backendUrl}/auth/user/emailpass`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.token) {
    throw new ApiError(res.status, data)
  }
  return data.token
}

export function createApi(backendUrl, token) {
  async function call(method, path, body) {
    const res = await fetch(`${backendUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "x-current-page": "designer",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new ApiError(res.status, data)
    }
    return data
  }

  return {
    state: () => call("GET", "/merchant/designer").then((d) => d.designer),
    createSession: () => call("POST", "/merchant/designer/sessions", {}).then((d) => d.session),
    session: (id) => call("GET", `/merchant/designer/sessions/${encodeURIComponent(id)}`).then((d) => d.session),
    send: (id, content, elementId) =>
      call("POST", `/merchant/designer/sessions/${encodeURIComponent(id)}/messages`, { content, element_id: elementId }),
    select: (elementId) => call("POST", "/merchant/designer/selection", { element_id: elementId }).then((d) => d.selection),
    undo: (expectedHead) => call("POST", "/merchant/designer/undo", { expected_head_revision_id: expectedHead }),
    restore: (revisionId, expectedHead) =>
      call("POST", `/merchant/designer/revisions/${encodeURIComponent(revisionId)}/restore`, {
        expected_head_revision_id: expectedHead,
      }),
    promote: () => call("POST", "/merchant/designer/promote", { revision_id: null }).then((d) => d.deployment),
    screenshot: (deploymentId, viewport) =>
      call("POST", "/merchant/designer/screenshots", { deployment_id: deploymentId, viewport }).then((d) => d.screenshot),

    /** Server-sent events over fetch (EventSource cannot send an Authorization header). */
    async stream(sessionId, onEvent, signal) {
      const res = await fetch(`${backendUrl}/merchant/designer/sessions/${encodeURIComponent(sessionId)}/events`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
      })
      if (!res.ok || !res.body) {
        throw new ApiError(res.status, {})
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const event = /^event: (.+)$/m.exec(block)?.[1]
          const data = /^data: (.+)$/m.exec(block)?.[1]
          if (event && data) {
            try {
              onEvent(event, JSON.parse(data))
            } catch {
              // Ignore malformed events; the next snapshot will bring the full state.
            }
          }
        }
      }
    },
  }
}
