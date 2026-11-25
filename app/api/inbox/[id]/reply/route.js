import { route } from '../../../../../lib/api';
import { replyToMessage } from '../../../../../lib/inbox';

export const maxDuration = 30;

export const POST = route(async (req, { params }) => replyToMessage(params.id, await req.json()));
