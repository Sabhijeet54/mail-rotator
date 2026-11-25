import { route } from '../../../../lib/api';
import { query, one } from '../../../../lib/db';
import { splitSubjects } from '../../../../lib/render';

export const PATCH = route(async (req, { params }) => {
  const b = await req.json();
  if (b.type === 'subjects') {
    const subjects = Array.isArray(b.subjects) ? splitSubjects(b.subjects.join('\n')) : splitSubjects(b.subjects);
    return { subjectList: await one(`UPDATE subject_lists SET name=$2, subjects=$3, updated_at=now() WHERE id=$1 RETURNING *`,
                                    [params.id, String(b.name || '').trim() || 'Subjects', subjects]) };
  }
  return { template: await one(`UPDATE templates SET name=$2, subject=$3, body=$4, format=$5, updated_at=now() WHERE id=$1 RETURNING *`,
                               [params.id, String(b.name || '').trim() || 'Template', b.subject || '', b.body || '',
                                b.format === 'html' ? 'html' : 'text']) };
});

export const DELETE = route(async (req, { params }) => {
  const type = new URL(req.url).searchParams.get('type');
  await query(`DELETE FROM ${type === 'subjects' ? 'subject_lists' : 'templates'} WHERE id = $1`, [params.id]);
  return { ok: true };
});
