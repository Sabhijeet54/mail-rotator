export const COLS = 'id, email, name, valid_from, valid_until, last_login_at, created_at';

// { validFrom, validUntil } (ISO strings) -> Dates, checked.
export function parseWindow(b) {
  const from = new Date(b.validFrom);
  const until = new Date(b.validUntil);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime())) throw new Error('Pick both the start and end date.');
  if (until <= from) throw new Error('The end date must be after the start date.');
  return { from, until };
}
