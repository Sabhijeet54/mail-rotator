'use client';

import { useEffect, useState } from 'react';
import { api, PageHeader, Field, StatCard, timeAgo } from '../../components/ui';

// Dates are picked as calendar days: access starts at 00:00 on the start day
// and ends at 23:59 on the end day, in the admin's local time.
const pad = (n) => String(n).padStart(2, '0');
const toDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const startOf = (day) => new Date(`${day}T00:00:00`).toISOString();
const endOf = (day) => new Date(`${day}T23:59:59`).toISOString();
const plusDays = (n) => toDay(Date.now() + n * 86400e3);
const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const blank = () => ({ name: '', email: '', password: '', from: toDay(Date.now()), until: plusDays(30) });

function status(u) {
  const now = Date.now();
  if (new Date(u.valid_from) > now) return ['warn', 'Not started'];
  if (new Date(u.valid_until) <= now) return ['bad', 'Expired'];
  return ['ok', 'Active'];
}

function left(u) {
  const now = Date.now();
  if (new Date(u.valid_from) > now) return `starts in ${Math.ceil((new Date(u.valid_from) - now) / 86400e3)} day(s)`;
  const d = Math.ceil((new Date(u.valid_until) - now) / 86400e3);
  return d > 0 ? `${d} day${d === 1 ? '' : 's'} left` : 'ended';
}

export default function AdminPage() {
  const [users, setUsers] = useState(null);
  const [f, setF] = useState(blank);
  const [edit, setEdit] = useState(null); // { id, from, until }
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/api/admin/users').then((d) => setUsers(d.users)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const say = (ok, msg) => { setErr(ok ? '' : msg); setFlash(ok ? msg : ''); };

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api('/api/admin/users', {
        method: 'POST',
        body: { name: f.name, email: f.email, password: f.password, validFrom: startOf(f.from), validUntil: endOf(f.until) },
      });
      say(true, `Account created for ${d.user.email} (${fmt(d.user.valid_from)} to ${fmt(d.user.valid_until)}). Share the email and password with them.`);
      setF(blank());
      load();
    } catch (e2) {
      say(false, e2.message);
    }
    setBusy(false);
  }

  async function saveTimer() {
    try {
      const d = await api(`/api/admin/users/${edit.id}`, {
        method: 'PATCH', body: { validFrom: startOf(edit.from), validUntil: endOf(edit.until) },
      });
      say(true, `${d.user.email}: access ${fmt(d.user.valid_from)} to ${fmt(d.user.valid_until)}.`);
      setEdit(null);
      load();
    } catch (e) {
      say(false, e.message);
    }
  }

  async function remove(u) {
    if (!window.confirm(`Delete the account ${u.email}? They will not be able to log in again. This cannot be undone.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      say(true, `Deleted ${u.email}.`);
      load();
    } catch (e) {
      say(false, e.message);
    }
  }

  const active = users?.filter((u) => status(u)[1] === 'Active').length ?? '—';

  return (
    <>
      <PageHeader title="Admin Panel" sub="Create licence accounts, set from when to when each one works, and delete them." />
      {err && <div className="error-box">{err}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      <div className="stats">
        <StatCard label="Accounts" value={users?.length ?? '—'} />
        <StatCard label="Active now" value={active} tone="ok" />
        <StatCard label="Expired / not started" value={users ? users.length - active : '—'} tone="warn" />
      </div>

      <form className="panel" onSubmit={create}>
        <h2>New account</h2>
        <div className="row">
          <Field label="Name"><input value={f.name} onChange={set('name')} placeholder="Optional" /></Field>
          <Field label="Email (login)"><input type="email" value={f.email} onChange={set('email')} required /></Field>
          <Field label="Password" hint="At least 6 characters.">
            <input value={f.password} onChange={set('password')} required minLength={6} autoComplete="new-password" />
          </Field>
        </div>
        <div className="row">
          <Field label="Access from"><input type="date" value={f.from} onChange={set('from')} required /></Field>
          <Field label="Access until" hint="Login stops working after this day.">
            <input type="date" value={f.until} min={f.from} onChange={set('until')} required />
          </Field>
        </div>
        <button disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>

      <div className="table-wrap">
        {!users ? <div className="empty">Loading…</div> : users.length === 0 ? (
          <div className="empty">No accounts yet. Create one above.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Account</th><th>Status</th><th>Access period</th><th>Last login</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const [tone, text] = status(u);
                const editing = edit?.id === u.id;
                return (
                  <tr key={u.id}>
                    <td>
                      <div>{u.email}</div>
                      {u.name && <div className="hint" style={{ marginTop: 2 }}>{u.name}</div>}
                    </td>
                    <td><span className={'pill ' + tone}><span className="dot" />{text}</span></td>
                    <td>
                      {editing ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input type="date" aria-label="Access from" value={edit.from} onChange={(e) => setEdit({ ...edit, from: e.target.value })} style={{ width: 'auto' }} />
                          <span className="muted">to</span>
                          <input type="date" aria-label="Access until" value={edit.until} min={edit.from} onChange={(e) => setEdit({ ...edit, until: e.target.value })} style={{ width: 'auto' }} />
                        </div>
                      ) : (
                        <>
                          <div>{fmt(u.valid_from)} → {fmt(u.valid_until)}</div>
                          <div className="hint" style={{ marginTop: 2 }}>{left(u)}</div>
                        </>
                      )}
                    </td>
                    <td>{timeAgo(u.last_login_at)}</td>
                    <td>
                      <div className="row-actions">
                        {editing ? (
                          <>
                            <button className="sm" onClick={saveTimer}>Save</button>
                            <button className="ghost sm" onClick={() => setEdit(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="ghost sm" onClick={() => setEdit({ id: u.id, from: toDay(u.valid_from), until: toDay(u.valid_until) })}>Set timer</button>
                            <button className="danger sm" onClick={() => remove(u)}>Delete</button>
                          </>
                        )}
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
