import { route } from '../../../lib/api';
import { query, one } from '../../../lib/db';
import { splitSubjects } from '../../../lib/render';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  templates: await query(`SELECT * FROM templates ORDER BY updated_at DESC`),
  subjectLists: await query(`SELECT id, name, subjects, array_length(subjects, 1) AS count, updated_at
                             FROM subject_lists ORDER BY updated_at DESC`),
}));

export const POST = route(async (req) => {
  const b = await req.json();
  if (!String(b.name || '').trim()) throw new Error('Give it a name');
  if (b.type === 'subjects') {
    const subjects = Array.isArray(b.subjects) ? splitSubjects(b.subjects.join('\n')) : splitSubjects(b.subjects);
    if (!subjects.length) throw new Error('No subjects found');
    return { subjectList: await one(`INSERT INTO subject_lists (name, subjects) VALUES ($1,$2) RETURNING *`, [b.name.trim(), subjects]) };
  }
  return { template: await one(`INSERT INTO templates (name, subject, body, format) VALUES ($1,$2,$3,$4) RETURNING *`,
                               [b.name.trim(), b.subject || '', b.body || '', b.format === 'html' ? 'html' : 'text']) };
});
