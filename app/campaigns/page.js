'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { extractRecipients } from '../../lib/extract';
import { renderTemplate, recipientVars, splitSubjects } from '../../lib/render';
import { api, PageHeader, Field, timeAgo } from '../../components/ui';
import { readTable, rowsToPeople, rowsToSubjects, downloadText, CONTACTS_SAMPLE, SUBJECTS_SAMPLE } from '../../components/fileparse';

// Compose + send. Recipients from an uploaded CSV/Excel file, saved Contacts, or a pasted list.
// Subjects: one per line (or uploaded / saved list); each mailbox rotates through them.
const DRAFT_KEY = 'mr.compose.draft.v2';
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') || {}; } catch { return {}; }
}

const STATUS_TONE = { running: 'ok', scheduled: 'warn', paused: 'warn', completed: 'muted', stopped: 'bad', draft: 'muted' };

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function CampaignsPage() {
  const [mailboxes, setMailboxes] = useState([]);
  const [picked, setPicked] = useState(null); // null = all
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [format, setFormat] = useState('text');
  const [source, setSource] = useState('file'); // file | contacts | paste
  const [recipientsText, setRecipientsText] = useState('');
  const [filePeople, setFilePeople] = useState(null); // {name, people, columns, skipped}
  const [saveToContacts, setSaveToContacts] = useState(true);
  const [contactTag, setContactTag] = useState('');
  const [contactInfo, setContactInfo] = useState({ total: 0, tags: [] });
  const [excludeUsed, setExcludeUsed] = useState(false);
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(90);
  const [when, setWhen] = useState('now'); // now | after | at
  const [afterValue, setAfterValue] = useState(1);
  const [afterUnit, setAfterUnit] = useState('hours');
  const [atTime, setAtTime] = useState(() => toLocalInput(new Date(Date.now() + 3600000)));
  const [files, setFiles] = useState([]);
  const [templates, setTemplates] = useState({ templates: [], subjectLists: [] });
  const [subjectListId, setSubjectListId] = useState('');
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);

  const [campaignId, setCampaignId] = useState(null);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, pending: 0, total: 0, campaign: null });
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);
  const lastLog = useRef(0);

  const subjects = splitSubjects(subject);
  const pasted = extractRecipients(recipientsText);
  const people = source === 'file' ? (filePeople?.people || []) : source === 'paste' ? pasted : [];
  const contactCount = source === 'contacts'
    ? (contactTag ? contactInfo.tags.find((t) => t.tag === contactTag)?.n || 0 : contactInfo.total) : 0;
  const recipientCount = source === 'contacts' ? contactCount : people.length;
  const samples = people.slice(0, 3).map(recipientVars);
  const usesName = /\{\{?\s*(first_name|last_name|name)\s*\}\}?/.test(subject + body);
  const missingNames = usesName ? people.filter((p) => !(p.first_name || p.name)).length : 0;

  // Draft survives page changes and reloads.
  const restored = useRef(false);
  useEffect(() => {
    const d = loadDraft();
    if (d.name != null) setName(d.name);
    if (d.subject != null) setSubject(d.subject);
    if (d.body != null) setBody(d.body);
    if (d.format) setFormat(d.format);
    if (d.source) setSource(d.source);
    if (d.recipientsText != null) setRecipientsText(d.recipientsText);
    if (d.filePeople) setFilePeople(d.filePeople);
    if (d.contactTag != null) setContactTag(d.contactTag);
    if (d.delayMin != null) setDelayMin(d.delayMin);
    if (d.delayMax != null) setDelayMax(d.delayMax);
    restored.current = true;
    if (d.delayMin == null) {
      api('/api/settings').then(({ settings }) => { setDelayMin(settings.delayMin); setDelayMax(settings.delayMax); }).catch(() => {});
    }
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, subject, body, format, source, recipientsText, filePeople,
                                                       contactTag, delayMin, delayMax }));
    } catch {}
  }, [name, subject, body, format, source, recipientsText, filePeople, contactTag, delayMin, delayMax]);

  const usable = mailboxes.filter((m) => m.connection === 'connected' && !m.paused);
  const chosen = picked ?? new Set(usable.map((m) => m.id));
  const running = progress.campaign?.status === 'running';

  const loadHistory = useCallback(() => api('/api/campaigns').then((d) => setHistory(d.campaigns)).catch(() => {}), []);
  const loadTemplates = useCallback(() => api('/api/templates').then(setTemplates).catch(() => {}), []);
  useEffect(() => {
    api('/api/mailboxes').then((d) => setMailboxes(d.mailboxes)).catch((e) => setErr(e.message));
    api('/api/contacts?limit=1').then((d) => setContactInfo({ total: d.total, tags: d.tags })).catch(() => {});
    loadTemplates();
    loadHistory();
    const t = setInterval(loadHistory, 15000);
    return () => clearInterval(t);
  }, [loadHistory, loadTemplates]);

  // While a send is running: tick the queue (sends what's due) and poll progress + logs.
  useEffect(() => {
    if (!campaignId) return;
    let stop = false;
    const poll = async () => {
      try {
        const p = await api(`/api/campaigns/${campaignId}/progress?after=${lastLog.current}`);
        if (p.logs.length) {
          lastLog.current = p.logs[p.logs.length - 1].id;
          setLogs((prev) => [...prev, ...p.logs].slice(-400));
        }
        setProgress(p);
        if (!['running', 'scheduled', 'paused'].includes(p.campaign.status)) { loadHistory(); return; }
      } catch (e) {
        setErr(e.message);
      }
      if (!stop) setTimeout(poll, progress.campaign?.status === 'scheduled' ? 10000 : 2000);
    };
    poll();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  async function onRecipientsFile(f) {
    setErr('');
    if (!f) return;
    try {
      const res = rowsToPeople(await readTable(f));
      if (!res.people.length) throw new Error('No email addresses found in this file. It needs an "email" column.');
      setFilePeople({ name: f.name, ...res });
    } catch (e) {
      setErr(e.message);
    }
  }

  async function onSubjectsFile(f) {
    setErr('');
    if (!f) return;
    try {
      const list = rowsToSubjects(await readTable(f));
      if (!list.length) throw new Error('No subjects found in this file.');
      setSubject(list.join('\n'));
      setSubjectListId('');
      setFlash(`${list.length} subjects loaded from ${f.name}. Click "Save list" to keep them for next time.`);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function saveSubjectList() {
    const n = prompt('Name for this subject list:', `Subjects ${new Date().toLocaleDateString()}`);
    if (!n) return;
    try {
      const r = await api('/api/templates', { method: 'POST', body: { type: 'subjects', name: n, subjects: subject } });
      setSubjectListId(r.subjectList.id);
      setFlash(`Saved "${n}" (${r.subjectList.subjects.length} subjects). Find it under Templates.`);
      loadTemplates();
    } catch (e) { setErr(e.message); }
  }

  async function saveTemplate() {
    const n = prompt('Template name:', name || 'My template');
    if (!n) return;
    try {
      await api('/api/templates', { method: 'POST', body: { name: n, subject, body, format } });
      setFlash(`Template "${n}" saved.`);
      loadTemplates();
    } catch (e) { setErr(e.message); }
  }

  function applyTemplate(id) {
    const t = templates.templates.find((x) => x.id === id);
    if (!t) return;
    if ((subject || body) && !confirm('Replace the current subject and message with this template?')) return;
    if (t.subject) setSubject(t.subject);
    setBody(t.body);
    setFormat(t.format);
  }

  function applySubjectList(id) {
    setSubjectListId(id);
    const l = templates.subjectLists.find((x) => x.id === id);
    if (l) setSubject(l.subjects.join('\n'));
  }

  function scheduledAt() {
    if (when === 'now') return null;
    if (when === 'after') {
      const ms = Number(afterValue) * (afterUnit === 'minutes' ? 60000 : afterUnit === 'days' ? 86400000 : 3600000);
      return new Date(Date.now() + ms).toISOString();
    }
    return new Date(atTime).toISOString();
  }

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
    if (!recipientCount) return setErr('No recipients. Upload a file, pick Contacts, or paste emails.');
    if (!subjects.length) return setErr('Write or upload at least one subject.');
    if (!body.trim()) return setErr('The message is empty.');
    const at = scheduledAt();
    if (at && new Date(at).getTime() < Date.now() - 60000) return setErr('The schedule time is in the past.');
    const size = files.reduce((a, f) => a + f.size, 0);
    if (size > 3 * 1024 * 1024) return setErr('Attachments must be under 3 MB in total (Vercel request limit).');
    const what = `${recipientCount} recipient(s) from ${chosen.size} mailbox(es), ${subjects.length} subject(s) rotating` +
                 (at ? `, starting ${new Date(at).toLocaleString()}` : ', starting now');
    if (!confirm(`Send to ${what}?`)) return;
    setBusy(true);
    try {
      const attachments = await filesToPayload();
      const r = await api('/api/campaigns', {
        method: 'POST',
        body: {
          name, subject, body, format, source, delayMin, delayMax, attachments, mailboxIds: [...chosen],
          recipientsText: source === 'paste' ? recipientsText : undefined,
          recipients: source === 'file' ? filePeople.people : undefined,
          contactTag: source === 'contacts' ? contactTag : undefined,
          saveToContacts: source !== 'contacts' && saveToContacts,
          contactTagForSave: source === 'file' ? filePeople?.name?.replace(/\.(csv|xlsx|txt|tsv)$/i, '') : '',
          excludeUsed, scheduledAt: at, subjectListId: subjectListId || null,
        },
      });
      lastLog.current = 0;
      setLogs([]);
      setCampaignId(r.campaignId);
      setFlash(r.status === 'scheduled'
        ? `Scheduled: ${r.total} emails will start at ${new Date(r.scheduledAt).toLocaleString()}.`
        : `Started: ${r.total} emails queued${r.suppressed ? `, ${r.suppressed} skipped (suppressed)` : ''}.`);
      loadHistory();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(id, action) {
    try {
      if (action === 'stop') {
        if (!confirm('Stop this campaign? Queued emails will be cancelled.')) return;
        await api(`/api/campaigns/${id}/stop`, { method: 'POST' });
      } else {
        await api(`/api/campaigns/${id}/pause`, { method: 'POST', body: { paused: action === 'pause' } });
      }
      loadHistory();
      if (id === campaignId) { lastLog.current = 0; setLogs([]); setCampaignId(null); setTimeout(() => setCampaignId(id), 0); }
    } catch (e) { setErr(e.message); }
  }

  function watch(id) {
    lastLog.current = 0;
    setLogs([]);
    setCampaignId(id);
    setTimeout(() => document.getElementById('live')?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  const togglePick = (id) => {
    const n = new Set(chosen);
    n.has(id) ? n.delete(id) : n.add(id);
    setPicked(n);
  };

  return (
    <>
      <PageHeader title="Campaigns" sub="Personalised sending: each person gets their own name, subjects rotate per mailbox, and recipients are spread across your mailboxes within each daily cap." />
      {err && <div className="error-box">{err}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>1. Message</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select aria-label="Use template" value="" onChange={(e) => applyTemplate(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Use a saved template…</option>
              {templates.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="ghost sm" onClick={saveTemplate} disabled={!body.trim()}>Save as template</button>
          </div>
        </div>
        <Field label="Campaign name (optional)">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR outreach – Bangalore" />
        </Field>

        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ margin: 0 }}>Subjects — one per line <b style={{ color: 'var(--accent)' }}>({subjects.length})</b></label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <select aria-label="Saved subject list" value={subjectListId} onChange={(e) => applySubjectList(e.target.value)} style={{ width: 'auto', padding: '4px 8px' }}>
                <option value="">Saved subject lists…</option>
                {templates.subjectLists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
              </select>
              <label className="ghost-file">
                Upload subjects (CSV / Excel)
                <input type="file" accept=".csv,.xlsx,.txt,.tsv" onChange={(e) => { onSubjectsFile(e.target.files[0]); e.target.value = ''; }} />
              </label>
              <button className="ghost sm" onClick={() => downloadText('subjects-template.csv', SUBJECTS_SAMPLE)}>Sample</button>
              <button className="ghost sm" onClick={saveSubjectList} disabled={subjects.length < 1}>Save list</button>
            </div>
          </div>
          <textarea rows={subjects.length > 6 ? 8 : 4} value={subject} onChange={(e) => { setSubject(e.target.value); setSubjectListId(''); }}
                    placeholder={'Quick question, {first_name}\n{first_name}, are you hiring for this role?\nApplication for the open position at {company|your company}'} />
          <div className="hint">
            Each mailbox rotates through these, so the same mailbox never sends the same subject twice in a row and different
            mailboxes use different subjects at the same time. Tip: ask ChatGPT for 100 subject lines, paste them in an Excel column
            named <code>subject</code>, upload. {subjects.length === 1 && <b style={{ color: 'var(--yellow)' }}>Only 1 subject — add more to look less like bulk mail.</b>}
          </div>
        </div>

        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>Message</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label className="check"><input type="radio" name="fmt" checked={format === 'text'} onChange={() => setFormat('text')} /> Plain text</label>
              <label className="check"><input type="radio" name="fmt" checked={format === 'html'} onChange={() => setFormat('html')} /> HTML</label>
            </div>
          </div>
          <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)}
                    placeholder={'Hi {first_name|there},\n\nI came across {company|your company} and …\n\nThanks,\nAbhijeet'} />
          <div className="hint">
            Placeholders: <code>{'{first_name}'}</code> <code>{'{last_name}'}</code> <code>{'{name}'}</code> <code>{'{email}'}</code> <code>{'{company}'}</code>,
            any extra file column as <code>{'{{column}}'}</code>. Fallback when empty: <code>{'{first_name|there}'}</code>.
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>2. Recipients <span className="count" style={{ marginLeft: 6 }}>{recipientCount} selected</span></h2>
        <div className="tabs">
          {[['file', 'Upload CSV / Excel'], ['contacts', 'From Contacts'], ['paste', 'Paste list']].map(([k, l]) => (
            <button key={k} className={'tab' + (source === k ? ' active' : '')} onClick={() => setSource(k)}>{l}</button>
          ))}
        </div>

        {source === 'file' && (
          <>
            <div className="field">
              <input type="file" accept=".csv,.xlsx,.txt,.tsv" onChange={(e) => onRecipientsFile(e.target.files[0])} />
              <div className="hint">
                Columns: <code>first_name</code>, <code>last_name</code>, <code>email</code> (optional <code>company</code> and any others).{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); downloadText('contacts-template.csv', CONTACTS_SAMPLE); }}>Download a sample file</a>.
              </div>
            </div>
            {filePeople && (
              <div className="ok-box">
                <b>{filePeople.name}</b>: {filePeople.people.length} people{filePeople.skipped ? `, ${filePeople.skipped} rows skipped (no valid email)` : ''}.
                <div>Columns: {filePeople.columns.join(' · ')}</div>
                <button className="ghost sm" style={{ marginTop: 6 }} onClick={() => setFilePeople(null)}>Clear file</button>
              </div>
            )}
            <label className="check"><input type="checkbox" checked={saveToContacts} onChange={(e) => setSaveToContacts(e.target.checked)} /> Also save these people to Contacts (tagged with the file name)</label>
          </>
        )}

        {source === 'contacts' && (
          <div className="field">
            <select value={contactTag} onChange={(e) => setContactTag(e.target.value)}>
              <option value="">All contacts ({contactInfo.total})</option>
              {contactInfo.tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
            </select>
            <div className="hint">Opted-out and suppressed contacts are skipped automatically. <Link href="/contacts">Manage contacts</Link></div>
          </div>
        )}

        {source === 'paste' && (
          <div className="field">
            <textarea rows={5} value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)}
                      placeholder={'Rahul Sharma, rahul@x.com\nPriya <priya@y.com>\nc@z.com'} />
            <div className="count">{pasted.length} email(s) detected, {pasted.filter((p) => p.name).length} with a name</div>
            <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={saveToContacts} onChange={(e) => setSaveToContacts(e.target.checked)} /> Also save to Contacts</label>
          </div>
        )}

        <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={excludeUsed} onChange={(e) => setExcludeUsed(e.target.checked)} /> Skip people already emailed in another campaign</label>
        {missingNames > 0 && (
          <div className="error-box" style={{ marginTop: 10 }}>
            {missingNames} recipient(s) have no name but your text uses a name placeholder. Add a fallback like <code>{'{first_name|there}'}</code>.
          </div>
        )}

        {samples.length > 0 && subjects.length > 0 && (
          <>
            <h3>Preview (what the first people receive)</h3>
            <div className="mini-list">
              {samples.map((v, i) => (
                <div key={v.email} style={{ flexDirection: 'column', gap: 4 }}>
                  <span className="muted">To: {v.name ? `${v.name} <${v.email}>` : v.email}</span>
                  <b>{renderTemplate(subjects[i % subjects.length], v)}</b>
                  <span style={{ whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>{renderTemplate(body, v).slice(0, 220)}{body.length > 220 ? '…' : ''}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>3. Sending</h2>
        <div className="field">
          <label>When</label>
          <div className="tabs">
            {[['now', 'Send now'], ['after', 'Send after…'], ['at', 'Pick date & time']].map(([k, l]) => (
              <button key={k} className={'tab' + (when === k ? ' active' : '')} onClick={() => setWhen(k)}>{l}</button>
            ))}
          </div>
          {when === 'after' && (
            <div className="row" style={{ maxWidth: 360 }}>
              <input type="number" min="1" value={afterValue} onChange={(e) => setAfterValue(e.target.value)} />
              <select value={afterUnit} onChange={(e) => setAfterUnit(e.target.value)}>
                <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
              </select>
            </div>
          )}
          {when === 'at' && <input type="datetime-local" value={atTime} onChange={(e) => setAtTime(e.target.value)} style={{ maxWidth: 260 }} />}
          {when !== 'now' && (
            <div className="hint">
              Starts at {scheduledAt() ? new Date(scheduledAt()).toLocaleString() : '—'}. Scheduled sends start while any page of this app is open,
              or always if the background cron is set up (<Link href="/jobs">Scheduled Jobs</Link>).
            </div>
          )}
        </div>
        <div className="row">
          <Field label="Gap between emails: min (seconds)"><input type="number" min="0" value={delayMin} onChange={(e) => setDelayMin(e.target.value)} /></Field>
          <Field label="max (seconds)"><input type="number" min="0" value={delayMax} onChange={(e) => setDelayMax(e.target.value)} /></Field>
        </div>
        <Field label="Attachments (optional, max 3 MB total)">
          <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files))} />
        </Field>
        <div className="field">
          <label>Sending mailboxes ({chosen.size} of {usable.length} selected)</label>
          <div className="mb-pick">
            {usable.length === 0 && <div className="muted">No connected mailboxes. <Link href="/mailboxes">Add one</Link>.</div>}
            {usable.map((m) => (
              <label className="check" key={m.id}>
                <input type="checkbox" checked={chosen.has(m.id)} onChange={() => togglePick(m.id)} />
                {m.email} <span className="muted">{m.sent_today}/{m.daily_cap || '∞'} today</span>
              </label>
            ))}
          </div>
        </div>
        <button onClick={start} disabled={busy}>
          {busy ? 'Starting…' : when === 'now' ? `Start sending to ${recipientCount}` : `Schedule ${recipientCount} emails`}
        </button>
      </div>

      <div className="panel" id="live">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Live status {progress.campaign && <span className="muted">— {progress.campaign.name}</span>}</h2>
          {progress.campaign && ['running', 'paused', 'scheduled'].includes(progress.campaign.status) && (
            <div style={{ display: 'flex', gap: 6 }}>
              {progress.campaign.status === 'running' && <button className="ghost sm" onClick={() => act(campaignId, 'pause')}>Pause</button>}
              {progress.campaign.status === 'paused' && <button className="ghost sm" onClick={() => act(campaignId, 'resume')}>Resume</button>}
              <button className="stop sm" onClick={() => act(campaignId, 'stop')}>Stop</button>
            </div>
          )}
        </div>
        <div className="progress" style={{ marginTop: 12 }}>
          <div>Sent: <b>{progress.sent}</b></div>
          <div>Failed: <b>{progress.failed}</b></div>
          <div>Pending: <b>{progress.pending}</b></div>
          <div>Total: <b>{progress.total}</b></div>
          <div>{progress.campaign ? progress.campaign.status : 'Idle'}{progress.campaign?.status === 'scheduled' && progress.campaign.scheduled_at
            ? ` — starts ${new Date(progress.campaign.scheduled_at).toLocaleString()}` : ''}</div>
        </div>
        <div className="log" ref={logRef}>
          {logs.map((l) => (
            <div key={l.id} className={'l-' + l.level}>[{new Date(l.created_at).toLocaleTimeString()}] {l.message}</div>
          ))}
          {logs.length === 0 && <div className="l-info">{running ? 'Waiting…' : 'Start a send, or click "Live" on a campaign below.'}</div>}
        </div>
      </div>

      <div className="panel">
        <h2>Recent campaigns</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Sent</th><th>Pending</th><th>Failed</th><th>Replies</th><th>Follow-ups</th><th>When</th><th></th></tr></thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{c.name}<div className="muted">{c.mailboxes}</div></td>
                  <td><span className={'pill ' + (STATUS_TONE[c.status] || 'muted')}><span className="dot" />{c.status}</span></td>
                  <td className="num">{c.sent}/{c.total_recipients || c.sent + c.pending + c.failed}</td>
                  <td className="num">{c.pending}</td>
                  <td className="num">{c.failed}</td>
                  <td className="num">{c.replied}</td>
                  <td><Link href={`/sequences?campaign=${c.id}`}>{c.steps ? `${c.steps} step(s)` : '+ Add'}</Link></td>
                  <td className="muted">{c.status === 'scheduled' ? `starts ${new Date(c.scheduled_at).toLocaleString()}` : timeAgo(c.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="ghost sm" onClick={() => watch(c.id)}>Live</button>
                      {c.status === 'running' && <button className="ghost sm" onClick={() => act(c.id, 'pause')}>Pause</button>}
                      {c.status === 'paused' && <button className="ghost sm" onClick={() => act(c.id, 'resume')}>Resume</button>}
                      {['running', 'paused', 'scheduled'].includes(c.status) && (
                        <button className="danger sm" onClick={() => act(c.id, 'stop')}>{c.status === 'scheduled' ? 'Cancel' : 'Stop'}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length === 0 && <div className="empty">No campaigns yet.</div>}
        </div>
      </div>
    </>
  );
}
