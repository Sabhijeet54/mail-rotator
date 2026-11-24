import { route } from '../../../../lib/api';
import { processQueue, recordJobRun } from '../../../../lib/queue';

// Called every few seconds by the browser while a send screen is open.
export const maxDuration = 60;

export const POST = route(async () => recordJobRun('process-queue', () => processQueue({ budgetMs: 20000 })));
