'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, PageHeader } from '../../components/ui';

const TONE = { success: 'ok', error: 'bad', warn: 'warn', info: 'muted' };

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const [err, setErr] = useState('');
  const [paged, setPaged] = useState(false);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = (before) => {
    const p = new URLSearchParams();
    if (level) p.set('level', level);
    if (q) p.set('search', q);
    if (before) p.set('before', before);
    return p.toString();
  };

  const load = useCallback(async () => {
    try {
      const d = await api('/api/logs?' + params());
      setLogs(d.logs);
      setMore(d.logs.length === 100);
      setPaged(false);
      setErr('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, q]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (paged || level || q) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [paged, level, q, load]);

  async function older() {
    const last = logs[logs.length - 1];
    if (!last) return;
    try {
      const d = await api('/api/logs?' + params(last.id));
      setLogs([...logs, ...d.logs]);
      setMore(d.logs.length === 100);
      setPaged(true);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <PageHeader title="Activity Logs" sub="Everything the app did and when." />
      {err && <div className="error-box">{err}</div>}
      <div className="toolbar">
        <input className="grow" placeholder="Search messages…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="success">Success</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <button className="ghost sm" onClick={load}>Refresh</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Level</th><th>Action</th><th>Message</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="empty">Loading…</td></tr>}
            {!loading && logs.length === 0 && <tr><td colSpan={4} className="empty">No activity found.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="muted">{new Date(l.created_at).toLocaleString()}</td>
                <td><span className={'pill ' + (TONE[l.level] || 'muted')}><span className="dot" />{l.level}</span></td>
                <td><span className="tag">{l.action}</span></td>
                <td style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && logs.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 12 }}><button className="ghost" onClick={older}>Load older</button></div>
      )}
    </>
  );
}
