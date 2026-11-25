import { query } from './db';

export const DEFAULT_SETTINGS = {
  delayMin: 30,
  delayMax: 90,
  dailyCap: 50,
  footerEnabled: false,
  footerText: 'If you would rather not hear from me, just reply "unsubscribe".',
  autoSuppressUnsubscribe: true,
  stopOnReply: true,
};

export async function getSettings() {
  const rows = await query(`SELECT key, value FROM settings`);
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) s[r.key] = r.value;
  return s;
}

export async function saveSettings(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const def = DEFAULT_SETTINGS[k];
    const val = typeof def === 'number' ? Math.max(0, Number(v) || 0) : typeof def === 'boolean' ? !!v : String(v ?? '');
    await query(`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                [k, JSON.stringify(val)]);
  }
  return getSettings();
}
