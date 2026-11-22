'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { extractEmails } from '../lib/extract';

// ---- very simple demo gate (replace later) ----
const DEMO_USER = 'admin';
const DEMO_PASS = 'admin123';

const PROVIDERS = [
  { id: 'gmail', label: 'Gmail' },
  { id: 'outlook', label: 'Outlook / Office365' },
  { id: 'icloud', label: 'iCloud' },
  { id: 'yahoo', label: 'Yahoo' },
  { id: 'zoho', label: 'Zoho' },
  { id: 'custom', label: 'Custom SMTP' },
];

export default function Page() {
  const [authed, setAuthed] = useState(false);
  const [u, setU] = useState('');
  const [p, setP] = useState('');

  if (!authed) {
    return (
      <div className="container">
        <div className="center panel">
          <h2>Sign in</h2>
          <label>Username</label>
          <input value={u} onChange={(e) => setU(e.target.value)} />
          <label>Password</label>
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
          <div style={{ height: 14 }} />
          <button
            onClick={() => {
              if (u === DEMO_USER && p === DEMO_PASS) setAuthed(true);
              else alert('Wrong credentials (demo: admin / admin123)');
            }}
          >
            Login
          </button>
          <p className="hint">Demo login only. For now: admin / admin123.</p>
        </div>
      </div>
    );
  }

  return <Dashboard />;
}

function Dashboard() {
  const socketRef = useRef(null);
  const logRef = useRef(null);

  const [accounts, setAccounts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, total: 0 });

  // add-account form
  const [provider, setProvider] = useState('gmail');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fromName, setFromName] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [adding, setAdding] = useState(false);

  // compose
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [delayMin, setDelayMin] = useState(10);
  const [delayMax, setDelayMax] = useState(30);
  const [files, setFiles] = useState([]);

  const found = extractEmails(recipientsText);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('accounts', (list) => setAccounts(list));
    socket.on('accounts_tick', () => socket.emit('get_accounts'));
    socket.on('status', (s) => setRunning(!!s.running));
    socket.on('progress', (pr) => setProgress(pr));
    socket.on('log', (entry) =>
      setLogs((prev) => [...prev.slice(-400), { ...entry, t: new Date().toLocaleTimeString() }])
    );

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  function addAccount() {
    if (!email || !password) return alert('Email and app password required');
    setAdding(true);
    socketRef.current.emit(
      'add_account',
      { provider, email, password, fromName, dailyLimit, host, port },
      (res) => {
        setAdding(false);
        if (res && res.ok) {
          setEmail('');
          setPassword('');
          setFromName('');
          setDailyLimit('');
          setHost('');
          setPort('');
        } else {
          alert('Could not add account: ' + (res ? res.error : 'unknown error'));
        }
      }
    );
  }

  async function filesToPayload() {
    const out = [];
    for (const f of files) {
      const content = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(f);
      });
      out.push({ filename: f.name, content });
    }
    return out;
  }

  async function start() {
    if (accounts.length === 0) return alert('Add at least one sender account first.');
    if (found.length === 0) return alert('No recipient emails detected.');
    const attachments = await filesToPayload();
    socketRef.current.emit('start', {
      subject,
      body,
      recipientsText,
      delayMin,
      delayMax,
      attachments,
    });
  }

  function stop() {
    socketRef.current.emit('stop');
  }

  return (
    <div className="container">
      <div className="topbar">
        <div>
          <h1>Mail Rotator</h1>
          <div className="sub">Rotating multi-account sender (SMTP)</div>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
          {accounts.length} account(s) connected
        </div>
      </div>

      {/* ADD ACCOUNT */}
      <div className="panel">
        <h2>Add sender account</h2>
        <div className="row">
          <div>
            <label>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Email address</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" />
          </div>
          <div>
            <label>App password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="app-specific password"
            />
          </div>
        </div>

        {provider === 'custom' && (
          <div className="row">
            <div>
              <label>SMTP host</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div>
              <label>Port</label>
              <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="465 or 587" />
            </div>
          </div>
        )}

        <div className="row">
          <div>
            <label>From name (optional)</label>
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your Name" />
          </div>
          <div>
            <label>Daily limit (0 = no limit)</label>
            <input value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} placeholder="0" />
          </div>
        </div>

        <div style={{ height: 14 }} />
        <button onClick={addAccount} disabled={adding}>
          {adding ? 'Verifying SMTP...' : 'Add account'}
        </button>
        <p className="hint">
          Use an <b>app password</b>, not your normal password. Gmail / iCloud / Yahoo: turn on 2-step
          verification, then generate an app password. Outlook basic-auth SMTP may be disabled on some
          accounts.
        </p>

        <div className="acc-list">
          {accounts.map((a) => (
            <div className="acc" key={a.id}>
              <div>
                <span className="badge">{a.provider}</span>
                {a.email}
                <div className="meta">
                  Sent today: {a.sentToday}
                  {a.dailyLimit ? ` / ${a.dailyLimit}` : ' (no limit)'}
                </div>
              </div>
              <button className="danger" onClick={() => socketRef.current.emit('remove_account', a.id)}>
                Remove
              </button>
            </div>
          ))}
          {accounts.length === 0 && <div className="hint">No accounts yet.</div>}
        </div>
      </div>

      {/* COMPOSE */}
      <div className="panel">
        <h2>Compose &amp; recipients</h2>
        <label>Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        <label>Message</label>
        <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />

        <label>Recipients (paste anything — emails are auto-extracted)</label>
        <textarea
          rows={5}
          value={recipientsText}
          onChange={(e) => setRecipientsText(e.target.value)}
          placeholder="a@x.com, b@y.com  some text  c@z.com ..."
        />
        <div className="count">{found.length} email(s) detected</div>

        <label>Attachments (optional)</label>
        <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files))} />

        <div className="row" style={{ marginTop: 10 }}>
          <div>
            <label>Gap min (seconds)</label>
            <input value={delayMin} onChange={(e) => setDelayMin(e.target.value)} />
          </div>
          <div>
            <label>Gap max (seconds)</label>
            <input value={delayMax} onChange={(e) => setDelayMax(e.target.value)} />
          </div>
        </div>

        <div style={{ height: 16 }} />
        {!running ? (
          <button onClick={start}>Start sending</button>
        ) : (
          <button className="stop" onClick={stop}>
            Stop
          </button>
        )}
      </div>

      {/* LIVE LOG */}
      <div className="panel">
        <h2>Live status</h2>
        <div className="progress">
          <div>
            Sent: <b>{progress.sent}</b>
          </div>
          <div>
            Failed: <b>{progress.failed}</b>
          </div>
          <div>
            Total: <b>{progress.total}</b>
          </div>
          <div>{running ? 'Running…' : 'Idle'}</div>
        </div>
        <div className="log" ref={logRef}>
          {logs.map((l, i) => (
            <div key={i} className={'l-' + l.type}>
              [{l.t}] {l.msg}
            </div>
          ))}
          {logs.length === 0 && <div className="l-info">Waiting…</div>}
        </div>
      </div>
    </div>
  );
}
