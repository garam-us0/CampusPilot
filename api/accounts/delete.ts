/* Campuspilot — admin-only: permanently removes one self-registered
   student account by UNID. Used by My Profile's registered-student
   roster (the trash icon on each row) -- this is a manual, one-row-at-
   a-time action an admin takes themselves, not an automatic "find and
   remove duplicates" job (unid is the accounts table's primary key, so
   a duplicate-UNID row isn't something that can exist there -- see
   api/_db.ts and api/accounts/signup.ts). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ensureTables, sql, sendJson, requestBody } from '../_db';

export const config = { runtime: 'nodejs' };

export default async function handler(req: IncomingMessage & { body?: unknown; method?: string }, res: ServerResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') { sendJson(res, 405, { error: 'Method not allowed.' }); return; }
  try {
    await ensureTables();
    const body = requestBody(req) as { unid?: unknown };
    const unid = typeof body.unid === 'string' ? body.unid.trim() : '';
    if (!unid) { sendJson(res, 400, { error: 'A UNID is required.' }); return; }
    const result = await sql`DELETE FROM accounts WHERE unid = ${unid}`;
    sendJson(res, 200, { ok: true, deleted: (result.rowCount ?? 0) > 0 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Server error.';
    sendJson(res, 500, { error: message });
  }
}
