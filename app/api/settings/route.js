import { route } from '../../../lib/api';
import { getSettings, saveSettings } from '../../../lib/settings';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  settings: await getSettings(),
  env: {
    database: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    encryptionKey: !!process.env.ENCRYPTION_KEY,
    cronSecret: !!process.env.CRON_SECRET,
  },
}));

export const PUT = route(async (req) => ({ settings: await saveSettings(await req.json()) }));
