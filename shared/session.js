/* Campuspilot — shared session helper (student / admin sign-in state).
   Persisted in localStorage so it survives a real page navigation or
   reload — there's no backend yet, so this *is* the sign-in system.
   Load this FIRST on every protected page, before shared/toast.js,
   and call requireSession() at the top of that page's inline script. */
var SESSION_KEY = 'campuspilot.session.v1';

function getSession(){
  try{
    var raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

/* setSession(role, profile) — for 'student', profile is the matched
   account record from the accounts store below (unid/name/major/
   joinedAt), so the signed-in identity is always a real, self-registered
   account rather than a hardcoded demo user. The admin side still has no
   accounts of its own (fixed departmental passcode), so its session stays
   fixed. */
function setSession(role, profile){
  var session = (role === 'admin')
    ? { role:'admin', name:'UAC Admin (Dept. Staff)', initial:'A' }
    : {
        role:'student',
        unid:((profile && profile.unid) || ''),
        name:((profile && profile.name) || 'Student'),
        major:((profile && profile.major) || ''),
        major2:((profile && profile.major2) || ''),
        joinedAt:((profile && profile.joinedAt) || null),
        initial:(((profile && profile.name) || 'S').trim().charAt(0) || 'S').toUpperCase()
      };
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }catch(e){}
  return session;
}

function clearSession(){
  try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
}

/* ---------------- shared: server-backed data sync (Vercel Postgres) ----------------
   There's a real backend now (api/kv, api/accounts/*) so admin can see
   every student's activity -- and a student can see their own data --
   from ANY device/browser, not just the one a given action happened on.
   Every page still reads/writes localStorage exactly as it always has
   (every existing cpLoadJSON/raw-localStorage call is untouched); these
   two helpers just sit alongside that:
     - cpSyncPull(keys) is called once, on page load, BEFORE that page's
       normal (synchronous) init reads localStorage -- it fetches the
       latest value for each key from the server and overwrites
       localStorage with it, so the page always starts from the shared
       source of truth instead of whatever this one browser happened to
       cache last time.
     - cpSyncPush(key, value) is called every time something saves to
       localStorage -- it pushes that same value to the server in the
       background (fire-and-forget), so the next pull (from this device
       or any other) picks it up.
   Each entry in cpSyncPull's list can be a plain key string (local name
   === remote name, the common case), or [localKey, remoteKey] when they
   differ -- e.g. GradePilot's per-student workspace, which is stored
   locally under one flat key but remotely under a key namespaced by
   UNID, so two students sharing a browser (or the same student on two
   different devices) never collide. If the server is unreachable
   (offline, or Postgres isn't provisioned yet), pulls/pushes just fail
   silently and the page falls back to whatever's already cached in
   localStorage -- exactly how every page already behaved before this
   existed. */
function cpSyncPush(localKey, value, remoteKey){
  try{
    fetch('/api/kv', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: remoteKey || localKey, value: value })
    }).catch(function(){});
  }catch(e){}
}
function cpSyncPull(keys){
  var list = (keys || []).map(function(k){ return Array.isArray(k) ? k : [k, k]; });
  var remoteKeys = list.map(function(p){ return p[1]; });
  if(!remoteKeys.length) return Promise.resolve();
  return fetch('/api/kv?keys=' + encodeURIComponent(remoteKeys.join(',')))
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(map){
      if(!map) return;
      list.forEach(function(p){
        var localKey = p[0], remoteKey = p[1];
        if(!Object.prototype.hasOwnProperty.call(map, remoteKey)) return; // never saved server-side yet -- keep local seed/cache
        var v = map[remoteKey];
        try{
          if(v === null || v === undefined) localStorage.removeItem(localKey);
          else localStorage.setItem(localKey, JSON.stringify(v));
        }catch(e){}
      });
    })
    .catch(function(){});
}

