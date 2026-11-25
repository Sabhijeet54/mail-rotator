import { route } from '../../../../lib/api';
import { runJob } from '../../../../lib/jobs';

export const maxDuration = 60;

export const POST = route(async () => runJob('check-replies', 50000));
