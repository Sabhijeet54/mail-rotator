'use client';

import { useCallback, useEffect, useState } from 'react';
import Drawer from '../../components/Drawer';
import { api, PageHeader, Field, timeAgo } from '../../components/ui';
import { readTable, rowsToSubjects, downloadText, SUBJECTS_SAMPLE } from '../../components/fileparse';
import { renderTemplate, splitSubjects } from '../../lib/render';

const SAMPLE_VARS = { first_name: 'Rahul', last_name: 'Sharma', name: 'Rahul Sharma', email: 'rahul@example.com', company: 'Acme' };

export default function TemplatesPage() {
  const [data, setData] = useState({ templates: [], subjectLists: [] });
  const [tab, setTab] = useState('subjects');
  const [drawer, setDrawer] = useState(null); // {type:'template'|'subjects', item?}
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(() => api('/api/templates').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  async function remove(type, item) {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await api(`/api/templates/${item.id}?type=${type}`, { method: 'DELETE' });
      setFlash('Deleted');
      load();
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      <PageHeader
        title="Templates"
        sub="Saved subject lists (rotated when sending) and reusable messages. Pick them in Campaigns."
        actions={tab === 'subjects'
          ? <button onClick={() => setDrawer({ type: 'subjects' })}>+ New subject list</button>
          : <button onClick={() => setDrawer({ type: 'template' })}>+ New message template</button>}
      />
      {error && <div className="error-box">{error}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      <div className="tabs">
        <button className={'tab' + (tab === 'subjects' ? ' active' : '')} onClick={() => setTab('subjects')}>
          Subject lists<span className="n">{data.subjectLists.length}</span>
        </button>
        <button className={'tab' + (tab === 'templates' ? ' active' : '')} onClick={() => setTab('templates')}>
          Message templates<span className="n">{data.templates.length}</span>
        </button>
      </div>

      {tab === 'subjects' && (
        <>
          <div className="panel">
            <h2>Why many subjects?</h2>
            <div className="muted" style={{ lineHeight: 1.6 }}>
              Sending the same subject to 100 people from one mailbox looks like bulk mail to Gmail/Outlook. Upload 50–150 subjects
              (e.g. ask ChatGPT: “give me 100 short, personal email subject lines for job applications, use {'{first_name}'} in some”).
              When you send, every mailbox walks through the list from a different starting point, so no mailbox repeats a subject
              back-to-back and two mailboxes never send the same one at the same moment.
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Subjects</th><th>Examples</th><th>Updated</th><th></th></tr></thead>
              <tbody>
                {data.subjectLists.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td className="num">{l.count || 0}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 460 }} className="muted">{l.subjects.slice(0, 3).join('  ·  ')}{l.count > 3 ? '  …' : ''}</td>
                    <td className="muted">{timeAgo(l.updated_at)}</td>
                    <td><div className="row-actions">
                      <button className="ghost sm" onClick={() => downloadText(`${l.name}.csv`, 'subject\n' + l.subjects.map((s) => `"${s.replace(/"/g, '""')}"`).join('\n'))}>Download</button>
                      <button className="ghost sm" onClick={() => setDrawer({ type: 'subjects', item: l })}>Edit</button>
                      <button className="danger sm" onClick={() => remove('subjects', l)}>Delete</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.subjectLists.length === 0 && <div className="empty">No subject lists yet. Click “+ New subject list” and upload an Excel/CSV file.</div>}
          </div>
        </>
      )}

      {tab === 'templates' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Subject</th><th>Format</th><th>Preview</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {data.templates.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{splitSubjects(t.subject)[0] || '—'}</td>
                  <td><span className="tag">{t.format}</span></td>
                  <td className="muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{renderTemplate(t.body, SAMPLE_VARS).slice(0, 90)}</td>
                  <td className="muted">{timeAgo(t.updated_at)}</td>
                  <td><div className="row-actions">
                    <button className="ghost sm" onClick={() => setDrawer({ type: 'template', item: t })}>Edit</button>
                    <button className="danger sm" onClick={() => remove('template', t)}>Delete</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.templates.length === 0 && <div className="empty">No message templates yet. You can also save one from Campaigns → “Save as template”.</div>}
        </div>
      )}

      <SubjectListDrawer open={drawer?.type === 'subjects'} item={drawer?.item} onClose={() => setDrawer(null)}
                         onSaved={(m) => { setDrawer(null); setFlash(m); load(); }} />
      <TemplateDrawer open={drawer?.type === 'template'} item={drawer?.item} onClose={() => setDrawer(null)}
                      onSaved={(m) => { setDrawer(null); setFlash(m); load(); }} />
    </>
  );
}

