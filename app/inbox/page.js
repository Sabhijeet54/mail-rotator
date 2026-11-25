'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Drawer from '../../components/Drawer';
import { api, PageHeader, timeAgo } from '../../components/ui';

const TABS = [
  ['all', 'All'], ['unread', 'Unread'], ['starred', 'Starred'], ['interested', 'Interested'], ['meeting', 'Meeting'],
  ['not_interested', 'Not interested'], ['ooo', 'Out of office'], ['unsubscribe', 'Unsubscribe'],
];
const CATS = [
  ['interested', 'Interested'], ['meeting', 'Meeting / call'], ['not_interested', 'Not interested'],
  ['ooo', 'Out of office'], ['unsubscribe', 'Unsubscribe'], ['none', 'No label'],
];
const CAT_LABEL = Object.fromEntries(CATS);

export default function InboxPage() {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState({ messages: [], counts: {}, lastCheck: null });
  const [openId, setOpenId] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ tab, ...(search ? { search } : {}) });
      setData(await api('/api/inbox?' + qs));
      setError('');
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [tab, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function check() {
    setChecking(true);
    setError('');
    try {
      const result = await api('/api/inbox/check', { method: 'POST' });
      const errs = (result.results || []).filter((r) => r.error);
      setFlash(`Checked ${result.mailboxes} mailbox(es): ${result.newReplies} new repl${result.newReplies === 1 ? 'y' : 'ies'}.` +
               (errs.length ? ` ${errs.length} mailbox(es) could not be read — see Account Health.` : ''));
      load();
    } catch (e) { setError(e.message); } finally { setChecking(false); }
  }

  async function patch(id, body) {
    await api(`/api/inbox/${id}`, { method: 'PATCH', body }).catch((e) => setError(e.message));
    load();
  }

  const lc = data.lastCheck;
  return (
    <>
      <PageHeader
        title="Unified Inbox"
        sub="Replies to your campaigns from every mailbox in one place. Auto-labelled; you can re-label, rate, star and reply from here."
        actions={<button disabled={checking} onClick={check}>{checking ? 'Checking mailboxes…' : 'Check for replies'}</button>}
      />
      {error && <div className="error-box">{error}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      <div className="tabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={'tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>
            {l}<span className="n">{data.counts?.[k] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input className="grow" placeholder="Search name, email, subject or text…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted">
          {lc?.last_run_at ? `Last checked ${timeAgo(lc.last_run_at)}` : 'Not checked yet'} · checks every 5 min while the app is open
        </span>
      </div>

      <div className="table-wrap">
        <div className="inbox-list">
          {data.messages.map((m) => {
            const who = [m.first_name, m.last_name].filter(Boolean).join(' ') || m.from_name || m.from_email;
            return (
              <div key={m.id} className={'inbox-row' + (m.is_read ? '' : ' unread')} onClick={() => setOpenId(m.id)}
                   role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(m.id)}>
                <button className={'star' + (m.starred ? ' on' : '')} aria-label="Star"
                        onClick={(e) => { e.stopPropagation(); patch(m.id, { starred: !m.starred }); }}>{m.starred ? '★' : '☆'}</button>
                <div style={{ minWidth: 0 }}>
                  <div className="who" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</div>
                  <div className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.from_email}</div>
                </div>
                <div className="subj">{m.subject} <span className="snip">— {m.snippet}</span>
                  <div className="muted">to {m.mailbox_email}{m.campaign_name ? ` · ${m.campaign_name}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {m.category !== 'none' && <span className={'pill cat-' + m.category}><span className="dot" />{CAT_LABEL[m.category]}</span>}
                  {m.rating ? <span style={{ color: 'var(--yellow)', marginLeft: 6 }}>{'★'.repeat(m.rating)}</span> : null}
                  {m.replied_by_me_at && <span className="tag" style={{ marginLeft: 6 }}>replied</span>}
                  <div className="muted">{timeAgo(m.received_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
        {!loading && data.messages.length === 0 && (
          <div className="empty">
            {tab === 'all' && !search
              ? <>No replies yet. Replies to emails sent from <Link href="/campaigns">Campaigns</Link> show up here automatically.
                  Gmail needs IMAP on (Settings → Forwarding and POP/IMAP) — the same app password works.</>
              : 'Nothing here.'}
          </div>
        )}
      </div>

      <MessageDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </>
  );
}

function MessageDrawer({ id, onClose, onChanged }) {
  const [m, setM] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState('');

  useEffect(() => {
    if (!id) return;
    setM(null);
    setErr('');
    setSent('');
    setReply('');
    api(`/api/inbox/${id}`).then((d) => { setM(d.message); onChanged(); }).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function patch(body) {
    try {
      await api(`/api/inbox/${id}`, { method: 'PATCH', body });
      setM({ ...m, ...body });
      onChanged();
    } catch (e) { setErr(e.message); }
  }

  async function send() {
    setBusy(true);
    setErr('');
    try {
      await api(`/api/inbox/${id}/reply`, { method: 'POST', body: { body: reply } });
      setSent('Reply sent from ' + m.mailbox_email);
      setReply('');
      const d = await api(`/api/inbox/${id}`);
      setM(d.message);
      onChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const name = m ? ([m.vars?.first_name, m.vars?.last_name].filter(Boolean).join(' ') || m.from_name) : '';
  return (
    <Drawer open={!!id} title={m ? m.subject : 'Loading…'} subtitle={m ? `${name ? name + ' · ' : ''}${m.from_email} → ${m.mailbox_email}` : ''}
            onClose={onClose} width={720}>
      {err && <div className="error-box">{err}</div>}
      {sent && <div className="ok-box">{sent}</div>}
      {m && (
        <>
          <dl className="kv" style={{ marginBottom: 14 }}>
            <dt>From</dt><dd>{name ? `${name} <${m.from_email}>` : m.from_email}</dd>
            <dt>Received</dt><dd>{new Date(m.received_at).toLocaleString()}</dd>
            {m.campaign_name && <><dt>Campaign</dt><dd>{m.campaign_name}</dd></>}
            {m.vars?.company && <><dt>Company</dt><dd>{m.vars.company}</dd></>}
          </dl>

          <h3>Label</h3>
          <div className="chips">
            {CATS.map(([k, l]) => (
              <button key={k} className={'chip' + (m.category === k ? ' on' : '')} onClick={() => patch({ category: k })}>{l}</button>
            ))}
          </div>
          {m.category === 'unsubscribe' && <div className="hint">This address is on the Suppression List and won't be emailed again.</div>}

          <h3>Rating</h3>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={'star' + ((m.rating || 0) >= n ? ' on' : '')} style={{ fontSize: 22 }}
                      aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => patch({ rating: m.rating === n ? null : n })}>
                {(m.rating || 0) >= n ? '★' : '☆'}
              </button>
            ))}
            <span className="muted" style={{ marginLeft: 8 }}>{m.rating ? `${m.rating}/5` : 'not rated'}</span>
            <span style={{ flex: 1 }} />
            <button className="ghost sm" onClick={() => patch({ starred: !m.starred })}>{m.starred ? '★ Starred' : '☆ Star'}</button>
            <button className="ghost sm" onClick={() => { patch({ is_read: false }); onClose(); }}>Mark unread</button>
          </div>

          <h3>Conversation</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(m.thread?.length ? m.thread : [{ dir: 'in', subject: m.subject, body: m.body, at: m.received_at }]).map((t, i) => (
              <div key={i}>
                <div className="muted" style={{ marginBottom: 4 }}>
                  {t.dir === 'out' ? `You (${m.mailbox_email})` : name || m.from_email} · {new Date(t.at).toLocaleString()} · {t.subject}
                </div>
                <div className={'msg-body ' + t.dir}>{t.dir === 'out' ? htmlish(t.body) : t.body}</div>
              </div>
            ))}
          </div>

          <h3>Reply</h3>
          <textarea rows={6} value={reply} onChange={(e) => setReply(e.target.value)}
                    placeholder={`Hi ${m.vars?.first_name || name.split(' ')[0] || ''},\n\n`} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span className="hint" style={{ margin: 0 }}>Sent from {m.mailbox_email} in the same thread.</span>
            <button disabled={busy || !reply.trim()} onClick={send}>{busy ? 'Sending…' : 'Send reply'}</button>
          </div>
        </>
      )}
    </Drawer>
  );
}

// Outgoing bodies may be HTML; show them as readable text.
function htmlish(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
