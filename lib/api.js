import { NextResponse } from 'next/server';

// Wraps a route handler: JSON in/out, errors become { error } with status 400/500.
export function route(fn) {
  return async (req, ctx) => {
    try {
      const data = await fn(req, ctx);
      return data instanceof Response ? data : NextResponse.json(data ?? { ok: true });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: e.message || 'Server error' }, { status: e.status || 400 });
    }
  };
}

export const notFound = (what = 'Not found') => Object.assign(new Error(what), { status: 404 });