function SubjectListDrawer({ open, item, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr('');
    setName(item?.name || '');
    setText(item ? item.subjects.join('\n') : '');
  }, [open, item]);
  const list = splitSubjects(text);

  async function onFile(f) {
    if (!f) return;
    setErr('');
    try {
      const s = rowsToSubjects(await readTable(f));
      if (!s.length) throw new Error('No subjects found in this file.');
      setText((prev) => [prev.trim(), ...s].filter(Boolean).join('\n'));
      if (!name) setName(f.name.replace(/\.(csv|xlsx|txt|tsv)$/i, ''));
    } catch (e) { setErr(e.message); }
  }

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const body = { type: 'subjects', name, subjects: text };
      if (item) await api(`/api/templates/${item.id}`, { method: 'PATCH', body });
      else await api('/api/templates', { method: 'POST', body });
      onSaved(`Saved "${name}" with ${list.length} subjects`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Drawer open={open} title={item ? 'Edit subject list' : 'New subject list'} onClose={onClose} width={620}
            footer={<><button className="ghost" onClick={onClose}>Cancel</button><button disabled={busy || !list.length || !name.trim()} onClick={save}>{busy ? 'Saving…' : `Save ${list.length} subjects`}</button></>}>
      {err && <div className="error-box">{err}</div>}
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Job application subjects" /></Field>
      <div className="field" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="ghost-file">Upload CSV / Excel / TXT<input type="file" accept=".csv,.xlsx,.txt,.tsv" onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} /></label>
        <button className="ghost sm" onClick={() => downloadText('subjects-template.csv', SUBJECTS_SAMPLE)}>Download sample</button>
        <span className="hint" style={{ margin: 0 }}>Uses the column named “subject”, or the first column.</span>
      </div>
      <Field label={`Subjects — one per line (${list.length}, duplicates removed)`}>
        <textarea rows={16} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Quick question, {first_name}\nAre you hiring, {first_name}?'} />
      </Field>
      {list.length > 0 && (
        <div className="hint">Example for Rahul Sharma at Acme: <b>{renderTemplate(list[0], SAMPLE_VARS)}</b></div>
      )}
    </Drawer>
  );
}

function TemplateDrawer({ open, item, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', subject: '', body: '', format: 'text' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr('');
    setF(item ? { name: item.name, subject: item.subject, body: item.body, format: item.format } : { name: '', subject: '', body: '', format: 'text' });
  }, [open, item]);

  async function save() {
    setBusy(true);
    setErr('');
    try {
      if (item) await api(`/api/templates/${item.id}`, { method: 'PATCH', body: f });
      else await api('/api/templates', { method: 'POST', body: f });
      onSaved(`Template "${f.name}" saved`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Drawer open={open} title={item ? 'Edit template' : 'New message template'} onClose={onClose} width={640}
            footer={<><button className="ghost" onClick={onClose}>Cancel</button><button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      {err && <div className="error-box">{err}</div>}
      <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Subject(s) — one per line (optional)">
        <textarea rows={3} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
      </Field>
      <div className="field">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <label>Message</label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="check"><input type="radio" checked={f.format === 'text'} onChange={() => setF({ ...f, format: 'text' })} /> Plain text</label>
            <label className="check"><input type="radio" checked={f.format === 'html'} onChange={() => setF({ ...f, format: 'html' })} /> HTML</label>
          </div>
        </div>
        <textarea rows={12} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={'Hi {first_name|there},\n\n…'} />
        <div className="hint">Placeholders: {'{first_name} {last_name} {name} {email} {company}'} — fallback: {'{first_name|there}'}</div>
      </div>
      {f.body && (
        <>
          <h3>Preview (Rahul Sharma, Acme)</h3>
          <div className="msg-body">{f.format === 'html' ? renderTemplate(f.body, SAMPLE_VARS).replace(/<[^>]+>/g, '') : renderTemplate(f.body, SAMPLE_VARS)}</div>
        </>
      )}
    </Drawer>
  );
}