/* ---------------- shared: student accounts (sign-up / sign-in) ----------------
   Backed by the server's Postgres database (api/accounts/*), not a
   per-browser localStorage copy -- so a self-registered student account,
   and the admin's view of who has registered, is the same real record
   from any browser or device. UNID must be the real "u" + 7-digit format
   (e.g. u1621896) and a name is required -- a loosely/carelessly typed
   value can't create or sign in to an account. login.js uses these for
   sign-up + sign-in; myprofile.js uses them for the admin student roster,
   the "Change Password" flow, and the "Edit Major" flow. All of these
   return a Promise (they call the server), unlike the old localStorage
   versions. */
var UNID_PATTERN = /^u\d{7}$/i;
function isValidUnid(unid){
  return UNID_PATTERN.test((unid || '').trim());
}
function apiPostJson(url, body){
  return fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body || {}) })
    .then(function(r){ return r.json(); })
    .catch(function(){ return { ok:false, error:'Server error. Please try again.' }; });
}
function createAccount(unid, password, name, major, major2){
  unid = (unid || '').trim();
  name = (name || '').trim();
  if(!isValidUnid(unid)) return Promise.resolve({ ok:false, error:'UNID must be "u" followed by 7 digits, e.g. u1621896.' });
  if(!password || !name) return Promise.resolve({ ok:false, error:'Fill in your UNID, name, and password.' });
  return apiPostJson('/api/accounts/signup', { unid:unid, password:password, name:name, major:major, major2:major2 });
}
function loginAccount(unid, password){
  unid = (unid || '').trim();
  if(!isValidUnid(unid)) return Promise.resolve({ ok:false, error:'UNID must be "u" followed by 7 digits, e.g. u1621896.' });
  return apiPostJson('/api/accounts/login', { unid:unid, password:password });
}
function updateAccountPassword(unid, currentPassword, newPassword){
  return apiPostJson('/api/accounts/update-password', { unid:unid, currentPassword:currentPassword, newPassword:newPassword });
}
/* Lets a student set/update their major (and optional double-major/minor
   label) on an account that already exists -- e.g. an older account
   created before the major field existed, or someone who just wants to
   change it. Signing up again with the same UNID can't do this (it's
   blocked as "already registered"), so My Profile's "Edit Major" flow
   calls this directly instead. Resolves to {ok:true, account} or
   {ok:false, error}. */
function updateAccountMajor(unid, major, major2){
  return apiPostJson('/api/accounts/update-major', { unid:unid, major:major, major2:major2 });
}
/* Every self-registered student account, passwords never included --
   resolves to a plain array (empty on any server error), same shape the
   old synchronous version returned, just asynchronous now. */
function listAccounts(){
  return fetch('/api/accounts/list')
    .then(function(r){ return r.ok ? r.json() : { accounts: [] }; })
    .then(function(data){ return (data && Array.isArray(data.accounts)) ? data.accounts : []; })
    .catch(function(){ return []; });
}
/* Admin-only: permanently removes one student's account (My Profile's
   registered-student roster). Resolves to {ok:true} or {ok:false,error}. */
function deleteAccount(unid){
  return apiPostJson('/api/accounts/delete', { unid: unid });
}

/* ---------------- shared: UAC department list ----------------
   Used by both the signup form (login.js) and My Profile's "Edit Major"
   flow, so the two stay in sync and self-registered accounts keep a
   consistent set of department names instead of free-typed variants
   like "biz"/"Business "/"business admin". "Other" always stays last
   and reveals a free-text fallback for anything not listed. */
var UAC_DEPARTMENTS = ['Accounting (BS)', 'Computer Engineering (BS)', 'Communication (BA/BS)',
  'Electrical Engineering (BS)', 'Film & Media Arts (BA)', 'Games (BS)', 'Psychology (BS)',
  'Information Systems (BS)', 'Urban Ecology (BS)'];

function fillDeptSelect(sel, placeholder){
  if(!sel) return;
  var html = '<option value="">' + placeholder + '</option>';
  UAC_DEPARTMENTS.forEach(function(d){ html += '<option value="' + d + '">' + d + '</option>'; });
  html += '<option value="__other__">Other (not listed)</option>';
  sel.innerHTML = html;
}

