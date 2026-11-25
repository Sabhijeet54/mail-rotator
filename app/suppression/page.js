'use client';

import { useCallback, useEffect, useState } from 'react';
import Drawer from '../../components/Drawer';
import { api, PageHeader, StatCard, Field } from '../../components/ui';

const REASONS = ['manual', 'unsubscribe', 'bounce', 'complaint'];
const TONE = { manual: 'muted', unsubscribe: 'warn', bounce: 'bad', complaint: 'bad' };

export default function SuppressionPage() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState([]);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [addReason, setAddReason] = useState('manual');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(Object.entries({ search, reason }).filter(([, v]) => v)).toString();
      const d = await api('/api/suppressions' + (qs ? '?' + qs : ''));
      setRows(d.suppressions);
      setCounts(d.counts);
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, [search, reason]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  async function remove(emails) {
    if (!emails.length) return;
    if (!confirm(`Remove ${emails.length} address(es) from the Suppression List? They can be emailed again.`)) return;
    try {
      const r = await api('/api/suppressions', { method: 'DELETE', body: { emails } });
      setFlash(`Removed ${r.removed} address(es).`);
      setSelected(new Set());
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function add() {
    setBusy(true);
    try {
      const r = await api('/api/suppressions', { method: 'POST', body: { text, reason: addReason } });
      setFlash(`Added ${r.added} of ${r.total} address(es)${r.total > r.added ? ' (rest were already listed)' : ''}.`);
      setText('');
      setAdding(false);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const count = (r) => counts.find((c) => c.reason === r)?.n || 0;
  const total = counts.reduce((a, c) => a + c.n, 0);
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.email));
  const toggle = (e) => {
    const n = new Set(selected);
    n.has(e) ? n.delete(e) : n.add(e);
    setSelected(n);
  };
  const found = (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []).length;

  return (
    <>
      <PageHeader
        title="Suppression List"
        sub="Addresses here are never emailed. Bounces and “unsubscribe” replies are added automatically."
        actions={
          <>
            <a href="/api/suppressions?format=csv"><button className="ghost">Export CSV</button></a>
            <button onClick={() => setAdding(true)}>+ Add</button>
          </>
        }
      />

      <div className="stats">
        <StatCard label="Total" value={total} />
        <StatCard label="Unsubscribed" value={count('unsubscribe')} tone="warn" />
        <StatCard label="Bounced" value={count('bounce')} tone="warn" />
        <StatCard label="Manual" value={count('manual')} tone="muted" />
        <StatCard label="Complaints" value={count('complaint')} tone="muted" />
      </div>

      {err && <div className="error-box">{err}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      <div className="toolbar">
        <input className="grow" placeholder="Search email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">All reasons</option>
          {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {selected.size > 0 && (
          <>
            <span className="muted">{selected.size} selected</span>
            <button className="danger sm" onClick={() => remove([...selected])}>Remove selected</button>
          </>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" aria-label="Select all" checked={allChecked}
                       onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.email)))} />
              </th>
              <th>Email</th><th>Reason</th><th>Source</th><th>Added</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email}>
                <td><input type="checkbox" aria-label={`Select ${r.email}`} checked={selected.has(r.email)} onChange={() => toggle(r.email)} /></td>
                <td>{r.email}</td>
                <td><span className={'pill ' + (TONE[r.reason] || 'muted')}><span className="dot" />{r.reason}</span></td>
                <td className="muted">{r.source || '—'}</td>
                <td className="muted">{new Date(r.created_at).toLocaleString()}</td>
                <td><div className="row-actions"><button className="ghost sm" onClick={() => remove([r.email])}>Remove</button></div></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="empty">No suppressed addresses{search || reason ? ' match these filters' : ' yet'}.</td></tr>}
          </tbody>
        </table>
      </div>

      <Drawer
        open={adding}
        title="Add to Suppression List"
        subtitle="These addresses will be skipped in every send; queued mail to them is cancelled."
        onClose={() => setAdding(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button disabled={busy || !found} onClick={add}>{busy ? 'Adding…' : `Add ${found || ''}`}</button>
          </>
        }
      >
        <Field label="Emails" hint="Paste anything — one per line, comma-separated, or a whole email thread. Addresses are picked out automatically.">
          <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'a@x.com\nb@y.com'} />
        </Field>
        <div className="count">{found} email(s) detected</div>
        <Field label="Reason">
          <select value={addReason} onChange={(e) => setAddReason(e.target.value)}>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </Drawer>
    </>
  );
}
