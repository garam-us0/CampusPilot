/* Campuspilot — MY PROFILE page logic: account card, notification
   toggles (persisted — see shared/store.js), and an admin-only
   platform-overview card whose counts read real data from the Lost &
   Found / Campus Jobs localStorage, plus an admin-only registered-
   student roster (reads the shared accounts store from shared/
   session.js). shared/toast.js, shared/nav.js and shared/session.js are
   already loaded before this file. */
var isAdmin = false;
var MP_SETTINGS_KEY = 'campuspilot.settings.v1';
var mpToggles = cpLoadJSON(MP_SETTINGS_KEY, { toggleEmail:true, toggleReminders:true, toggleLF:false, toggleJobs:true });
/* paint the persisted toggle state onto the switches on load */
Object.keys(mpToggles).forEach(function(id){
  var el = document.getElementById(id);
  if(el) el.className = 'switch' + (mpToggles[id] ? ' on' : '');
});

function mpToggle(id, label){
  mpToggles[id] = !mpToggles[id];
  document.getElementById(id).className = 'switch' + (mpToggles[id] ? ' on' : '');
  cpSaveJSON(MP_SETTINGS_KEY, mpToggles);
  showToast((mpToggles[id] ? 'Turned on: ' : 'Turned off: ') + label.replace(/&amp;/g,'&'));
}

function mpEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