/* Redirects to the login page if nobody is signed in; otherwise paints
   the topbar identity (avatar + name + admin badge) and shows/hides
   any [data-role="admin"] / [data-role="student"] elements on the
   page. Returns the session object, or null (and redirects) if there
   isn't one. */
function requireSession(loginHref){
  var session = getSession();
  if(!session){
    window.location.href = loginHref || '../login/index.html';
    return null;
  }
  applySessionUI(session);
  return session;
}

function applySessionUI(session){
  var avatarEl = document.querySelector('.topbar-avatar');
  var nameEl = document.querySelector('.topbar-username');
  if(avatarEl){
    avatarEl.textContent = session.initial;
    avatarEl.classList.toggle('is-admin', session.role === 'admin');
  }
  if(nameEl){
    /* Plain text only, truncated by .topbar-username's own ellipsis CSS.
       The ADMIN badge used to be appended INSIDE this same element's
       innerHTML, so on a long admin name the ellipsis truncation (which
       applies to the whole element) would cut straight through the
       badge's own markup, rendering a clipped, garbled "..." pill next
       to the name. It's now a separate sibling element placed right
       after nameEl, outside the truncated box, so it always renders
       intact regardless of how long the name is. */
    nameEl.textContent = session.name;
    var existingBadge = nameEl.parentNode.querySelector('.topbar-admin-badge');
    if(existingBadge) existingBadge.parentNode.removeChild(existingBadge);
    if(session.role === 'admin'){
      var badge = document.createElement('span');
      badge.className = 'admin-badge topbar-admin-badge';
      badge.textContent = 'ADMIN';
      nameEl.parentNode.insertBefore(badge, nameEl.nextSibling);
    }
  }
  document.body.classList.remove('role-student', 'role-admin');
  document.body.classList.add('role-' + session.role);
  document.querySelectorAll('[data-role="admin"]').forEach(function(el){
    el.classList.toggle('hidden', session.role !== 'admin');
  });
  document.querySelectorAll('[data-role="student"]').forEach(function(el){
    el.classList.toggle('hidden', session.role !== 'student');
  });
  mountFullscreenToggle();
}

/* ---------------- shared: full-screen toggle button (topbar) ----------------
   Injected into .topbar-right on every protected page so the whole app can
   be viewed edge-to-edge (e.g. inside a browser preview) with one click. */
var FS_ICON_EXPAND = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5a1 1 0 0 0-1 1v4"/><path d="M15 4h4a1 1 0 0 1 1 1v4"/><path d="M9 20H5a1 1 0 0 1-1-1v-4"/><path d="M15 20h4a1 1 0 0 0 1-1v-4"/></svg>';
var FS_ICON_COLLAPSE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/></svg>';

function isFullscreenNow(){
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function updateFullscreenBtn(btn){
  if(!btn) return;
  var on = isFullscreenNow();
  btn.innerHTML = on ? FS_ICON_COLLAPSE : FS_ICON_EXPAND;
  btn.title = on ? 'Exit full screen' : 'View full screen';
  btn.setAttribute('aria-label', btn.title);
}

function toggleFullscreen(){
  try{
    if(isFullscreenNow()){
      if(document.exitFullscreen) document.exitFullscreen().catch(function(){});
      else if(document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else {
      var el = document.documentElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if(req) req.call(el).catch(function(){});
    }
  }catch(e){}
}

function mountFullscreenToggle(){
  var bar = document.querySelector('.topbar-right');
  if(!bar || bar.querySelector('.topbar-fullscreen')) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'topbar-fullscreen';
  btn.onclick = toggleFullscreen;
  updateFullscreenBtn(btn);
  var logoutEl = bar.querySelector('.topbar-logout');
  if(logoutEl) bar.insertBefore(btn, logoutEl);
  else bar.appendChild(btn);
  document.addEventListener('fullscreenchange', function(){ updateFullscreenBtn(btn); });
  document.addEventListener('webkitfullscreenchange', function(){ updateFullscreenBtn(btn); });
}

function logout(){
  clearSession();
  window.location.href = '../login/index.html';
}
