import { route } from '../../../lib/api';
import { enqueueQuickSend } from '../../../lib/queue';

export const POST = route(async (req) => enqueueQuickSend(await req.json()));
