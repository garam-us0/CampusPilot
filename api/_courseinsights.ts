import { db } from '@vercel/postgres';

export const COURSE_INSIGHTS_KEY = 'campuspilot.courseinsights.v1';

type Course = Record<string, unknown> & { id: string; active?: boolean; deleted_at?: string };
export type CourseSnapshot = Record<string, unknown> & { courses: Course[]; reviews: unknown[]; reports: unknown[] };

export function isCourseSnapshot(value: unknown): value is CourseSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as CourseSnapshot;
  return Array.isArray(s.courses) && Array.isArray(s.reviews) && Array.isArray(s.reports)
    && s.courses.every(c => c && typeof c.id === 'string' && c.id.length > 0);
}

function withoutDeletionMarker(course: Course): Course {
  const copy = { ...course };
  delete copy.deleted_at;
  return copy;
}

// Keep omitted courses and preserve server-created deletion markers. Old or
// untrusted whole-snapshot writes must not delete or resurrect a course.
export function mergeCourseSnapshot(current: CourseSnapshot, incoming: CourseSnapshot): CourseSnapshot {
  const byId = new Map(current.courses.map(c => [c.id, c]));
  for (const course of incoming.courses) {
    if (!byId.get(course.id)?.deleted_at) byId.set(course.id, withoutDeletionMarker(course));
  }
  return { ...incoming, courses: [...byId.values()] };
}

export function markCourseDeleted(current: CourseSnapshot, id: string, deletedAt: string): CourseSnapshot | null {
  const course = current.courses.find(c => c.id === id);
  if (!course) return null;
  if (course.deleted_at) return current;
  return {
    ...current,
    courses: current.courses.map(c => c.id === id ? { ...c, active: false, deleted_at: deletedAt } : c),
  };
}

export async function updateCourseSnapshot(update: (current: CourseSnapshot) => CourseSnapshot | null, create = false) {
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    if (create) {
      await client.sql`INSERT INTO kv_store (key, value)
        VALUES (${COURSE_INSIGHTS_KEY}, '{"courses":[],"reviews":[],"reports":[]}'::jsonb)
        ON CONFLICT (key) DO NOTHING`;
    }
    const result = await client.sql`SELECT value FROM kv_store WHERE key = ${COURSE_INSIGHTS_KEY} FOR UPDATE`;
    const current: unknown = result.rows[0]?.value;
    if (current !== undefined && !isCourseSnapshot(current)) throw new Error('Invalid Course Insights snapshot.');
    const next = isCourseSnapshot(current) ? update(current) : null;
    if (next && next !== current) {
      await client.sql`UPDATE kv_store SET value = ${JSON.stringify(next)}::jsonb, updated_at = now()
        WHERE key = ${COURSE_INSIGHTS_KEY}`;
    }
    await client.sql`COMMIT`;
    return next;
  } catch (err) {
    await client.sql`ROLLBACK`;
    throw err;
  } finally {
    client.release();
  }
}
