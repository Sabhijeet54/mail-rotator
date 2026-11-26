import { route } from '../../../../lib/api';
import { tick } from '../../../../lib/jobs';

// Manual trigger. Normally not needed: lib/worker.js runs the same tick inside the server.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route(async () => tick({ budgetMs: 25000 }));
