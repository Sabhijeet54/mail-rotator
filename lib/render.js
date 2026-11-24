// {{first_name}}  or with fallback  {{first_name|there}}
export function renderTemplate(text, vars = {}) {
  return String(text || '').replace(/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g, (_, key, fallback) => {
    const v = vars[key];
    return v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : (fallback ?? '').trim();
  });
}
