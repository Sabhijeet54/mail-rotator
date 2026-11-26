'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.redirect) { window.location.href = d.redirect; return; }
      setErr(d.error || 'Login failed.');
    } catch {
      setErr('Could not reach the server. Try again.');
    }
    setBusy(false);
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <div className="brand">
        <span className="brand-mark">MR</span>
        <div>
          <div className="brand-name">Mail Rotator</div>
          <div className="brand-sub">Outreach</div>
        </div>
      </div>
      <h1>Sign in</h1>
      <p>Use the login your admin gave you.</p>
      {err && <div className="error-box">{err}</div>}
      <div className="field">
        <label>Email</label>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label>Password</label>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <button className="full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
