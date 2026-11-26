'use client';

import { useEffect, useState } from 'react';
import { api, PageHeader, Field, StatCard, timeAgo } from '../../components/ui';

const blank = { name: '', email: '', password: '', days: 30 };

function status(u) {
  if (u.disabled) return ['bad', 'Blocked'];
  if (new Date(u.valid_until) <= new Date()) return ['bad', 'Expired'];
  return ['ok', 'Active'];
}

function daysLeft(u) {
  const d = Math.ceil((new Date(u.valid_until) - Date.now()) / 86400e3);
  return d > 0 ? `${d} day${d === 1 ? '' : 's'} left` : 'ended';
}

export default function AdminPage() {
  const [users, setUsers] = useState(null);
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/api/admin/users').then((d) => setUsers(d.users)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setFlash('');
    try {
      const d = await api('/api/admin/users', { method: 'POST', body: f });
      setFlash(`Login created for ${d.user.email}. Share the email and password with them.`);
      setF(blank);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  async function patch(u, body, msg) {
    setErr('');
    setFlash('');
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body });
      setFlash(msg);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  function extend(u) {
    const v = window.prompt(`Add how many days of access for ${u.email}?`, '30');
    if (v) patch(u, { addDays: v }, `Extended ${u.email} by ${v} days.`);
  }
  function setValidity(u) {
    const v = window.prompt(`Access for ${u.email} should end how many days from today?`, '30');
    if (v) patch(u, { setDays: v }, `${u.email} now has ${v} days from today.`);
  }
  function resetPassword(u) {
    const v = window.prompt(`New password for ${u.email} (min 6 characters):`);
    if (v) patch(u, { password: v }, `Password changed for ${u.email}. They were logged out.`);
  }
  function revoke(u) {
    if (window.confirm(`End access for ${u.email} right now? They will see the "Access expired" page.`))
      patch(u, { revoke: true }, `Access ended for ${u.email}.`);
  }
  async function remove(u) {
    if (!window.confirm(`Delete the login ${u.email}? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      setFlash(`Deleted ${u.email}.`);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  const active = users?.filter((u) => status(u)[1] === 'Active').length ?? '—';

  return (
    <>
      <PageHeader title="Admin Panel" sub="Create logins for people who send mail and control how long each one works." />
      {err && <div className="error-box">{err}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      <div className="stats">
        <StatCard label="Total logins" value={users?.length ?? '—'} />
        <StatCard label="Active" value={active} tone="ok" />
        <StatCard label="Expired / blocked" value={users ? users.length - active : '—'} tone="warn" />
      </div>

      <form className="panel" onSubmit={create}>
        <h2>New login</h2>
        <div className="row">
          <Field label="Name"><input value={f.name} onChange={set('name')} placeholder="Optional" /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={set('email')} required /></Field>
        </div>
        <div className="row">
          <Field label="Password" hint="At least 6 characters. Share it with the user yourself.">
            <input value={f.password} onChange={set('password')} required minLength={6} autoComplete="new-password" />
          </Field>
          <Field label="Validity (days)" hint="The login stops working after this many days.">
            <input type="number" min="1" max="3650" value={f.days} onChange={set('days')} required />
          </Field>
        </div>
        <button disabled={busy}>{busy ? 'Creating…' : 'Create login'}</button>
      </form>

      <div className="table-wrap">
        {!users ? <div className="empty">Loading…</div> : users.length === 0 ? (
          <div className="empty">No user logins yet. Create one above.</div>
        ) : (
          <table>
            <thead>
              <tr><th>User</th><th>Status</th><th>Access until</th><th>Last login</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const [tone, text] = status(u);
                return (
                  <tr key={u.id}>
                    <td>
                      <div>{u.email}</div>
                      {u.name && <div className="hint" style={{ marginTop: 2 }}>{u.name}</div>}
                    </td>
                    <td><span className={'pill ' + tone}><span className="dot" />{text}</span></td>
                    <td>
                      <div>{new Date(u.valid_until).toLocaleString()}</div>
                      <div className="hint" style={{ marginTop: 2 }}>{daysLeft(u)}</div>
                    </td>
                    <td>{timeAgo(u.last_login_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="sm" onClick={() => extend(u)}>+ Days</button>
                        <button className="ghost sm" onClick={() => setValidity(u)}>Set days</button>
                        <button className="ghost sm" onClick={() => resetPassword(u)}>Password</button>
                        {u.disabled
                          ? <button className="ghost sm" onClick={() => patch(u, { disabled: false }, `Unblocked ${u.email}.`)}>Unblock</button>
                          : <button className="ghost sm" onClick={() => patch(u, { disabled: true }, `Blocked ${u.email}.`)}>Block</button>}
                        <button className="danger sm" onClick={() => revoke(u)}>End now</button>
                        <button className="danger sm" onClick={() => remove(u)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
