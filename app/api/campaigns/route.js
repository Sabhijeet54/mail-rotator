import { route } from '../../../lib/api';
import { listCampaigns, enqueueSend } from '../../../lib/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route(async () => ({ campaigns: await listCampaigns() }));
export const POST = route(async (req) => enqueueSend(await req.json()));
