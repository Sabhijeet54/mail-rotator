'use client';

import { useEffect, useRef, useState } from 'react';
import { extractRecipients } from '../../lib/extract';
import { renderTemplate, recipientVars, splitSubjects } from '../../lib/render';
import { api, PageHeader } from '../../components/ui';

// Quick send = the original mail-send feature, now running on the DB queue instead of socket.io.
// The full multi-step campaign builder (contacts, filters, personalization) comes next.
const DRAFT_KEY = 'mr.compose.draft.v1';
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') || {}; } catch { return {}; }
}

export default function CampaignsPage() {
  const [mailboxes, setMailboxes] = useState([]);
  const [picked, setPicked] = useState(null); // null = all
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [format, setFormat] = useState('text');
  const [recipientsText, setRecipientsText] = useState('');
  const [delayMin, setDelayMin] = useState(10);
  const [delayMax, setDelayMax] = useState(30);
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState('');

  const [campaignId, setCampaignId] = useState(null);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, pending: 0, total: 0, campaign: null });
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);
  const lastLog = useRef(0);

  const people = extractRecipients(recipientsText);
  const found = people;
  const named = people.filter((p) => p.name).length;
  const subjects = splitSubjects(subject);
  const sample = people[0] ? recipientVars(people[0]) : null;

  // Keep the draft when you click to another page and come back (or reload).
  const restored = useRef(false);
  useEffect(() => {
    const d = loadDraft();
    if (d.subject != null) setSubject(d.subject);
    if (d.body != null) setBody(d.body);
    if (d.format) setFormat(d.format);
    if (d.recipientsText != null) setRecipientsText(d.recipientsText);
    if (d.delayMin != null) setDelayMin(d.delayMin);
    if (d.delayMax != null) setDelayMax(d.delayMax);
    restored.current = true;
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ subject, body, format, recipientsText, delayMin, delayMax }));
    } catch {}
  }, [subject, body, format, recipientsText, delayMin, delayMax]);
  const usable = mailboxes.filter((m) => m.connection === 'connected' && !m.paused);
  const chosen = picked ?? new Set(usable.map((m) => m.id));
  const running = progress.campaign?.status === 'running';

  useEffect(() => {
    api('/api/mailboxes').then((d) => setMailboxes(d.mailboxes)).catch((e) => setErr(e.message));
  }, []);

  // While a send is running: tick the queue (sends what's due) and poll progress + logs.
  useEffect(() => {
    if (!campaignId) return;
    let stop = false;
    let ticking = false;
    const poll = async () => {
      try {
        const p = await api(`/api/campaigns/${campaignId}/progress?after=${lastLog.current}`);
        if (p.logs.length) {
          lastLog.current = p.logs[p.logs.length - 1].id;
          setLogs((prev) => [...prev, ...p.logs].slice(-400));
        }
        setProgress(p);
        if (p.campaign.status === 'running' && !ticking) {
          ticking = true;
          api('/api/queue/tick', { method: 'POST' }).catch(() => {}).finally(() => { ticking = false; });
        }
        if (p.campaign.status !== 'running') return;
      } catch (e) {
        setErr(e.message);
      }
      if (!stop) setTimeout(poll, 2000);
    };
    poll();
    return () => { stop = true; };
  }, [campaignId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  async function filesToPayload() {
    return Promise.all(files.map((f) => new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve({ filename: f.name, type: f.type, content: r.result });
      r.readAsDataURL(f);
    })));
  }

  async function start() {
    setErr('');
    if (!chosen.size) return setErr('Select at least one connected mailbox (add/test one in Mailbox Accounts).');
    if (!found.length) return setErr('No recipient emails detected.');
    if (!subjects.length) return setErr('Write at least one subject.');
    const size = files.reduce((a, f) => a + f.size, 0);
    if (size > 3 * 1024 * 1024) return setErr('Attachments must be under 3 MB in total (Vercel request limit).');
    try {
      const attachments = await filesToPayload();
      const r = await api('/api/quick-send', {
        method: 'POST',
        body: { subject, body, format, recipientsText, delayMin, delayMax, attachments, mailboxIds: [...chosen] },
      });
      lastLog.current = 0;
      setLogs([]);
      setCampaignId(r.campaignId);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function stopSend() {
    await api(`/api/campaigns/${campaignId}/stop`, { method: 'POST' }).catch((e) => setErr(e.message));
  }

  const togglePick = (id) => {
    const n = new Set(chosen);
    n.has(id) ? n.delete(id) : n.add(id);
    setPicked(n);
  };

  return (
    <>
      <PageHeader title="Campaigns" sub="Quick send — rotates recipients round-robin across the selected mailboxes, respecting each daily cap." />
      {err && <div className="error-box">{err}</div>}

      <div className="panel">
        <h2>Compose</h2>
        <div className="field">
          <label>Subjects — one per line ({subjects.length}). Each recipient gets one, in rotation.</label>
          <textarea rows={3} value={subject} onChange={(e) => setSubject(e.target.value)}
                    placeholder={'Quick question, {first_name}\nHi {first_name}, about your role at …'} />
          <div className="hint">Personalize subject and message with <code>{'{name}'}</code> <code>{'{first_name}'}</code> <code>{'{email}'}</code>. Fallback if a name is missing: <code>{'{first_name|there}'}</code></div>
        </div>
        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>Message</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label className="check"><input type="radio" name="fmt" checked={format === 'text'} onChange={() => setFormat('text')} /> Plain text</label>
              <label className="check"><input type="radio" name="fmt" checked={format === 'html'} onChange={() => setFormat('html')} /> HTML</label>
            </div>
          </div>
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="field">
          <label>Recipients — one per line, name optional: <code>Rahul Sharma, rahul@x.com</code> (Excel/Sheets paste works too)</label>
          <textarea rows={5} value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)}
                    placeholder={'Rahul Sharma, rahul@x.com\nPriya <priya@y.com>\nc@z.com'} />
          <div className="count">{found.length} email(s) detected, {named} with a name</div>
          {sample && subjects[0] && (
            <div className="hint">Preview for {sample.email}: <b>{renderTemplate(subjects[0], sample)}</b></div>
          )}
        </div>
        <div className="field">
          <label>Attachments (optional, max 3 MB total)</label>
          <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files))} />
        </div>
        <div className="row">
          <div className="field"><label>Gap min (seconds)</label><input type="number" min="0" value={delayMin} onChange={(e) => setDelayMin(e.target.value)} /></div>
          <div className="field"><label>Gap max (seconds)</label><input type="number" min="0" value={delayMax} onChange={(e) => setDelayMax(e.target.value)} /></div>
        </div>

        <div className="field">
          <label>Sending mailboxes ({chosen.size} of {usable.length} selected)</label>
          <div className="mb-pick">
            {usable.length === 0 && <div className="muted">No connected mailboxes. <a href="/mailboxes">Add one</a>.</div>}
            {usable.map((m) => (
              <label className="check" key={m.id}>
                <input type="checkbox" checked={chosen.has(m.id)} onChange={() => togglePick(m.id)} />
                {m.email} <span className="muted">{m.sent_today}/{m.daily_cap || '∞'} today</span>
              </label>
            ))}
          </div>
        </div>

        {!running ? <button onClick={start}>Start sending</button> : <button className="stop" onClick={stopSend}>Stop</button>}
        <p className="hint">Keep this page open while sending: it drives the queue every 2 seconds. Messages stay queued in the database if you close it and resume when you return.</p>
      </div>

      <div className="panel">
        <h2>Live status</h2>
        <div className="progress">
          <div>Sent: <b>{progress.sent}</b></div>
          <div>Failed: <b>{progress.failed}</b></div>
          <div>Pending: <b>{progress.pending}</b></div>
          <div>Total: <b>{progress.total}</b></div>
          <div>{progress.campaign ? progress.campaign.status : 'Idle'}</div>
        </div>
        <div className="log" ref={logRef}>
          {logs.map((l) => (
            <div key={l.id} className={'l-' + l.level}>[{new Date(l.created_at).toLocaleTimeString()}] {l.message}</div>
          ))}
          {logs.length === 0 && <div className="l-info">Waiting…</div>}
        </div>
      </div>
    </>
  );
}
