import { route, notFound } from '../../../../../lib/api';
import { campaignProgress } from '../../../../../lib/queue';

export const dynamic = 'force-dynamic';

export const GET = route(async (req, { params }) => {
  const after = Number(new URL(req.url).searchParams.get('after')) || 0;
  const p = await campaignProgress(params.id, after);
  if (!p) throw notFound('Campaign not found');
  return p;
});