function mpFormatJoined(ts){
  if(!ts) return '—';
  var d = new Date(ts);
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

/* ---------------- My RSVPs card (student only) ----------------
   Reads the exact same shared, per-student RSVP store Calendar and Home
   both read/write (campuspilot.calendar.myrsvps.v1, keyed by SESSION.
   unid), cross-referenced against Calendar's shared campus-events store,
   so this card can never disagree with what Calendar or Home show. */
var MP_CAL_STORE_KEY = 'campuspilot.calendar.events.v2';
var MP_RSVP_KEY = 'campuspilot.calendar.myrsvps.v1';
var MP_CAT_LABELS = { official:'Campus Event', career:'Career Event', food:'Free Food Event', deadline:'Deadline' };
var MP_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function mpLoadRsvpIds(){
  if(!SESSION || !SESSION.unid) return [];
  try {
    var all = JSON.parse(localStorage.getItem(MP_RSVP_KEY)) || {};
    return all[SESSION.unid] || [];
  } catch(e){ return []; }
}
function mpLoadCampusEvents(){
  try { return JSON.parse(localStorage.getItem(MP_CAL_STORE_KEY)) || []; } catch(e){ return []; }
}
function mpRenderRsvps(){
  var host = document.getElementById('mpRsvpList');
  if(!host) return;
  var ids = mpLoadRsvpIds();
  var events = mpLoadCampusEvents();
  var matched = events.filter(function(e){ return ids.indexOf(e.id) !== -1; });
  matched.sort(function(a, b){
    return new Date(a.year, a.month - 1, a.date) - new Date(b.year, b.month - 1, b.date);
  });
  if(!matched.length){
    host.innerHTML = '<div class="muted" style="font-size:13px;padding:4px 0;">You haven’t RSVP’d to any events yet. RSVP from the Calendar page and they’ll show up here.</div>';
    return;
  }
  host.innerHTML = matched.map(function(e){
    var when = (MP_MONTH_NAMES[e.month - 1] || '').slice(0, 3) + ' ' + e.date + (e.time ? ' · ' + mpEsc(e.time) : '');
    var label = MP_CAT_LABELS[e.cat] || 'Event';
    return '<div class="rsvp-item"><div class="rsvp-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 4v4M16 4v4M4 10h16"/></svg></div>' +
      '<div><div class="rsvp-title">' + mpEsc(e.title) + '</div><div class="rsvp-sub">' + when + (e.location ? ' · ' + mpEsc(e.location) : '') + '</div></div>' +
      '<div class="rsvp-tag">' + label + '</div></div>';
  }).join('');
}

function mpRenderAdminStats(){
  var lf = cpLoadJSON('campuspilot.lostfound.v1', null);
  var lfPending = (lf && lf.items) ? lf.items.filter(function(it){ return it.status === 'pending'; }).length : 0;
  /* Campus Jobs' real storage key is campuspilot.campusJobs.v2 (set by
     campusjobs/index.html + admin.html), shape {jobs:[...]}. There's no
     open/closed concept on a job posting in that data model, so this
     counts every posted job rather than inventing a status that doesn't
     exist in the real data. */
  var cj = cpLoadJSON('campuspilot.campusJobs.v2', null);
  var jobsOpen = (cj && Array.isArray(cj.jobs)) ? cj.jobs.length : 0;
  document.getElementById('mpStatLF').textContent = lfPending;
  document.getElementById('mpStatJobs').textContent = jobsOpen;
  document.getElementById('mpAttnLF').textContent = lfPending
    ? (lfPending + ' open Lost & Found report' + (lfPending === 1 ? '' : 's') + ' awaiting pickup')
    : 'No open Lost & Found reports right now';
  document.getElementById('mpAttnJobs').textContent = jobsOpen
    ? (jobsOpen + ' job listing' + (jobsOpen === 1 ? '' : 's') + ' posted')
    : 'No Campus Jobs listings posted yet';
}

/* Admin-only: table of every self-registered student account, searchable
   by UNID or name, sortable by any column (click a header), and
   deletable one student at a time (trash icon, far right). Reads the
   server's accounts table (api/accounts/list) that login.js's sign-up
   writes to — there's no separate admin-side copy, and it's the same
   list from any device, so a new sign-up shows up here immediately
   regardless of which browser/computer it happened on. listAccounts()
   now returns a Promise.

   Note on duplicates: unid is the accounts table's primary key (see
   api/_db.ts), and re-signing-up under an existing UNID now overwrites
   that row in place (api/accounts/signup) instead of inserting a second
   one, so a literal duplicate-UNID row can't show up here. The trash
   icon is a manual, one-at-a-time admin action (an admin picks a row
   and removes it themselves) — not an automatic "find and delete
   duplicates" button. */
var mpRosterSort = { key: 'joinedAt', dir: 'asc' };
var mpDeleteArmedUnid = null;
var mpDeleteArmTimer = null;
var ICON_TRASH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
function mpResetDeleteArm(){
  mpDeleteArmedUnid = null;
  clearTimeout(mpDeleteArmTimer);
}
function mpSortRoster(key){
  if(mpRosterSort.key === key){
    mpRosterSort.dir = (mpRosterSort.dir === 'asc') ? 'desc' : 'asc';
  } else {
    mpRosterSort.key = key;
    mpRosterSort.dir = (key === 'joinedAt') ? 'desc' : 'asc';
  }
  mpRenderStudentRoster();
}
async function mpRenderStudentRoster(){
  var searchEl = document.getElementById('studentSearch');
  var q = (searchEl ? searchEl.value : '').toLowerCase().trim();
  var accounts = await listAccounts();
  var filtered = accounts.filter(function(a){
    return !q || (a.unid + ' ' + a.name).toLowerCase().indexOf(q) !== -1;
  });

  var key = mpRosterSort.key, dir = mpRosterSort.dir;
  filtered.sort(function(a, b){
    var av = a[key], bv = b[key];
    if(key === 'joinedAt'){ av = Number(av) || 0; bv = Number(bv) || 0; }
    else { av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase(); }
    var cmp = av < bv ? -1 : (av > bv ? 1 : 0);
    return dir === 'asc' ? cmp : -cmp;
  });

  ['unid','name','major','joinedAt'].forEach(function(k){
    var arrow = document.getElementById('rosterArrow-' + k);
    if(arrow) arrow.textContent = (mpRosterSort.key === k) ? (mpRosterSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  });

  document.getElementById('studentRosterCount').textContent =
    accounts.length === 0
      ? 'No students have registered yet'
      : filtered.length + ' of ' + accounts.length + ' registered student' + (accounts.length === 1 ? '' : 's');

  document.getElementById('studentRosterBody').innerHTML = filtered.map(function(a){
    var armed = a.unid === mpDeleteArmedUnid;
    return '<tr>' +
      '<td>' + mpEsc(a.unid) + '</td>' +
      '<td>' + mpEsc(a.name) + '</td>' +
      '<td>' + mpEsc(a.major || '—') + '</td>' +
      '<td>' + mpFormatJoined(a.joinedAt) + '</td>' +
      '<td><button type="button" class="roster-del-btn' + (armed ? ' armed' : '') + '" title="' + (armed ? 'Click again to confirm' : 'Remove this student') + '" aria-label="Remove ' + mpEsc(a.unid) + '" onclick="mpDeleteStudent(\'' + a.unid + '\')">' + ICON_TRASH + (armed ? '<span class="roster-del-label">Click again to confirm</span>' : '') + '</button></td>' +
    '</tr>';
  }).join('');

  document.querySelector('#adminStudentPanel .roster-wrap').classList.toggle('hidden', filtered.length === 0);
  document.getElementById('studentRosterEmpty').style.display = filtered.length === 0 ? 'block' : 'none';
}

/* Two-click arm/confirm (not window.confirm — it's silently auto-
   dismissed inside a sandboxed Artifact preview), same pattern used
   for Campus Jobs' and GradePilot's destructive buttons. First click
   arms just that row's trash icon (turns red, grows a "Click again to
   confirm" label, 4-second auto-reset); a second click while armed
   actually deletes the account from the server. */
async function mpDeleteStudent(unid){
  if(mpDeleteArmedUnid !== unid){
    mpDeleteArmedUnid = unid;
    clearTimeout(mpDeleteArmTimer);
    mpDeleteArmTimer = setTimeout(function(){ mpResetDeleteArm(); mpRenderStudentRoster(); }, 4000);
    mpRenderStudentRoster();
    return;
  }
  mpResetDeleteArm();
  var result = await deleteAccount(unid);
  if(!result || !result.ok){
    showToast((result && result.error) || 'Could not delete that account.');
    mpRenderStudentRoster();
    return;
  }
  showToast('Removed ' + unid + ' from the student roster.');
  mpRenderStudentRoster();
}

/* Student: changes the password on their own registered account (prompt-
   based, consistent with this prototype's other lightweight dialogs).
   Admin: there's no admin account to change — the passcode is fixed and
   managed by IT, so this just explains that instead. */
async function mpChangePassword(){
  if(isAdmin){
    showToast('Admin passcodes are managed by UAC IT directly.');
    return;
  }
  if(!SESSION || !SESSION.unid){
    showToast("Couldn't find your account — try signing in again.");
    return;
  }
  var current = window.prompt('Enter your current password:');
  if(current === null) return;
  var next = window.prompt('Enter your new password (at least 6 characters):');
  if(next === null) return;
  if(next.length < 6){
    showToast('New password must be at least 6 characters.');
    return;
  }
  var confirmNext = window.prompt('Re-enter your new password:');
  if(confirmNext === null) return;
  if(next !== confirmNext){
    showToast('New passwords did not match.');
    return;
  }
  /* The server verifies "current" against the real record itself now
     (there's no local account/password list to check against any
     more) -- see api/accounts/update-password. */
  var result = await updateAccountPassword(SESSION.unid, current, next);
  if(!result || !result.ok){
    showToast((result && result.error) || 'Could not update password.');
    return;
  }
  showToast('Password updated.');
}

function mpApplyAdmin(){
  var s = (typeof SESSION !== 'undefined' && SESSION) ? SESSION : {};

  document.getElementById('profileAvatar').textContent = isAdmin ? 'A' : (s.initial || 'S');
  document.getElementById('profileAvatar').className = 'profile-avatar' + (isAdmin ? ' is-admin' : '');
  document.getElementById('profileName').textContent = isAdmin ? 'UAC Admin (Department Admin)' : (s.name || 'Student');
  document.getElementById('profileMeta').textContent = 'University of Utah Asia Campus (UAC), Songdo';
  document.getElementById('kvUnid').textContent = isAdmin ? '—' : (s.unid || '—');
  document.getElementById('kvEmail').textContent = isAdmin ? '—' : (s.unid ? (s.unid + '@umail.utah.edu') : '—');
  document.getElementById('kvJoined').textContent = isAdmin ? '—' : mpFormatJoined(s.joinedAt);
  /* "Status" used to just say "Active Student" for every single student,
     which told nobody anything -- the major (+ optional double-major/
     minor) is the useful thing to show here instead. Admin has no major,
     so it keeps a department line of its own. */
  document.getElementById('kvMajorValue').textContent = isAdmin
    ? 'UAC IT & Student Affairs'
    : (s.major || 'Major not set yet') + (s.major2 ? ' · ' + s.major2 : '');
  document.getElementById('kvMajorEditBtn').classList.toggle('hidden', isAdmin);
  document.getElementById('signinMethodValue').textContent = isAdmin ? 'Departmental Passcode' : 'Campuspilot Account (self-registered)';
  document.getElementById('fhSub').textContent = isAdmin
    ? 'Manage your account, plus a quick overview of what needs platform attention'
    : 'Manage your account, saved events, and notification preferences';

  document.getElementById('adminPanel').classList.toggle('hidden', !isAdmin);
  document.getElementById('adminStudentPanel').classList.toggle('hidden', !isAdmin);
  if(isAdmin){
    mpRenderAdminStats();
    mpRenderStudentRoster(); // async (server-backed roster) -- paints in once it resolves
  } else {
    mpRenderRsvps();
  }
}

/* ---------------- Edit Major modal (student only) ----------------
   Lets a student set or change their major/minor at any time, not just
   at signup -- important for any account that was created before the
   major field existed (it just has an empty major), and for anyone who
   simply wants to change it. Reuses the exact same UAC_DEPARTMENTS /
   fillDeptSelect helpers login.js's signup form uses, from shared/
   session.js, so the two stay consistent. */
function mpOpenEditMajor(){
  if(isAdmin || !SESSION || !SESSION.unid) return;
  fillDeptSelect(document.getElementById('mp-major-select'), 'Select your major…');
  fillDeptSelect(document.getElementById('mp-minor-select'), 'Select a department…');

  var majorSel = document.getElementById('mp-major-select');
  var major = SESSION.major || '';
  if(major && UAC_DEPARTMENTS.indexOf(major) === -1){
    majorSel.value = '__other__';
    document.getElementById('mp-major-other-wrap').classList.remove('hidden');
    document.getElementById('mp-major-other').value = major;
  } else {
    majorSel.value = major;
    document.getElementById('mp-major-other-wrap').classList.add('hidden');
    document.getElementById('mp-major-other').value = '';
  }

  var major2 = SESSION.major2 || '';
  var minorBox = document.getElementById('mp-minor-fields');
  var minorToggleRow = document.getElementById('mp-minor-toggle-row');
  if(major2){
    minorBox.classList.remove('hidden');
    minorToggleRow.classList.add('hidden');
    var isMinor = major2.indexOf('Minor:') === 0;
    document.querySelector('input[name="mp-minor-type"][value="' + (isMinor ? 'minor' : 'double') + '"]').checked = true;
    var dept = major2.replace(/^(Minor|Double Major):\s*/, '');
    var minorSel = document.getElementById('mp-minor-select');
    if(UAC_DEPARTMENTS.indexOf(dept) === -1){
      minorSel.value = '__other__';
      document.getElementById('mp-minor-other-wrap').classList.remove('hidden');
      document.getElementById('mp-minor-other').value = dept;
    } else {
      minorSel.value = dept;
      document.getElementById('mp-minor-other-wrap').classList.add('hidden');
    }
  } else {
    minorBox.classList.add('hidden');
    minorToggleRow.classList.remove('hidden');
    document.getElementById('mp-minor-select').value = '';
    document.getElementById('mp-minor-other-wrap').classList.add('hidden');
    document.getElementById('mp-minor-other').value = '';
  }

  document.getElementById('mp-edit-major-modal').classList.remove('hidden');
}
function mpCloseEditMajor(){
  document.getElementById('mp-edit-major-modal').classList.add('hidden');
}
function mpToggleMinorFields(){
  var box = document.getElementById('mp-minor-fields');
  var row = document.getElementById('mp-minor-toggle-row');
  var opening = box.classList.contains('hidden');
  box.classList.toggle('hidden', !opening);
  row.classList.toggle('hidden', opening);
  if(opening){
    document.getElementById('mp-minor-select').value = '';
    document.getElementById('mp-minor-other-wrap').classList.add('hidden');
    document.getElementById('mp-minor-other').value = '';
  }
}
function mpRefreshMajorOtherVisibility(){
  var sel = document.getElementById('mp-major-select');
  document.getElementById('mp-major-other-wrap').classList.toggle('hidden', sel.value !== '__other__');
}
function mpRefreshMinorOtherVisibility(){
  var sel = document.getElementById('mp-minor-select');
  document.getElementById('mp-minor-other-wrap').classList.toggle('hidden', sel.value !== '__other__');
}
function mpResolveMajor(){
  var sel = document.getElementById('mp-major-select').value;
  if(sel === '__other__') return (document.getElementById('mp-major-other').value || '').trim();
  return sel;
}
function mpResolveMajor2(){
  var box = document.getElementById('mp-minor-fields');
  if(box.classList.contains('hidden')) return '';
  var typeEl = document.querySelector('input[name="mp-minor-type"]:checked');
  var type = typeEl ? typeEl.value : 'double';
  var sel = document.getElementById('mp-minor-select').value;
  var dept = (sel === '__other__') ? (document.getElementById('mp-minor-other').value || '').trim() : sel;
  if(!dept) return '';
  return (type === 'minor' ? 'Minor: ' : 'Double Major: ') + dept;
}
async function mpSaveEditMajor(){
  var major = mpResolveMajor();
  if(!major){
    showToast('Select your major (or choose "Other" and type it in).');
    return;
  }
  var major2 = mpResolveMajor2();
  var result = await updateAccountMajor(SESSION.unid, major, major2);
  if(!result || !result.ok){
    showToast((result && result.error) || "Couldn't find your account — try signing in again.");
    return;
  }
  SESSION = setSession('student', result.account);
  mpCloseEditMajor();
  mpApplyAdmin();
  showToast('Major updated.');
}
