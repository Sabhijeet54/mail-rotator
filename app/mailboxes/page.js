'use client';

import { useCallback, useEffect, useState } from 'react';
import Drawer from '../../components/Drawer';
import { api, PageHeader, StatCard, StatusPill, timeAgo, Field } from '../../components/ui';

const EMPTY_FILTERS = { connection: '', group: '', state: '', search: '' };

export default function MailboxesPage() {
  const [data, setData] = useState({ mailboxes: [], summary: null, providers: [] });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [testing, setTesting] = useState(new Set());
  const [drawer, setDrawer] = useState(null); // {type:'add'|'import'|'detail', id?}
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      setData(await api('/api/mailboxes' + (qs ? '?' + qs : '')));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(load, filters.search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, filters.search]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  async function test(ids) {
    setTesting(new Set(ids));
    try {
      const { results } = await api('/api/mailboxes/test', { method: 'POST', body: { ids } });
      const ok = results.filter((r) => r.ok).length;
      setFlash(`Tested ${results.length}: ${ok} connected, ${results.length - ok} failed`);
    } catch (e) {
      setError(e.message);
    } finally {
      setTesting(new Set());
      load();
    }
  }

  async function remove(m) {
    if (!confirm(`Remove ${m.email}? Its queued messages will be reassigned to other mailboxes.`)) return;
    await api(`/api/mailboxes/${m.id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    selected.delete(m.id);
    setSelected(new Set(selected));
    if (drawer?.id === m.id) setDrawer(null);
    load();
  }

  async function setPaused(ids, paused) {
    await Promise.all(ids.map((id) => api(`/api/mailboxes/${id}`, { method: 'PATCH', body: { paused } })));
    load();
  }

  const s = data.summary;
  const list = data.mailboxes;
  const allChecked = list.length > 0 && list.every((m) => selected.has(m.id));
  const toggle = (id) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };
  const sel = [...selected].filter((id) => list.some((m) => m.id === id));
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Mailbox Accounts"
        sub="Sending mailboxes (SMTP). Campaigns rotate recipients across these and never exceed a mailbox's daily cap."
        actions={
          <>
            <button className="ghost" onClick={() => setDrawer({ type: 'import' })}>Import list</button>
            <button onClick={() => setDrawer({ type: 'add' })}>+ Add mailbox</button>
          </>
        }
      />

      <div className="stats">
        <StatCard label="Total" value={s?.total ?? '—'} />
        <StatCard label="Connected" value={s?.connected ?? '—'} tone="ok" />
        <StatCard label="Need attention" value={s?.need_attention ?? '—'} tone="warn" />
        <StatCard label="Paused" value={s?.paused ?? '—'} tone="muted" />
      </div>

      {error && <div className="error-box">{error}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      <div className="toolbar">
        <input className="grow" placeholder="Search email or name…" value={filters.search}
               onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        <select aria-label="Connection" value={filters.connection} onChange={(e) => setFilters({ ...filters, connection: e.target.value })}>
          <option value="">All connections</option>
          <option value="connected">Connected</option>
          <option value="error">Error</option>
          <option value="untested">Untested</option>
        </select>
        <select aria-label="Group" value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })}>
          <option value="">All groups</option>
          {(s?.groups || []).map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select aria-label="State" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}>
          <option value="">All states</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
        {filtered && <button className="ghost sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>}
      </div>

      {sel.length > 0 && (
        <div className="toolbar">
          <span className="muted">{sel.length} selected</span>
          <button className="ghost sm" disabled={testing.size > 0} onClick={() => test(sel)}>Test connection</button>
          <button className="ghost sm" onClick={() => setPaused(sel, true)}>Pause</button>
          <button className="ghost sm" onClick={() => setPaused(sel, false)}>Resume</button>
          <button className="ghost sm" onClick={() => setSelected(new Set())}>Deselect</button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" aria-label="Select all" checked={allChecked}
                       onChange={() => setSelected(allChecked ? new Set() : new Set(list.map((m) => m.id)))} />
              </th>
              <th>Mailbox</th>
              <th>Status</th>
              <th>Group</th>
              <th>Daily cap</th>
              <th>Queued</th>
              <th>Replies</th>
              <th>Last sync</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((m) => {
              const pct = m.daily_cap ? Math.min(100, (m.sent_today / m.daily_cap) * 100) : 0;
              return (
                <tr key={m.id}>
                  <td><input type="checkbox" aria-label={`Select ${m.email}`} checked={selected.has(m.id)} onChange={() => toggle(m.id)} /></td>
                  <td>
                    <div>{m.email}</div>
                    <div className="muted">{m.from_name || '—'} · {m.provider}</div>
                  </td>
                  <td>
                    {testing.has(m.id) ? <span className="pill muted">Testing…</span>
                      : <StatusPill status={m.paused ? 'paused' : m.connection} />}
                  </td>
                  <td><span className="tag">{m.group_name}</span></td>
                  <td className="num cap">
                    {m.sent_today}/{m.daily_cap || '∞'}
                    {m.daily_cap > 0 && <div className={'cap-bar' + (pct >= 100 ? ' full' : '')}><div style={{ width: pct + '%' }} /></div>}
                  </td>
                  <td className="num">{m.queued}</td>
                  <td className="num">{m.replies}</td>
                  <td className="muted">{timeAgo(m.last_sync_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="ghost sm" disabled={testing.has(m.id)} onClick={() => test([m.id])}>Test</button>
                      <button className="ghost sm" onClick={() => setDrawer({ type: 'detail', id: m.id })}>Details</button>
                      <button className="danger sm" onClick={() => remove(m)}>Remove</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && list.length === 0 && (
          <div className="empty">
            {filtered ? 'No mailboxes match these filters.' : (
              <>No mailboxes yet. <a href="#" onClick={(e) => { e.preventDefault(); setDrawer({ type: 'add' }); }}>Add your first mailbox</a>.</>
            )}
          </div>
        )}
        {loading && <div className="empty">Loading…</div>}
      </div>

      <AddMailboxDrawer
        open={drawer?.type === 'add'}
        providers={data.providers}
        groups={s?.groups || []}
        onClose={() => setDrawer(null)}
        onSaved={(m) => { setDrawer(null); setFlash(`${m.email} added`); load(); }}
      />
      <ImportDrawer
        open={drawer?.type === 'import'}
        onClose={() => setDrawer(null)}
        onDone={(r) => { setFlash(`Imported ${r.added} mailbox(es). Run "Test connection" to verify them.`); load(); }}
      />
      <DetailDrawer
        id={drawer?.type === 'detail' ? drawer.id : null}
        groups={s?.groups || []}
        onClose={() => setDrawer(null)}
        onChanged={load}
        onTest={(id) => test([id])}
        onRemove={remove}
      />
    </>
  );
}

function AddMailboxDrawer({ open, providers, groups, onClose, onSaved }) {
  const blank = { provider: 'gmail', email: '', password: '', fromName: '', dailyCap: 500, group: 'Default', host: '', port: '', username: '', verify: true };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setF(blank); setErr(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const { mailbox } = await api('/api/mailboxes', { method: 'POST', body: f });
      onSaved(mailbox);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Add mailbox"
      subtitle="We log in to SMTP before saving, so a wrong password is caught now."
      onClose={onClose}
      footer={<>
        <button className="ghost" onClick={onClose}>Cancel</button>
        <button onClick={save} disabled={busy}>{busy ? (f.verify ? 'Verifying SMTP…' : 'Saving…') : 'Add mailbox'}</button>
      </>}
    >
      <form onSubmit={save}>
        {err && <div className="error-box">{err}</div>}
        <Field label="Provider">
          <select value={f.provider} onChange={set('provider')}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Email address">
          <input type="email" required value={f.email} onChange={set('email')} placeholder="you@company.com" autoComplete="off" />
        </Field>
        <Field label="App password" hint="Use an app password, not your normal password. Gmail / iCloud / Yahoo need 2-step verification turned on first.">
          <input type="password" required value={f.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        {f.provider === 'custom' && (
          <>
            <div className="row">
              <Field label="SMTP host"><input value={f.host} onChange={set('host')} placeholder="smtp.example.com" /></Field>
              <Field label="Port"><input value={f.port} onChange={set('port')} placeholder="465 or 587" /></Field>
            </div>
            <Field label="SMTP username (if different from email)"><input value={f.username} onChange={set('username')} /></Field>
          </>
        )}
        <Field label="From name"><input value={f.fromName} onChange={set('fromName')} placeholder="Your Name" /></Field>
        <div className="row">
          <Field label="Daily cap (0 = no cap)"><input type="number" min="0" value={f.dailyCap} onChange={set('dailyCap')} /></Field>
          <Field label="Group">
            <input list="mb-groups" value={f.group} onChange={set('group')} />
            <datalist id="mb-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.verify} onChange={set('verify')} /> Test SMTP login before saving</label>
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

function ImportDrawer({ open, onClose, onDone }) {
  const [text, setText] = useState('');
  const [provider, setProvider] = useState('gmail');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setResult(null); setErr(''); } }, [open]);

  async function run() {
    setBusy(true);
    setErr('');
    try {
      const r = await api('/api/mailboxes/import', { method: 'POST', body: { text, defaults: { provider } } });
      setResult(r);
      if (r.added) { setText(''); onDone(r); }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const lines = text.split('\n').filter((l) => l.trim()).length;
  return (
    <Drawer
      open={open}
      title="Import mailboxes"
      subtitle="Paste CSV, one mailbox per line. Imported mailboxes start as Untested."
      onClose={onClose}
      width={600}
      footer={<>
        <button className="ghost" onClick={onClose}>Close</button>
        <button onClick={run} disabled={busy || !lines}>{busy ? 'Importing…' : `Import ${lines || ''} line(s)`}</button>
      </>}
    >
      {err && <div className="error-box">{err}</div>}
      {result && (
        <div className={result.errors.length ? 'error-box' : 'ok-box'}>
          Added {result.added}.{' '}
          {result.errors.length > 0 && <>{result.errors.length} skipped:<br />{result.errors.map((e) => <div key={e.line}>Line {e.line}: {e.error}</div>)}</>}
        </div>
      )}
      <Field label="Default provider (when the line doesn't say)">
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="icloud">iCloud</option>
          <option value="yahoo">Yahoo</option><option value="zoho">Zoho</option><option value="custom">Custom</option>
        </select>
      </Field>
      <Field label="Mailboxes" hint="Columns: email, app_password, from_name, daily_cap, group, provider, smtp_host, smtp_port — only the first two are required. Comma, tab or semicolon separated. A header row is skipped.">
        <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={'email,app_password,from_name,daily_cap,group\nsales1@acme.com,abcd efgh ijkl mnop,Asha,300,Sales'}
                  style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
      </Field>
    </Drawer>
  );
}

function DetailDrawer({ id, groups, onClose, onChanged, onTest, onRemove }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api(`/api/mailboxes/${id}`);
      setD(r);
      setForm({ fromName: r.mailbox.from_name, dailyCap: r.mailbox.daily_cap, group: r.mailbox.group_name, password: '' });
    } catch (e) {
      setMsg({ err: e.message });
    }
  }, [id]);
  useEffect(() => { setD(null); setMsg({}); load(); }, [load]);

  async function save() {
    setBusy(true);
    setMsg({});
    try {
      const body = { fromName: form.fromName, dailyCap: form.dailyCap, group: form.group };
      if (form.password) body.password = form.password;
      await api(`/api/mailboxes/${id}`, { method: 'PATCH', body });
      setMsg({ ok: form.password ? 'Saved. Password changed — run Test connection.' : 'Saved.' });
      await load();
      onChanged();
    } catch (e) {
      setMsg({ err: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    await api(`/api/mailboxes/${id}`, { method: 'PATCH', body: { paused: !d.mailbox.paused } });
    await load();
    onChanged();
  }

  async function runTest() {
    setBusy(true);
    await onTest(id);
    await load();
    setBusy(false);
  }

  const m = d?.mailbox;
  return (
    <Drawer
      open={!!id}
      title={m ? m.email : 'Mailbox'}
      subtitle={m ? `${m.provider} · ${m.smtp_host}:${m.smtp_port}` : ''}
      onClose={onClose}
      width={560}
      footer={m && <>
        <button className="danger" onClick={() => onRemove(m)}>Remove</button>
        <span style={{ flex: 1 }} />
        <button className="ghost" onClick={togglePause}>{m.paused ? 'Resume' : 'Pause'}</button>
        <button className="ghost" disabled={busy} onClick={runTest}>Test connection</button>
        <button disabled={busy} onClick={save}>Save</button>
      </>}
    >
      {msg.err && <div className="error-box">{msg.err}</div>}
      {msg.ok && <div className="ok-box">{msg.ok}</div>}
      {!m ? <div className="muted">Loading…</div> : (
        <>
          <dl className="kv">
            <dt>Status</dt><dd><StatusPill status={m.paused ? 'paused' : m.connection} /></dd>
            <dt>Sent today</dt><dd>{m.sent_today} / {m.daily_cap || '∞'}</dd>
            <dt>Queued</dt><dd>{m.queued}</dd>
            <dt>Replies</dt><dd>{m.replies}</dd>
            <dt>Last 7 days</dt><dd>{d.stats.sent_7d} sent · {d.stats.failed_7d} failed</dd>
            <dt>Last sync</dt><dd>{m.last_sync_at ? new Date(m.last_sync_at).toLocaleString() : 'Never'}</dd>
            {m.last_error && <><dt>Last error</dt><dd style={{ color: 'var(--red)' }}>{m.last_error}</dd></>}
          </dl>

          <h3>Settings</h3>
          <Field label="From name"><input value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} /></Field>
          <div className="row">
            <Field label="Daily cap (0 = no cap)"><input type="number" min="0" value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: e.target.value })} /></Field>
            <Field label="Group">
              <input list="mb-groups-d" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
              <datalist id="mb-groups-d">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </Field>
          </div>
          <Field label="New app password (leave empty to keep)">
            <input type="password" value={form.password} autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>

          <h3>Connection checks</h3>
          <div className="mini-list">
            {d.checks.length === 0 && <div className="muted">No tests yet.</div>}
            {d.checks.map((c, i) => (
              <div key={i}>
                <span className={c.ok ? 'l-success' : 'l-error'}>{c.ok ? `OK · ${c.latency_ms} ms` : c.error}</span>
                <span className="muted">{timeAgo(c.checked_at)}</span>
              </div>
            ))}
          </div>

          <h3>Recent activity</h3>
          <div className="mini-list">
            {d.logs.length === 0 && <div className="muted">Nothing yet.</div>}
            {d.logs.map((l, i) => (
              <div key={i}><span className={'l-' + l.level}>{l.message}</span><span className="muted">{timeAgo(l.created_at)}</span></div>
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}
