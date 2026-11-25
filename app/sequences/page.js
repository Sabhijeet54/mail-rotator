'use client';

import { useEffect, useState } from 'react';
import { api, PageHeader, timeAgo } from '../../components/ui';

const STATUS_TONE = { running: 'ok', scheduled: 'warn', paused: 'muted', completed: 'muted', stopped: 'bad', draft: 'muted' };

export default function SequencesPage() {
  const [campaigns, setCampaigns] = useState(null);
  const [sel, setSel] = useState(null);
  const [info, setInfo] = useState(null);
  const [steps, setSteps] = useState([]);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [saving, setSaving] = useState(false);

  const loadList = () => api('/api/campaigns').then((d) => setCampaigns(d.campaigns)).catch((e) => setErr(e.message));
  useEffect(() => {
    loadList();
    // Opened from Campaigns → "Follow-ups" link: /sequences?campaign=<id>
    const id = new URLSearchParams(window.location.search).get('campaign');
    if (id) open(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(id) {
    setSel(id);
    setErr('');
    setFlash('');
    try {
      const d = await api(`/api/campaigns/${id}/steps`);
      setInfo(d);
      setSteps(d.steps.map((s) => ({ delay_days: s.delay_days, subject: s.subject, body: s.body, sent: s.sent })));
    } catch (e) {
      setErr(e.message);
    }
  }

  const upd = (i, k, v) => setSteps(steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const add = () => setSteps([...steps, { delay_days: 3, subject: '', body: '', sent: 0 }]);
  const remove = (i) => setSteps(steps.filter((_, j) => j !== i));

  async function save() {
    setSaving(true);
    setErr('');
    try {
      await api(`/api/campaigns/${sel}/steps`, {
        method: 'PUT',
        body: { steps: steps.map(({ delay_days, subject, body }) => ({ delay_days, subject, body })) },
      });
      setFlash(`Saved ${steps.length} follow-up(s).`);
      loadList();
      open(sel);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Sequences" sub="Automatic follow-ups for people who haven't replied." />
      <div className="panel">
        <div className="hint" style={{ marginTop: 0, fontSize: 12 }}>
          Follow-ups are sent from the <b>same mailbox</b>, in the <b>same email thread</b>, a set number of days after the
          previous email. They stop automatically as soon as the person replies, unsubscribes or bounces.
        </div>
      </div>
      {err && <div className="error-box">{err}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      {campaigns && campaigns.length === 0 && (
        <div className="panel empty">No campaigns yet. <a href="/campaigns">Send a campaign</a> first, then add follow-ups here.</div>
      )}

      {campaigns && campaigns.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 18 }}>
          <table>
            <thead>
              <tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Replied</th><th>Follow-ups</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} style={sel === c.id ? { background: 'var(--accent-soft)' } : null}>
                  <td>{c.name}</td>
                  <td><span className={'pill ' + (STATUS_TONE[c.status] || 'muted')}><span className="dot" />{c.status}</span></td>
                  <td className="num">{c.sent}</td>
                  <td className="num">{c.replied}</td>
                  <td className="num">{c.steps}</td>
                  <td className="muted">{timeAgo(c.created_at)}</td>
                  <td><div className="row-actions"><button className="ghost sm" onClick={() => open(c.id)}>Edit follow-ups</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel && info && (
        <div className="panel">
          <h2>Follow-ups for “{info.campaign.name}”</h2>
          <div className="hint" style={{ marginBottom: 14 }}>
            Personalize with <code>{'{first_name}'}</code> <code>{'{last_name}'}</code> <code>{'{name}'}</code> <code>{'{company}'}</code>.
            Fallback: <code>{'{first_name|there}'}</code>. Message format follows the campaign ({info.campaign.format}).
          </div>
          {steps.length === 0 && <div className="muted" style={{ marginBottom: 12 }}>No follow-ups yet.</div>}
          {steps.map((s, i) => (
            <div key={i} className="panel" style={{ background: 'var(--panel-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <b>Follow-up {i + 1}</b>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="muted">{s.sent || 0} sent</span>
                  <button className="danger sm" onClick={() => remove(i)}>Remove</button>
                </div>
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="muted">Wait</span>
                <input type="number" min="0" style={{ width: 80 }} value={s.delay_days}
                       onChange={(e) => upd(i, 'delay_days', e.target.value)} />
                <span className="muted">days after the previous email, if no reply</span>
              </div>
              <div className="field">
                <label>Subject (optional — blank = “Re: original subject”, same thread)</label>
                <input value={s.subject} onChange={(e) => upd(i, 'subject', e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Message</label>
                <textarea rows={5} value={s.body} onChange={(e) => upd(i, 'body', e.target.value)}
                          placeholder={'Hi {first_name|there}, just following up on my previous email…'} />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={add}>+ Add follow-up</button>
            <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </>
  );
}
