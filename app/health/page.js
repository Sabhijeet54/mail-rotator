'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, PageHeader, StatCard, StatusPill, timeAgo } from '../../components/ui';

const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function assess(m) {
  let score = 100;
  const tips = [];
  const failRate = rate(m.failed_7d, m.sent_7d + m.failed_7d);
  const bounceRate = rate(m.bounces_30d, m.sent_30d);
  if (m.connection === 'error') { score -= 60; tips.push('Re-check the app password / SMTP settings in Mailbox Accounts, then Test.'); }
  else if (m.connection === 'untested') { score -= 20; tips.push('Run Test connection to confirm this mailbox can send.'); }
  if (failRate > 10) { score -= 25; tips.push('High failure rate: lower the daily cap or pause this mailbox for a day.'); }
  else if (failRate > 3) { score -= 10; tips.push('Some sends fail: watch this mailbox and keep the cap modest.'); }
  if (bounceRate > 5) { score -= 25; tips.push('Many bounces: clean the contact list (invalid addresses hurt reputation).'); }
  else if (bounceRate > 2) score -= 10;
  if (m.imap_error) { score -= 10; tips.push("Replies can't be read: enable IMAP in the mail provider settings."); }
  if (m.daily_cap === 0 || m.daily_cap > 150) tips.push('Consider a daily cap of 30–100 for personal mailboxes.');
  score = Math.max(0, Math.min(100, score));
  const [tone, label] = score >= 80 ? ['ok', 'Good'] : score >= 50 ? ['warn', 'Watch'] : ['bad', 'Poor'];
  return { score, tone, label, tips, failRate, bounceRate };
}

export default function HealthPage() {
  const [list, setList] = useState([]);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setList((await api('/api/health')).mailboxes);
      setErr('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function testAll() {
    if (!list.length) return;
    setTesting(true);
    setFlash('');
    try {
      const { results } = await api('/api/mailboxes/test', { method: 'POST', body: { ids: list.map((m) => m.id) } });
      const ok = results.filter((r) => r.ok).length;
      setFlash(`Tested ${results.length}: ${ok} connected, ${results.length - ok} failed.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setTesting(false);
      load();
    }
  }

  const rated = list.map((m) => ({ m, a: assess(m) }));
  const n = (tone) => rated.filter((x) => x.a.tone === tone).length;

  return (
    <>
      <PageHeader
        title="Account Health"
        sub="Connection checks, failure and bounce rates, cap usage and IMAP status for each mailbox."
        actions={
          <>
            <a href="/mailboxes"><button className="ghost">Mailbox Accounts</button></a>
            <button disabled={testing || !list.length} onClick={testAll}>{testing ? 'Testing…' : 'Test all'}</button>
          </>
        }
      />
      <div className="stats">
        <StatCard label="Mailboxes" value={list.length} />
        <StatCard label="Good" value={n('ok')} tone="ok" />
        <StatCard label="Watch" value={n('warn')} tone="warn" />
        <StatCard label="Poor" value={n('bad')} tone={n('bad') ? 'warn' : 'muted'} />
      </div>
      {err && <div className="error-box">{err}</div>}
      {flash && <div className="ok-box">{flash}</div>}
      {loaded && !list.length && (
        <div className="panel empty">No mailboxes yet. <a href="/mailboxes">Add one</a>.</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {rated.map(({ m, a }) => {
          const last = m.checks?.[0];
          const capPct = m.daily_cap ? Math.min(100, (m.sent_today / m.daily_cap) * 100) : 0;
          return (
            <div className="panel" key={m.id} style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{m.email}</div>
                  <div className="muted">{m.provider}{m.paused ? ' · paused' : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <StatusPill status={m.paused ? 'paused' : m.connection} />
                  <span className={'pill ' + a.tone} title="Health score">{a.label} {a.score}</span>
                </div>
              </div>

              <div className="cap" style={{ marginTop: 14 }}>
                <div className="muted">Today: {m.sent_today} / {m.daily_cap || '∞'}</div>
                <div className={'cap-bar' + (m.daily_cap && m.sent_today >= m.daily_cap ? ' full' : '')}>
                  <div style={{ width: `${capPct}%` }} />
                </div>
              </div>

              <dl className="kv" style={{ marginTop: 14, gridTemplateColumns: '1fr auto 1fr auto' }}>
                <dt>Sent 7d</dt><dd>{m.sent_7d}</dd>
                <dt>Failed 7d</dt><dd>{m.failed_7d}</dd>
                <dt>Failure rate</dt><dd style={{ color: a.failRate > 5 ? 'var(--red)' : undefined }}>{a.failRate}%</dd>
                <dt>Bounces 30d</dt><dd>{m.bounces_30d}</dd>
                <dt>Reply rate 30d</dt><dd>{rate(m.replies_30d, m.sent_30d)}%</dd>
                <dt>Last check</dt><dd>{last ? `${last.latency_ms ?? '—'} ms · ${timeAgo(last.checked_at)}` : '—'}</dd>
              </dl>

              {m.checks?.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 12, alignItems: 'center' }}>
                  <span className="muted" style={{ marginRight: 4 }}>Checks</span>
                  {[...m.checks].reverse().map((c, i) => (
                    <span key={i} title={`${new Date(c.checked_at).toLocaleString()}: ${c.ok ? 'OK' : c.error || 'failed'}`}
                          style={{ width: 9, height: 9, borderRadius: '50%', background: c.ok ? 'var(--green)' : 'var(--red)' }} />
                  ))}
                </div>
              )}

              {m.last_error && <div className="hint" style={{ color: 'var(--red)', wordBreak: 'break-word' }}>SMTP: {m.last_error}</div>}
              {m.imap_error && <div className="hint" style={{ color: 'var(--red)', wordBreak: 'break-word' }}>IMAP: {m.imap_error}</div>}
              {a.tips.length > 0 && (
                <ul className="hint" style={{ margin: '10px 0 0', paddingLeft: 16 }}>
                  {a.tips.map((t) => <li key={t}>{t}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
