/* Campuspilot — student self-registration. UNID must be the real "u" +
   7-digit format (e.g. u1621896) and a name is required -- a loosely
   typed value can no longer create an account, which is also what used
   to let a careless login through. Stored once here (Postgres), so this
   is the same account whichever device the student signs in from, and
   the one the admin roster (api/accounts/list) reflects immediately.

   There's no email/SMS service, so "forgot password" (login.js) points
   students back here: signing up again under their OWN UNID is how they
   regain access. Rather than rejecting that as "already registered" (the
   old behavior) or inserting a second row (which would let the student
   roster balloon with duplicates every time someone forgot a password),
   a signup for an existing UNID overwrites that one account's password/
   name/major in place -- joined_at (their original "member since" date)
   is left untouched. wasReset in the response tells the client which
   case happened, for the toast message. This does mean anyone who knows
   a UNID can reset its password without proving who they are -- the same
   trust level as the rest of this prototype (e.g. the admin passcode is
   a fixed, publicly-knowable "000000") and an accepted tradeoff for not
   having a real email-verification step. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ensureTables, sql, sendJson, requestBody, isValidUnid } from '../_db';

export const config = { runtime: 'nodejs' };

type JsonRequest = IncomingMessage & { body?: unknown; method?: string };

export default async function handler(req: JsonRequest, res: ServerResponse) {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed.' }); return; }
  try {
    await ensureTables();
    const body = requestBody(req) as { unid?: unknown; password?: unknown; name?: unknown; major?: unknown; major2?: unknown };
    const unid = String(body.unid || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    const major = String(body.major || '').trim();
    const major2 = String(body.major2 || '').trim();

    if (!isValidUnid(unid)) {
      sendJson(res, 400, { ok: false, error: 'UNID must be "u" followed by 7 digits, e.g. u1621896.' });
      return;
    }
    if (!password || !name) {
      sendJson(res, 400, { ok: false, error: 'Fill in your UNID, name, and password.' });
      return;
    }

    const joinedAt = Date.now();
    const result = await sql`INSERT INTO accounts (unid, password, name, major, major2, joined_at)
      VALUES (${unid}, ${password}, ${name}, ${major}, ${major2}, ${joinedAt})
      ON CONFLICT (unid) DO UPDATE SET
        password = EXCLUDED.password,
        name = EXCLUDED.name,
        major = EXCLUDED.major,
        major2 = EXCLUDED.major2
      RETURNING unid, name, major, major2, joined_at, (xmax = 0) AS was_inserted`;

    const row = result.rows[0] as any;
    sendJson(res, 200, {
      ok: true,
      wasReset: !row.was_inserted,
      account: { unid: row.unid, name: row.name, major: row.major, major2: row.major2, joinedAt: Number(row.joined_at) }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Server error.';
    sendJson(res, 500, { ok: false, error: message });
  }
}
