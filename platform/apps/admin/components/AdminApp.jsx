"use client"

import { useState } from "react"
import { login } from "../lib/api"
import { t } from "../lib/strings"
import Designer from "./Designer"

/** Session holder: the bearer token lives only in this component's memory (M3-D3). */
export default function AdminApp({ backendUrl }) {
  const [token, setToken] = useState(null)
  if (!token) {
    return <Login backendUrl={backendUrl} onToken={setToken} />
  }
  return <Designer backendUrl={backendUrl} token={token} onSignOut={() => setToken(null)} />
}

function Login({ backendUrl, onToken }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onToken(await login(backendUrl, email, password))
    } catch {
      setError(t.loginFailed)
      setBusy(false)
    }
  }

  return (
    <div className="amb-admin">
      <main className="login">
        <form className="login-panel" onSubmit={submit}>
          <h1>{t.loginTitle}</h1>
          <div className="field">
            <label htmlFor="login-email">{t.email}</label>
            <input
              id="login-email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">{t.password}</label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? t.signingIn : t.signIn}
          </button>
        </form>
      </main>
    </div>
  )
}
