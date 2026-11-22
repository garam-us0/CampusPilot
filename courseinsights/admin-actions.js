function confirmCourseDeletion(course) {
  if (!ADMIN || !course || course.deleted_at) return;
  modal(`<h2>Delete course?</h2>
    <p style="margin-top:8px">Remove <strong>${esc(course.code)} · ${esc(course.professor)}</strong> from the course directory? Existing reviews and reports will be kept.</p>
    <form id="deleteCourseForm">
      <label for="courseDeletePassphrase">Administrator deletion passphrase</label>
      <input id="courseDeletePassphrase" type="password" autocomplete="off" required maxlength="512">
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
      const passphrase = $('#courseDeletePassphrase');
      const response = await fetch('/api/kv', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.id, passphrase: passphrase.value })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok || !result.value) {
        throw new Error(result?.error || 'Could not delete this course. Please try again.');
      }
      passphrase.value = '';
      try { localStorage.setItem(CI_STORE_KEY, JSON.stringify(result.value)); } catch {}
      $('#modal').close();
      start();
      toast('Course deleted from the directory.');
    });
  };
}
