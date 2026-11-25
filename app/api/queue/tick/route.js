import { route } from '../../../../lib/api';
import { tick } from '../../../../lib/jobs';

// Called every few seconds by the browser while any page of the app is open.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route(async () => tick({ budgetMs: 25000 }));
