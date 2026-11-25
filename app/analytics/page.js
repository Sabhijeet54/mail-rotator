'use client';

import { useEffect, useState } from 'react';
import { api, PageHeader, StatCard } from '../../components/ui';

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const CAT_LABEL = {
  interested: 'Interested', meeting: 'Meeting', not_interested: 'Not interested',
  unsubscribe: 'Unsubscribe', ooo: 'Out of office', none: 'Uncategorised',
};
const CAT_COLOR = {
  interested: 'var(--green)', meeting: 'var(--accent)', not_interested: 'var(--muted)',
  unsubscribe: 'var(--red)', ooo: 'var(--yellow)', none: 'var(--border)',
};

export default function AnalyticsPage() {
  const [days, setDays] = useState(14);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    api(`/api/analytics?days=${days}`).then(setD).catch((e) => setErr(e.message));
  }, [days]);

  const t = d?.totals;
  const daily = d?.daily || [];
  const max = Math.max(1, ...daily.map((x) => Math.max(x.sent, x.replies, x.failed)));
  const catTotal = (d?.categories || []).reduce((a, c) => a + c.n, 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        sub="Sent, replies and failures across campaigns and mailboxes."
        actions={
          <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
            {[7, 14, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}
          </select>
        }
      />
      {err && <div className="error-box">{err}</div>}

      <div className="stats">
        <StatCard label="Sent" value={t?.sent ?? '—'} />
        <StatCard label="Failed" value={t?.failed ?? '—'} tone={t?.failed ? 'warn' : ''} />
        <StatCard label="Replies" value={t?.replied ?? '—'} tone="ok" />
        <StatCard label="Reply rate" value={t ? `${pct(t.replied, t.sent)}%` : '—'} tone="ok" />
        <StatCard label="Bounced" value={t?.bounced ?? '—'} tone={t?.bounced ? 'warn' : ''} />
        <StatCard label="Unsubscribed" value={t?.unsubscribed ?? '—'} tone="muted" />
        <StatCard label="Queued" value={t?.queued ?? '—'} />
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Daily activity</h2>
          <div className="muted" style={{ display: 'flex', gap: 14 }}>
            <span><Swatch c="var(--accent)" /> Sent</span>
            <span><Swatch c="var(--green)" /> Replies</span>
            <span><Swatch c="var(--red)" /> Failed</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 180, marginTop: 16, overflowX: 'auto', paddingBottom: 4 }}>
          {daily.map((x) => {
            const label = new Date(x.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return (
              <div key={x.day} title={`${label}: ${x.sent} sent, ${x.replies} replies, ${x.failed} failed`}
                   style={{ flex: '1 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                  <Bar h={x.sent / max} c="var(--accent)" />
                  <Bar h={x.replies / max} c="var(--green)" />
                  <Bar h={x.failed / max} c="var(--red)" />
                </div>
                <div className="muted" style={{ fontSize: 10, marginTop: 4, whiteSpace: 'nowrap' }}>
                  {daily.length > 31 ? new Date(x.day).getDate() : label}
                </div>
              </div>
            );
          })}
          {!daily.length && <div className="muted">No data yet.</div>}
        </div>
      </div>

      <div className="panel">
        <h2>Reply categories</h2>
        {catTotal === 0 && <div className="muted">No replies in this period.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(d?.categories || []).map((c) => (
            <div key={c.category} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 60px', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <span>{CAT_LABEL[c.category] || c.category}</span>
              <div style={{ background: 'var(--panel-2)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${pct(c.n, catTotal)}%`, height: '100%', background: CAT_COLOR[c.category] || 'var(--accent)' }} />
              </div>
              <span className="muted" style={{ textAlign: 'right' }}>{c.n} · {Math.round(pct(c.n, catTotal))}%</span>
            </div>
          ))}
        </div>
      </div>

      <h3>Campaigns</h3>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Recipients</th><th>Sent</th><th>Replied</th><th>Reply rate</th><th>Failed</th></tr></thead>
          <tbody>
            {(d?.campaigns || []).map((c) => (
              <tr key={c.id}>
                <td>{c.name}<div className="muted">{new Date(c.created_at).toLocaleDateString()}</div></td>
                <td><span className="tag">{c.status}</span></td>
                <td className="num">{c.recipients}</td>
                <td className="num">{c.sent}</td>
                <td className="num">{c.replied}</td>
                <td className="num">{pct(c.replied, c.sent)}%</td>
                <td className="num">{c.failed}</td>
              </tr>
            ))}
            {d && !d.campaigns.length && <tr><td colSpan={7} className="empty">No campaigns in this period.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>Mailboxes</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Mailbox</th><th>Sent</th><th>Failed</th><th>Failure rate</th><th>Replies</th><th>Reply rate</th></tr></thead>
          <tbody>
            {(d?.mailboxes || []).map((m) => {
              const fr = pct(m.failed, m.sent + m.failed);
              return (
                <tr key={m.id}>
                  <td>{m.email}</td>
                  <td className="num">{m.sent}</td>
                  <td className="num">{m.failed}</td>
                  <td className="num" style={{ color: fr > 5 ? 'var(--red)' : undefined }}>{fr}%</td>
                  <td className="num">{m.replies}</td>
                  <td className="num">{pct(m.replies, m.sent)}%</td>
                </tr>
              );
            })}
            {d && !d.mailboxes.length && <tr><td colSpan={6} className="empty">No mailboxes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Bar({ h, c }) {
  return <div style={{ width: 6, height: `${Math.max(h * 100, h > 0 ? 2 : 0)}%`, background: c, borderRadius: '2px 2px 0 0' }} />;
}

function Swatch({ c }) {
  return <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: c, marginRight: 4 }} />;
}
