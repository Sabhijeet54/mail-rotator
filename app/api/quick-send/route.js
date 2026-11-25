import { route } from '../../../lib/api';
import { enqueueSend } from '../../../lib/queue';

export const maxDuration = 60;

export const POST = route(async (req) => enqueueSend(await req.json()));
