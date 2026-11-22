/* Course deletion no longer asks for a separate administrator passphrase
   -- that extra secret lived only as a Vercel env var nobody had actually
   set, so it permanently blocked deletion for everyone. Being on this page
   at all already requires the admin OTP (ADMIN is only ever true after
   that), so a plain confirm is enough, consistent with every other
   destructive action in Campuspilot (none of which ask for a second
   password either). */
function confirmCourseDeletion(course) {
  if (!ADMIN || !course || course.deleted_at) return;
  modal(`<h2>Delete course?</h2>
    <p style="margin-top:8px">Remove <strong>${esc(course.code)} · ${esc(course.professor)}</strong> from the course directory? Existing reviews and reports will be kept.</p>
    <form id="deleteCourseForm">
      <p class="error" role="alert"></p>
      <div class="actions">
        <button id="cancelCourseDelete" class="secondary" type="button">Cancel</button>
        <button type="submit">Delete course</button>
      </div>
    </form>`);
  $('#cancelCourseDelete').onclick = () => $('#modal').close();
  $('#deleteCourseForm').onsubmit = event => {
    event.preventDefault();
    submit(event.target, async () => {
      const response = await fetch('/api/kv', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.id })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok || !result.value) {
        throw new Error(result?.error || 'Could not delete this course. Please try again.');
      }
      try { localStorage.setItem(CI_STORE_KEY, JSON.stringify(result.value)); } catch {}
      $('#modal').close();
      start();
      toast('Course deleted from the directory.');
    });
  };
}
