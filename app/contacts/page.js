'use client';

import { useCallback, useEffect, useState } from 'react';
import Drawer from '../../components/Drawer';
import { api, PageHeader, StatCard, Field, timeAgo } from '../../components/ui';
import { readTable, rowsToPeople, downloadText, CONTACTS_SAMPLE } from '../../components/fileparse';

const EMPTY = { email: '', first_name: '', last_name: '', company: '', tags: '', consent: 'unknown' };
const CONSENT = { opted_in: ['ok', 'Opted in'], unknown: ['muted', 'Unknown'], opted_out: ['bad', 'Opted out'] };

export default function ContactsPage() {
  const [data, setData] = useState({ contacts: [], total: 0, tags: [] });
  const [filters, setFilters] = useState({ search: '', tag: '', consent: '' });
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState(new Set());
  const [drawer, setDrawer] = useState(null); // {type:'add'|'edit'|'import', contact?}
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), limit });
      setData(await api('/api/contacts?' + qs));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters, limit]);

  useEffect(() => {
    const t = setTimeout(load, filters.search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, filters.search]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  const list = data.contacts;
  const sel = [...selected].filter((id) => list.some((c) => c.id === id));
  const allChecked = list.length > 0 && list.every((c) => selected.has(c.id));
  const toggle = (id) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  async function removeSelected() {
    if (!confirm(`Delete ${sel.length} contact(s)? This can't be undone.`)) return;
    try {
      const r = await api('/api/contacts/bulk-delete', { method: 'POST', body: { ids: sel } });
      setFlash(`Deleted ${r.removed} contact(s)`);
      setSelected(new Set());
      load();
    } catch (e) { setError(e.message); }
  }

  const exportUrl = '/api/contacts?' + new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), format: 'csv' });
  const optedIn = list.filter((c) => c.consent === 'opted_in').length;
  const replied = list.filter((c) => c.replied_at).length;

  return (
    <>
      <PageHeader
        title="Contacts"
        sub="Your people with first name, last name and email. Use them in Campaigns: {first_name} {last_name} {company} are filled in for each person."
        actions={
          <>
            <button className="ghost" onClick={() => downloadText('contacts-template.csv', CONTACTS_SAMPLE)}>Download template</button>
            <a href={exportUrl}><button className="ghost">Export CSV</button></a>
            <button className="ghost" onClick={() => setDrawer({ type: 'import' })}>Upload CSV / Excel</button>
            <button onClick={() => setDrawer({ type: 'add' })}>+ Add contact</button>
          </>
        }
      />

      <div className="stats">
        <StatCard label="Total contacts" value={loading ? '—' : data.total} />
        <StatCard label="Tags / lists" value={data.tags.length} />
        <StatCard label="Opted in (shown)" value={optedIn} tone="ok" />
        <StatCard label="Replied (shown)" value={replied} tone="ok" />
      </div>

      {error && <div className="error-box">{error}</div>}
      {flash && <div className="ok-box">{flash}</div>}

      <div className="toolbar">
        <input className="grow" placeholder="Search name, email or company…" value={filters.search}
               onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        <select aria-label="Tag" value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })}>
          <option value="">All tags</option>
          {data.tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
        </select>
        <select aria-label="Consent" value={filters.consent} onChange={(e) => setFilters({ ...filters, consent: e.target.value })}>
          <option value="">Any consent</option>
          <option value="opted_in">Opted in</option>
          <option value="unknown">Unknown</option>
          <option value="opted_out">Opted out</option>
        </select>
      </div>

      {sel.length > 0 && (
        <div className="toolbar">
          <span className="muted">{sel.length} selected</span>
          <button className="danger sm" onClick={removeSelected}>Delete</button>
          <button className="ghost sm" onClick={() => setSelected(new Set())}>Deselect</button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" aria-label="Select all" checked={allChecked}
                       onChange={() => setSelected(allChecked ? new Set() : new Set(list.map((c) => c.id)))} />
              </th>
              <th>First name</th><th>Last name</th><th>Email</th><th>Company</th><th>Tags</th><th>Consent</th>
              <th>Campaigns</th><th>Added</th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const [tone, label] = CONSENT[c.consent] || CONSENT.unknown;
              return (
                <tr key={c.id}>
                  <td><input type="checkbox" aria-label={`Select ${c.email}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td>{c.first_name || <span className="muted">—</span>}</td>
                  <td>{c.last_name || <span className="muted">—</span>}</td>
                  <td>{c.email} {c.suppressed && <span className="pill bad" title="On the Suppression List">suppressed</span>}</td>
                  <td>{c.company || <span className="muted">—</span>}</td>
                  <td style={{ whiteSpace: 'normal' }}>{c.tags.map((t) => <span key={t} className="tag" style={{ marginRight: 4 }}>{t}</span>)}</td>
                  <td><span className={'pill ' + tone}><span className="dot" />{label}</span></td>
                  <td className="num">{c.campaigns}{c.replied_at && <span className="pill ok" style={{ marginLeft: 6 }}>replied</span>}</td>
                  <td className="muted">{timeAgo(c.created_at)}</td>
                  <td><div className="row-actions"><button className="ghost sm" onClick={() => setDrawer({ type: 'edit', contact: c })}>Edit</button></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && list.length === 0 && (
          <div className="empty">
            No contacts yet. <a href="#" onClick={(e) => { e.preventDefault(); setDrawer({ type: 'import' }); }}>Upload a CSV / Excel file</a> with
            columns <code>first_name, last_name, email</code>.
          </div>
        )}
      </div>
      {data.total > list.length && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="ghost" onClick={() => setLimit(limit + 200)}>Show more ({list.length} of {data.total})</button>
        </div>
      )}

      <Drawer open={drawer?.type === 'import'} title="Upload contacts" subtitle="CSV or Excel (.xlsx) with first name, last name and email"
              onClose={() => setDrawer(null)} width={620}>
        <ImportContacts tags={data.tags} onDone={(msg) => { setDrawer(null); setFlash(msg); load(); }} />
      </Drawer>

      <ContactDrawer drawer={drawer} onClose={() => setDrawer(null)}
                     onSaved={(msg) => { setDrawer(null); setFlash(msg); load(); }} />
    </>
  );
}

function ImportContacts({ tags, onDone }) {
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onFile(f) {
    setErr('');
    setParsed(null);
    if (!f) return;
    setFileName(f.name);
    try {
      const rows = await readTable(f);
      const res = rowsToPeople(rows);
      if (!res.people.length) throw new Error('No email addresses found in this file. Make sure it has an "email" column.');
      setParsed(res);
      if (!tag) setTag(f.name.replace(/\.(csv|xlsx|txt|tsv)$/i, '').slice(0, 40));
    } catch (e) {
      setErr(e.message);
    }
  }

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const r = await api('/api/contacts/import', { method: 'POST', body: { rows: parsed.people, tags: tag ? [tag] : [] } });
      onDone(`Imported: ${r.added} new, ${r.updated} already existed (updated)` + (r.errors.length ? `, ${r.errors.length} skipped` : ''));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel" style={{ background: 'var(--panel-2)' }}>
        <b>File format</b>
        <div className="hint" style={{ fontSize: 12 }}>
          First row = headings. Recognised: <code>first_name</code>, <code>last_name</code>, <code>email</code>, <code>company</code>, <code>tags</code>
          (also "First Name", "Surname", "Email ID", "Name"…). Any other column becomes a placeholder too, e.g. a column
          <code>role</code> → <code>{'{{role}}'}</code>. Names are auto-capitalised (rahul → Rahul).
        </div>
        <button className="ghost sm" style={{ marginTop: 8 }} onClick={() => downloadText('contacts-template.csv', CONTACTS_SAMPLE)}>Download sample CSV</button>
      </div>
      {err && <div className="error-box">{err}</div>}
      <Field label="Choose file (.csv, .xlsx, .txt)">
        <input type="file" accept=".csv,.xlsx,.xls,.txt,.tsv" onChange={(e) => onFile(e.target.files[0])} />
      </Field>
      {parsed && (
        <>
          <div className="ok-box">
            {fileName}: <b>{parsed.people.length}</b> contacts found{parsed.skipped ? `, ${parsed.skipped} rows without a valid email skipped` : ''}.
            <div style={{ marginTop: 4 }}>Columns: {parsed.columns.join(' · ')}</div>
          </div>
          <Field label="Tag these contacts as (a list name, to pick them later in Campaigns)">
            <input list="tag-list" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. HR Bangalore Nov" />
            <datalist id="tag-list">{tags.map((t) => <option key={t.tag} value={t.tag} />)}</datalist>
          </Field>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>First</th><th>Last</th><th>Email</th><th>Company</th></tr></thead>
              <tbody>
                {parsed.people.slice(0, 50).map((p) => (
                  <tr key={p.email}><td>{p.first_name}</td><td>{p.last_name}</td><td>{p.email}</td><td>{p.company}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.people.length > 50 && <div className="hint">Showing first 50 of {parsed.people.length}.</div>}
          <div style={{ marginTop: 14 }}><button disabled={busy} onClick={save}>{busy ? 'Importing…' : `Import ${parsed.people.length} contacts`}</button></div>
        </>
      )}
    </>
  );
}

function ContactDrawer({ drawer, onClose, onSaved }) {
  const open = drawer?.type === 'add' || drawer?.type === 'edit';
  const editing = drawer?.type === 'edit' ? drawer.contact : null;
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr('');
    setF(editing ? { ...editing, tags: editing.tags.join(', ') } : EMPTY);
  }, [open, editing]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setErr('');
    try {
      if (editing) await api(`/api/contacts/${editing.id}`, { method: 'PATCH', body: f });
      else await api('/api/contacts', { method: 'POST', body: f });
      onSaved(editing ? 'Contact saved' : 'Contact added');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${editing.email}?`)) return;
    try {
      await api(`/api/contacts/${editing.id}`, { method: 'DELETE' });
      onSaved('Contact deleted');
    } catch (e) { setErr(e.message); }
  }

  return (
    <Drawer open={open} title={editing ? 'Edit contact' : 'Add contact'} subtitle={editing?.email} onClose={onClose}
            footer={<>
              {editing && <button className="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</button>}
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </>}>
      {err && <div className="error-box">{err}</div>}
      <div className="row">
        <Field label="First name"><input value={f.first_name} onChange={set('first_name')} /></Field>
        <Field label="Last name"><input value={f.last_name} onChange={set('last_name')} /></Field>
      </div>
      <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Company"><input value={f.company} onChange={set('company')} /></Field>
      <Field label="Tags (comma separated)"><input value={f.tags} onChange={set('tags')} placeholder="HR, Bangalore" /></Field>
      <Field label="Consent" hint="Opted out = never emailed (also added to the Suppression List).">
        <select value={f.consent} onChange={set('consent')}>
          <option value="unknown">Unknown</option>
          <option value="opted_in">Opted in</option>
          <option value="opted_out">Opted out</option>
        </select>
      </Field>
      {editing && Object.keys(editing.fields || {}).length > 0 && (
        <>
          <h3>Extra fields (usable as placeholders)</h3>
          <dl className="kv">
            {Object.entries(editing.fields).flatMap(([k, v]) => [<dt key={k}>{`{{${k}}}`}</dt>, <dd key={k + '_v'}>{String(v)}</dd>])}
          </dl>
        </>
      )}
    </Drawer>
  );
}
