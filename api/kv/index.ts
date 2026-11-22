/* Campuspilot — generic shared key/value store (api/kv).
   Every page's localStorage key (lost & found items, campus jobs posts,
   calendar events, course reviews, feedback, GradePilot's per-student
   workspace, etc.) also gets pulled from / pushed to this same table
   under the SAME key string, so the admin's view (and a student's own
   data, from any device) is never just "whatever happened to be saved
   in this one browser" -- see shared/session.js's cpSyncPull/cpSyncPush. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ensureTables, sql, sendJson, requestBody } from '../_db';

export const config = { runtime: 'nodejs' };

type JsonRequest = IncomingMessage & { body?: unknown; method?: string; url?: string };

export default async function handler(req: JsonRequest, res: ServerResponse) {
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const url = new URL(req.url || '', 'http://x');
      const keysParam = url.searchParams.get('keys') || '';
      const keys = keysParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (!keys.length) { sendJson(res, 200, {}); return; }
      const result = await sql.query('SELECT key, value FROM kv_store WHERE key = ANY($1)', [keys]);
      const out: Record<string, unknown> = {};
      for (const row of result.rows as any[]) out[row.key] = row.value;
      sendJson(res, 200, out);
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = requestBody(req) as { key?: unknown; value?: unknown };
      if (typeof body.key !== 'string' || !body.key) { sendJson(res, 400, { error: 'key is required' }); return; }
      const valueJson = JSON.stringify(body.value === undefined ? null : body.value);
      await sql`INSERT INTO kv_store (key, value, updated_at)
        VALUES (${body.key}, ${valueJson}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Server error.';
    sendJson(res, 500, { error: message });
  }
}
