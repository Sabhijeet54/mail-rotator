import { route } from '../../../../../lib/api';
import { stopCampaign } from '../../../../../lib/queue';

export const POST = route(async (_req, { params }) => {
  await stopCampaign(params.id);
  return { ok: true };
});
