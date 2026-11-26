'use client';

export default function AccessExpiredPage() {
  async function back() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  }
  return (
    <div className="auth-card">
      <div className="auth-icon" aria-hidden>🔒</div>
      <h1>Access expired</h1>
      <p>
        Your access to Mail Rotator has ended. Either your validity period is over or the administrator
        has withdrawn access to this account.
      </p>
      <p>
        To keep using the app, please contact your administrator and ask them to renew your access.
        Once they extend it, you can sign in again with the same email and password.
      </p>
      <button className="ghost full" onClick={back}>Back to sign in</button>
    </div>
  );
}
