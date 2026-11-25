import { route } from '../../../../lib/api';
import { updateContact, removeContacts } from '../../../../lib/contacts';

export const PATCH = route(async (req, { params }) => ({ contact: await updateContact(params.id, await req.json()) }));
export const DELETE = route(async (_req, { params }) => ({ removed: await removeContacts([params.id]) }));
