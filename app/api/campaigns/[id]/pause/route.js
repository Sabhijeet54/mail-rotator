import { route } from '../../../../../lib/api';
import { setCampaignPaused } from '../../../../../lib/queue';

export const POST = route(async (req, { params }) => {
  const { paused } = await req.json();
  await setCampaignPaused(params.id, !!paused);
  return { ok: true };
});
