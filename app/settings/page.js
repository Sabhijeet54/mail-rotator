'use client';

import { useEffect, useState } from 'react';
import { api, PageHeader, Field } from '../../components/ui';

const ENV = [
  ['database', 'Database', 'Set DATABASE_URL (or POSTGRES_URL) in Vercel environment variables.'],
  ['encryptionKey', 'ENCRYPTION_KEY', 'Using an insecure built-in key. Set ENCRYPTION_KEY, then re-add mailboxes.'],
  ['login', 'Site login (APP_USER / APP_PASSWORD)', 'Site is open to anyone with the link. Set APP_USER and APP_PASSWORD.'],
  ['cronSecret', 'CRON_SECRET', 'Needed for background sending via cron. See Scheduled Jobs.'],
];

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [env, setEnv] = useState(null);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/settings').then((d) => { setS(d.settings); setEnv(d.env); }).catch((e) => setErr(e.message));
  }, []);

  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save() {
    setSaving(true);
    setErr('');
    setFlash('');
    try {
      const d = await api('/api/settings', { method: 'PUT', body: s });
      setS(d.settings);
      setFlash('Settings saved.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" sub="Defaults for sending, opt-out footer and reply handling." />
      {err && <div className="error-box">{err}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      {!s ? <div className="panel muted">Loading…</div> : (
        <div className="panel">
          <h2>Sending defaults</h2>
          <div className="row">
            <Field label="Gap min (seconds)"><input type="number" min="0" value={s.delayMin} onChange={set('delayMin')} /></Field>
            <Field label="Gap max (seconds)"><input type="number" min="0" value={s.delayMax} onChange={set('delayMax')} /></Field>
            <Field label="Default daily cap" hint="Used for newly added mailboxes. 0 = no cap.">
              <input type="number" min="0" value={s.dailyCap} onChange={set('dailyCap')} />
            </Field>
          </div>
          <div className="hint" style={{ marginTop: -6, marginBottom: 14 }}>Random wait between two emails. Pre-filled on the Campaigns compose form.</div>

          <h3>Opt-out footer</h3>
          <div className="field">
            <label className="check"><input type="checkbox" checked={!!s.footerEnabled} onChange={set('footerEnabled')} /> Add this line to the end of every email</label>
          </div>
          <Field label="Footer text">
            <textarea rows={2} value={s.footerText} onChange={set('footerText')} disabled={!s.footerEnabled} />
          </Field>

          <h3>Replies</h3>
          <div className="field">
            <label className="check"><input type="checkbox" checked={!!s.stopOnReply} onChange={set('stopOnReply')} /> Stop follow-ups and queued emails when the person replies</label>
          </div>
          <div className="field">
            <label className="check"><input type="checkbox" checked={!!s.autoSuppressUnsubscribe} onChange={set('autoSuppressUnsubscribe')} /> Add people who reply “unsubscribe” to the Suppression List automatically</label>
          </div>

          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      )}

      <div className="panel">
        <h2>Environment</h2>
        {!env ? <div className="muted">Loading…</div> : (
          <div className="mini-list">
            {ENV.map(([k, label, hint]) => (
              <div key={k} style={{ alignItems: 'center' }}>
                <span>{label}{!env[k] && <div className="hint" style={{ marginTop: 2 }}>{hint}</div>}</span>
                <span className={'pill ' + (env[k] ? 'ok' : 'warn')}><span className="dot" />{env[k] ? 'Set' : 'Missing'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
