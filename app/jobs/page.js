'use client';

import { useEffect, useState } from 'react';
import { api, PageHeader, StatCard, timeAgo } from '../../components/ui';

export default function JobsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [running, setRunning] = useState('');
  const [origin, setOrigin] = useState('');

  const load = () => api('/api/jobs').then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => {
    setOrigin(window.location.origin);
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function run(name) {
    setRunning(name);
    setFlash('');
    try {
      const r = await api('/api/jobs', { method: 'POST', body: { name } });
      setFlash(`${name}: ${JSON.stringify(r.result).slice(0, 300)}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setRunning('');
      load();
    }
  }

  async function toggle(name, enabled) {
    await api('/api/jobs', { method: 'POST', body: { name, enabled } }).catch((e) => setErr(e.message));
    load();
  }

  async function cancel(c) {
    if (!confirm(`Cancel scheduled send "${c.name}"?`)) return;
    await api(`/api/campaigns/${c.id}/stop`, { method: 'POST' }).catch((e) => setErr(e.message));
    load();
  }

  const up = data?.upcoming?.[0];
  const cronUrl = `${origin || 'https://your-site'}/api/cron/process-queue?key=<CRON_SECRET>`;

  return (
    <>
      <PageHeader title="Scheduled Jobs" sub="Background work: sending the queue, scheduled sends, follow-ups and reply checks." />
      {err && <div className="error-box">{err}</div>}
      {flash && <div className="ok-box" style={{ wordBreak: 'break-word' }}>{flash}</div>}

      <div className="stats">
        <StatCard label="Queued messages" value={up?.n ?? '—'} />
        <StatCard label="Next due" value={up?.next_at ? new Date(up.next_at).toLocaleTimeString() : '—'} />
        <StatCard label="Scheduled sends" value={data?.scheduled?.length ?? '—'} />
        <StatCard label="Follow-ups waiting" value={data?.followupsWaiting?.[0]?.n ?? '—'} />
      </div>

      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table>
          <thead>
            <tr><th>Job</th><th>Enabled</th><th>Last run</th><th>Status</th><th>Duration</th><th>Last result</th><th /></tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
            {data?.jobs.map((j) => (
              <tr key={j.name}>
                <td><b>{j.name}</b><div className="muted">{j.description}</div></td>
                <td><input type="checkbox" aria-label={`Enable ${j.name}`} checked={j.enabled} onChange={(e) => toggle(j.name, e.target.checked)} /></td>
                <td className="muted">{timeAgo(j.last_run_at)}</td>
                <td>
                  {j.last_status
                    ? <span className={'pill ' + (j.last_status === 'ok' ? 'ok' : 'bad')}><span className="dot" />{j.last_status}</span>
                    : <span className="muted">never</span>}
                </td>
                <td className="num">{j.last_duration_ms != null ? `${j.last_duration_ms} ms` : '—'}</td>
                <td className="muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={j.last_result ? JSON.stringify(j.last_result) : ''}>
                  {j.last_result ? JSON.stringify(j.last_result).slice(0, 80) : '—'}
                </td>
                <td><div className="row-actions">
                  <button className="ghost sm" disabled={!!running} onClick={() => run(j.name)}>{running === j.name ? 'Running…' : 'Run now'}</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Scheduled sends</h2>
        {data && data.scheduled.length === 0 && <div className="muted">Nothing scheduled. Pick “Send later” when composing a campaign.</div>}
        <div className="mini-list">
          {data?.scheduled.map((c) => (
            <div key={c.id} style={{ alignItems: 'center' }}>
              <span><b>{c.name}</b> <span className="muted">· {c.total_recipients} recipients</span></span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="muted">{new Date(c.scheduled_at).toLocaleString()}</span>
                <button className="danger sm" onClick={() => cancel(c)}>Cancel</button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Run in the background</h2>
        <p className="hint" style={{ fontSize: 12 }}>
          The server runs these jobs by itself every few seconds, so mail goes out even when no browser is open.
          On Render's free plan the server sleeps after ~15 minutes without visits and resumes when it wakes.
          Optional: to keep it awake, create a free job at{' '}
          <a href="https://cron-job.org" target="_blank" rel="noreferrer">cron-job.org</a> that opens this URL every 5 minutes
          (replace <code>&lt;CRON_SECRET&gt;</code> with the value set in Render):
        </p>
        <div className="log" style={{ height: 'auto', marginBottom: 10, wordBreak: 'break-all' }}>{cronUrl}</div>
        {data && !data.cronConfigured && (
          <span className="pill warn"><span className="dot" />CRON_SECRET isn't set. Only needed for the optional keep-awake job above.</span>
        )}
        {data?.cronConfigured && <span className="pill ok"><span className="dot" />CRON_SECRET is set</span>}
      </div>
    </>
  );
}
