/* Campuspilot — LOST & FOUND page logic: a real campus property
   registry. Students search/browse; admins register items, confirm
   pickups, hide/reopen records. Persisted in localStorage (see
   shared/store.js) so it survives a real page reload — there's no
   backend yet, so this *is* the Lost & Found desk's record.
   shared/toast.js, shared/nav.js and shared/session.js are already
   loaded before this file. */
var isAdmin = false;
var lfQuery = '';
var lfCategory = 'all';
var lfStatusTab = 'all';
var lfAdminQuery = '';
var lfAdminStatus = 'all';
var lfPendingImage = null;
var lfActiveItem = null;
var lfPickupItemId = null;
var lfEditingId = null;
var lfDeleteArmed = {};
var CURRENT_STUDENT_NAME = 'Garam (u1621896)';

function fmtDateTime(iso){
  var d = new Date(iso);
  if(isNaN(d.getTime())) return iso;
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var h = d.getHours(), m = d.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12; if(h12 === 0) h12 = 12;
  var mm = (m < 10 ? '0' : '') + m;
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + h12 + ':' + mm + ' ' + ampm;
}

/* ---- real cross-visit persistence (localStorage — there's no backend
   yet, so this *is* the Lost & Found desk's record). ---- */
var LF_STORAGE_KEY = 'campuspilot.lostfound.v1';
var lfItems = [];
var lfNextId = 1;
/* No seed/demo items -- the registry starts genuinely empty until an
   admin registers a real found item (the "No items yet" empty state
   below handles that correctly). Pulled out into a named function (not
   just an IIFE) so it can also be re-run after cpSyncPull refreshes
   localStorage from the server on page load — see lostfound/index.html. */
function lfLoadFromStorage(){
  var data = cpLoadJSON(LF_STORAGE_KEY, null);
  if(data && data.items){ lfItems = data.items; lfNextId = data.nextId || (lfItems.length + 1); }
  else { lfItems = []; lfNextId = 1; }
}
lfLoadFromStorage();
function lfPersist(){ cpSaveJSON(LF_STORAGE_KEY, { items: lfItems, nextId: lfNextId }); }

function catIcon(){
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
}

function lfFilteredStudent(){
  var q = lfQuery.toLowerCase();
  return lfItems.filter(function(it){
    if(it.hidden) return false;
    if(!lfVisibleInMonth(it, LF_VIEW_MONTH.y, LF_VIEW_MONTH.m)) return false;
    if(lfStatusTab !== 'all' && it.status !== lfStatusTab) return false;
    if(lfCategory !== 'all' && it.category !== lfCategory) return false;
    if(q && (it.name.toLowerCase().indexOf(q) === -1 && it.category.toLowerCase().indexOf(q) === -1 && it.location.toLowerCase().indexOf(q) === -1)) return false;
    return true;
  });
}

function lfSetCategory(v){ lfCategory = v; lfRenderStudent(); }
function lfSetQuery(v){ lfQuery = v; lfRenderStudent(); }
function lfSetStatusTab(v){ lfStatusTab = v; lfRenderStudent(); }

function lfRenderStudentTabs(){
  /* Tab badge counts must come from the SAME month + hidden filtering the
     grid below actually uses (lfVisibleInMonth / it.hidden) — otherwise a
     badge can say "Completed 4" while the grid under it renders nothing,
     because those 4 completed items belong to months other than the one
     being viewed right now. Category/search text still don't narrow these
     counts on purpose (a typed search shouldn't make the tab numbers jump
     around), but "is this item even in view at all" has to match. */
  var inView = lfItems.filter(function(it){ return !it.hidden && lfVisibleInMonth(it, LF_VIEW_MONTH.y, LF_VIEW_MONTH.m); });
  var tabs = [['all','All Items'],['pending','Pending'],['completed','Completed']];
  document.getElementById('lfStatusTabs').innerHTML = tabs.map(function(t){
    var active = t[0] === lfStatusTab;
    var count = t[0] === 'all' ? inView.length : inView.filter(function(it){ return it.status === t[0]; }).length;
    return '<button class="lf-pill'+(active?' active':'')+'" onclick="lfSetStatusTab(\''+t[0]+'\')">'+t[1]+'<span class="cnt">'+count+'</span></button>';
  }).join('');
}

function lfRenderStudent(){
  lfRenderStudentTabs();
  var list = lfFilteredStudent();
  var grid = document.getElementById('lfGrid');
  if(!list.length){
    /* Three different reasons the grid can be empty, each needing its own
       copy: (1) a search/category/status filter is actually active and
       narrowed a non-empty registry down to nothing -- "No items match
       your search"; (2) nothing is active, this month itself just has no
       items, while other months do -- "No items reported for this month"
       (previously this case wrongly fell under message 1, implying a
       search happened when the student hadn't typed anything); (3) the
       whole registry (every month, hidden ones aside) is empty -- "No
       items have been reported yet". */
    var filtersActive = !!lfQuery.trim() || lfCategory !== 'all' || lfStatusTab !== 'all';
    var hasAnyEver = lfItems.some(function(it){ return !it.hidden; });
    /* If no filter is active and the list is still empty, this month itself
       has nothing visible (filtersActive=false means list===hasAnyThisMonth
       by construction, so there's no need to recompute that separately). */
    var emptyMsg = filtersActive
      ? 'No items match your search.'
      : (!hasAnyEver ? 'No items have been reported yet.' : 'No items reported for this month.');
    grid.innerHTML = '<div class="lf-empty">'+emptyMsg+'</div>';
    return;
  }
  grid.innerHTML = list.map(function(it){
    var thumbStyle = it.image ? ' style="background-image:url(\''+it.image+'\')"' : '';
    var thumbContent = it.image ? '' : catIcon();
    var tagLabel = it.status === 'pending' ? 'PENDING' : 'COMPLETED';
    return '<button class="lf-card" onclick="lfOpenDetail('+it.id+')">'
      + '<div class="lf-card-thumb"'+thumbStyle+'>'+thumbContent+'</div>'
      + '<div class="lf-card-body">'
      + '<div class="lf-card-cat">'+it.category+'</div>'
      + '<div class="lf-card-title">'+it.name+'</div>'
      + '<div class="lf-card-meta">'+it.location+'<br>'+fmtDate(it.date)+'</div>'
      + '<span class="lf-card-tag '+it.status+'">'+tagLabel+'</span>'
      + '</div></button>';
  }).join('');
}

function fmtDate(iso){
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var parts = iso.split('-');
  if(parts.length !== 3) return iso;
  return months[parseInt(parts[1],10)-1] + ' ' + parseInt(parts[2],10);
}

/* ---- mini-calendar date picker (replaces the native <input type=date>,
   which wasn't rendering/selectable in every environment) — navigable by
   month/year via the ‹ › arrows, computed from real JS Date math so any
   date can be picked, not just the current month. Shared between the
   Register New Item (Date Found) and Confirm Pickup (Pickup Date) forms
   via a "scope" argument. ---- */
var LF_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
/* Tracks the real current date, same as the Calendar page's "Today" —
   not a fixed point in the demo's Fall 2026 semester. */
var LF_TODAY = (function(){
  var d = new Date();
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
})();

/* The registry is browsed one month at a time, like the Calendar page —
   defaults to the curated Fall Semester 2026 demo data, same as Calendar's
   default grid view. "This Month" jumps to the real current month instead,
   same relationship as Calendar's "Today" button has to its default view.
   Shared by both the admin table and the student search grid, so a found
   item logged this month shows for everyone, and a still-pending item
   keeps showing in every later month until an admin confirms pickup. */
var LF_VIEW_MONTH = { y: LF_TODAY.y, m: LF_TODAY.m };
function lfMonthKey(y, m){ return y + '-' + (m + 1 < 10 ? '0' : '') + (m + 1); }
function lfVisibleInMonth(it, y, m){
  /* A pending item is keyed by when it was FOUND (it.date) and carries
     forward every month until resolved. A completed item is keyed by
     when it was RESOLVED (it.completedAt — the pickup date captured in
     lfConfirmPickup) so it shows up as "closed this month" in whichever
     month an admin actually picked it up, not forever stuck in the month
     it happened to be found. Older records completed before this field
     existed have no completedAt, so they fall back to their found-date
     (unchanged old behavior) rather than vanishing outright. */
  var effectiveDate = (it.status === 'completed' && it.completedAt) ? it.completedAt : it.date;
  var itemKey = effectiveDate.slice(0, 7);
  var viewKey = lfMonthKey(y, m);
  if(itemKey === viewKey) return true; /* found (pending) or resolved (completed) in the month being viewed */
  if(itemKey < viewKey && it.status !== 'completed') return true; /* still unclaimed — carries forward */
  return false; /* a completed item outside its resolution month, or not logged yet as of this month */
}
function lfUpdateMonthControls(){
  var yearSel = document.getElementById('lfYearSelect');
  var monthSel = document.getElementById('lfMonthSelect');
  if(yearSel && !yearSel.options.length){
    for(var y = LF_TODAY.y - 2; y <= LF_TODAY.y + 3; y++){
      var yo = document.createElement('option'); yo.value = y; yo.textContent = y;
      yearSel.appendChild(yo);
    }
  }
  if(monthSel && !monthSel.options.length){
    LF_MONTH_NAMES.forEach(function(name, i){
      var mo = document.createElement('option'); mo.value = i; mo.textContent = name;
      monthSel.appendChild(mo);
    });
  }
  if(yearSel) yearSel.value = LF_VIEW_MONTH.y;
  if(monthSel) monthSel.value = LF_VIEW_MONTH.m;
}
function lfChangeViewMonth(){
  var y = parseInt(document.getElementById('lfYearSelect').value, 10);
  var m = parseInt(document.getElementById('lfMonthSelect').value, 10);
  LF_VIEW_MONTH = { y: y, m: m };
  lfRenderAdmin();
  lfRenderStudent();
}
function lfJumpToCurrentMonth(){
  LF_VIEW_MONTH = { y: LF_TODAY.y, m: LF_TODAY.m };
  lfUpdateMonthControls();
  lfRenderAdmin();
  lfRenderStudent();
}
var LF_MINI_DOWS = ['S','M','T','W','T','F','S'];
var LF_PICKER_STATE = {};
function lfPickerState(scope){
  if(!LF_PICKER_STATE[scope]){ LF_PICKER_STATE[scope] = { y: LF_TODAY.y, m: LF_TODAY.m }; }
  return LF_PICKER_STATE[scope];
}
function lfMiniIds(scope){
  return scope === 'pickup'
    ? { input:'pickupDate', label:'pickupDateLabel', pop:'pickupDatePop', grid:'pickupDateGrid', head:'pickupDateHead' }
    : { input:'regDate', label:'regDateLabel', pop:'regDatePop', grid:'regDateGrid', head:'regDateHead' };
}
function lfBuildMiniGrid(scope){
  var ids = lfMiniIds(scope);
  var grid = document.getElementById(ids.grid);
  if(!grid) return;
  var st = lfPickerState(scope);
  var headEl = document.getElementById(ids.head);
  if(headEl) headEl.textContent = LF_MONTH_NAMES[st.m] + ' ' + st.y;
  var firstDow = new Date(st.y, st.m, 1).getDay();
  var daysInMonth = new Date(st.y, st.m + 1, 0).getDate();
  var prevMonthLast = new Date(st.y, st.m, 0).getDate();
  var cells = [];
  for(var i = firstDow - 1; i >= 0; i--){ cells.push({ d: prevMonthLast - i, dim:true }); }
  for(var d = 1; d <= daysInMonth; d++){ cells.push({ d:d }); }
  /* Always pad out to a fixed 6 rows (42 cells) — a 4-week vs 6-week
     month otherwise changes the popover's height, which shifts its
     computed screen position (visibly jumping) every time ‹ › is
     clicked. A constant height keeps the position stable. */
  var tail = 1;
  while(cells.length < 42){ cells.push({ d: tail++, dim:true }); }
  var html = LF_MINI_DOWS.map(function(ch, i){ return '<div class="dow'+(i===0?' sun':'')+'">'+ch+'</div>'; }).join('');
  html += cells.map(function(c){
    if(c.dim) return '<div class="mini-day dim">'+c.d+'</div>';
    var isToday = (st.y === LF_TODAY.y && st.m === LF_TODAY.m && c.d === LF_TODAY.d);
    return '<div class="mini-day pick'+(isToday ? ' today' : '')+'" data-day="'+c.d+'" onclick="lfPickMiniDate(\''+scope+'\','+c.d+')">'+c.d+'</div>';
  }).join('');
  grid.innerHTML = html;
}
function lfShiftMonth(scope, delta){
  var st = lfPickerState(scope);
  var d = new Date(st.y, st.m + delta, 1);
  st.y = d.getFullYear();
  st.m = d.getMonth();
  lfBuildMiniGrid(scope);
  var ids = lfMiniIds(scope);
  var pop = document.getElementById(ids.pop);
  if(pop && !pop.classList.contains('hidden')) lfPositionDatePop(pop);
}
function lfPositionDatePop(pop){
  /* position:fixed, placed via JS from the trigger's real screen position,
     so the popover is never clipped by a scrolling ancestor and always
     stays fully visible (and clickable) — flips upward if there's no
     room below. */
  var trigger = pop.previousElementSibling;
  if(!trigger) return;
  var rect = trigger.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (rect.bottom + 6) + 'px';
  var popRect = pop.getBoundingClientRect();
  if(popRect.bottom > window.innerHeight - 8){
    var upTop = rect.top - popRect.height - 6;
    pop.style.top = (upTop > 8 ? upTop : 8) + 'px';
  }
}
function lfToggleDatePicker(scope){
  var ids = lfMiniIds(scope);
  var pop = document.getElementById(ids.pop);
  if(!pop) return;
  var opening = pop.classList.contains('hidden');
  if(!opening){ pop.classList.add('hidden'); return; }
  pop.classList.remove('hidden');
  lfPositionDatePop(pop);
}
function lfPickMiniDate(scope, day){
  var ids = lfMiniIds(scope);
  var st = lfPickerState(scope);
  var mm = (st.m + 1 < 10 ? '0' : '') + (st.m + 1);
  var dd = (day < 10 ? '0' : '') + day;
  var inputEl = document.getElementById(ids.input);
  if(inputEl) inputEl.value = st.y + '-' + mm + '-' + dd;
  var labelEl = document.getElementById(ids.label);
  if(labelEl) labelEl.textContent = LF_MONTH_NAMES[st.m] + ' ' + day + ', ' + st.y;
  var gridEl = document.getElementById(ids.grid);
  if(gridEl){
    gridEl.querySelectorAll('.mini-day.pick').forEach(function(el){ el.classList.remove('sel'); });
    var sel = gridEl.querySelector('.mini-day.pick[data-day="'+day+'"]');
    if(sel) sel.classList.add('sel');
  }
  var popEl = document.getElementById(ids.pop);
  if(popEl) popEl.classList.add('hidden');
}
function lfSetDatePicker(scope, iso){
  var parts = iso.split('-');
  var st = lfPickerState(scope);
  st.y = parseInt(parts[0],10);
  st.m = parseInt(parts[1],10) - 1;
  lfBuildMiniGrid(scope);
  lfPickMiniDate(scope, parseInt(parts[2],10));
}
lfBuildMiniGrid('reg');
lfBuildMiniGrid('pickup');
document.addEventListener('click', function(e){
  if(!e.target.closest('#regDatePicker')){
    var p1 = document.getElementById('regDatePop'); if(p1) p1.classList.add('hidden');
  }
  if(!e.target.closest('#pickupDatePicker')){
    var p2 = document.getElementById('pickupDatePop'); if(p2) p2.classList.add('hidden');
  }
});

function lfOpenDetail(id){
  var it = lfItems.filter(function(x){ return x.id === id; })[0];
  if(!it) return;
  lfActiveItem = it;
  document.getElementById('detailCat').textContent = it.category;
  document.getElementById('detailName').textContent = it.name;
  document.getElementById('detailLocation').textContent = it.location;
  document.getElementById('detailDate').textContent = fmtDate(it.date);
  document.getElementById('detailDesc').textContent = it.desc || 'No additional details provided.';
  var img = document.getElementById('detailImg');
  if(it.image){ img.style.backgroundImage = "url('"+it.image+"')"; img.innerHTML=''; }
  else { img.style.backgroundImage = ''; img.innerHTML = catIcon(); }
  /* No online "claim" step — a student who thinks an item is theirs just
     visits the desk in person with ID, and the desk records the pickup
     directly on the Admin page, so this box only ever needs to say
     whether the item is still there or already gone. */
  var claimBox = document.getElementById('claimBox');
  if(it.status === 'completed'){
    claimBox.innerHTML = 'This item has already been picked up — <b>'+it.claimedBy+'</b>.';
  } else {
    claimBox.innerHTML = 'Think this is yours? Visit the <b>UAC Lost &amp; Found Desk</b> (Student Union, Room 112) with your student ID to claim it.';
  }
  document.getElementById('detail-modal').classList.remove('hidden');
}
function lfCloseDetail(){ document.getElementById('detail-modal').classList.add('hidden'); }

/* ---------------- admin: register + table ---------------- */
function lfHandleImage(input){
  var file = input.files && input.files[0];
  document.getElementById('regImageName').textContent = file ? file.name : 'No file chosen';
  if(!file){ lfClearPendingImage(); return; }
  var reader = new FileReader();
  reader.onload = function(e){
    lfPendingImage = e.target.result;
    var prev = document.getElementById('regImgPreview');
    prev.style.backgroundImage = "url('"+lfPendingImage+"')";
    prev.textContent = '';
    document.getElementById('regImgRemoveBtn').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

/* Clears whichever photo is currently staged for the Register/Edit form --
   either one just picked from the file input, or (while editing) an
   existing item's photo the admin wants to drop -- so a wrong file can
   always be swapped out before Register/Save is clicked. */
function lfClearPendingImage(){
  lfPendingImage = null;
  document.getElementById('regImage').value = '';
  document.getElementById('regImageName').textContent = 'No file chosen';
  var prev = document.getElementById('regImgPreview');
  prev.style.backgroundImage = '';
  prev.textContent = 'No image selected';
  document.getElementById('regImgRemoveBtn').classList.add('hidden');
}

function lfResetRegForm(){
  document.getElementById('regName').value = '';
  document.getElementById('regCategory').value = '';
  document.getElementById('regLocation').value = '';
  document.getElementById('regDate').value = '';
  document.getElementById('regDateLabel').textContent = 'Select a date';
  document.querySelectorAll('#regDateGrid .mini-day.pick').forEach(function(el){ el.classList.remove('sel'); });
  document.getElementById('regDesc').value = '';
  lfClearPendingImage();
}

function lfRegisterItem(){
  var name = document.getElementById('regName').value.trim();
  var category = document.getElementById('regCategory').value;
  var location = document.getElementById('regLocation').value.trim();
  var date = document.getElementById('regDate').value;
  var desc = document.getElementById('regDesc').value.trim();
  if(!name || !category || !location || !date){
    showToast('Please fill in item name, category, location, and date.');
    return;
  }

  if(lfEditingId){
    var existing = lfItems.filter(function(x){ return x.id === lfEditingId; })[0];
    if(existing){
      existing.name = name;
      existing.category = category;
      existing.location = location;
      existing.date = date;
      existing.desc = desc;
      existing.image = lfPendingImage;
      lfPersist();
      showToast('Item updated.');
    }
    lfCancelEdit();
    lfRenderAdmin();
    return;
  }

  lfItems.unshift({
    id: lfNextId++,
    name: name,
    category: category,
    location: location,
    date: date,
    desc: desc,
    status: 'pending',
    claimedBy: null,
    image: lfPendingImage
  });
  lfResetRegForm();
  lfPersist();
  showToast('Item registered — now visible in the student search registry.');
  lfRenderAdmin();
}

/* Reuses the same Register panel as an edit form, instead of a second
   duplicate form -- pre-fills every field from the existing item, flips
   the form into "editing" mode (title/button text + a Cancel button), and
   lfRegisterItem() above branches on lfEditingId to update in place
   rather than create a new row. */
function lfEditItem(id){
  var it = lfItems.filter(function(x){ return x.id === id; })[0];
  if(!it) return;
  lfEditingId = id;
  document.getElementById('regName').value = it.name;
  document.getElementById('regCategory').value = it.category;
  document.getElementById('regLocation').value = it.location;
  lfSetDatePicker('reg', it.date);
  document.getElementById('regDesc').value = it.desc || '';
  if(it.image){
    lfPendingImage = it.image;
    var prev = document.getElementById('regImgPreview');
    prev.style.backgroundImage = "url('"+it.image+"')";
    prev.textContent = '';
    document.getElementById('regImgRemoveBtn').classList.remove('hidden');
    document.getElementById('regImageName').textContent = 'Current photo';
  } else {
    lfClearPendingImage();
  }
  document.getElementById('regFormTitle').textContent = 'Edit Item';
  document.getElementById('regSubmitBtn').textContent = 'Save Changes';
  document.getElementById('regCancelEditBtn').classList.remove('hidden');
  document.getElementById('regName').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function lfCancelEdit(){
  lfEditingId = null;
  lfResetRegForm();
  document.getElementById('regFormTitle').textContent = 'Register New Item';
  document.getElementById('regSubmitBtn').textContent = 'Register Item';
  document.getElementById('regCancelEditBtn').classList.add('hidden');
}

/* Two-click confirm built into the button itself (matches the pattern
   already used in gradepilot/gradepilot.js's gpClearAll/gpResetClearBtn)
   instead of window.confirm(), which a sandboxed preview silently
   auto-dismisses. First click arms just that row's Delete button (red,
   "click again" tooltip) with a 4s auto-reset; the second click within
   that window actually deletes. */
function lfDeleteItem(id, btn){
  if(!lfDeleteArmed[id]){
    lfDeleteArmed[id] = setTimeout(function(){
      delete lfDeleteArmed[id];
      var b = document.querySelector('[data-delete-id="'+id+'"]');
      if(b){ b.classList.remove('armed'); b.title = 'Delete'; }
    }, 4000);
    btn.classList.add('armed');
    btn.title = 'Click again to confirm delete';
    return;
  }
  clearTimeout(lfDeleteArmed[id]);
  delete lfDeleteArmed[id];
  var it = lfItems.filter(function(x){ return x.id === id; })[0];
  lfItems = lfItems.filter(function(x){ return x.id !== id; });
  if(lfEditingId === id) lfCancelEdit();
  lfPersist();
  showToast((it ? it.name : 'Item') + ' deleted.');
  lfRenderAdmin();
}

function lfCsvEscape(v){
  v = String(v == null ? '' : v);
  if(/[",\n]/.test(v)) return '"' + v.replace(/"/g,'""') + '"';
  return v;
}
/* A real CSV of whatever the admin table is currently showing (same
   status/search filters, same month view) instead of the old placeholder
   toast that just claimed a download would happen "on your live site". */
function lfExportCsv(){
  var rows = lfFilteredAdmin().slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  var header = ['Status','Item','Category','Location','Date Found','Claim Details','Hidden'];
  var lines = [header.map(lfCsvEscape).join(',')];
  rows.forEach(function(it){
    var claim = it.status === 'completed' ? ('Picked up — ' + it.claimedBy) : 'Awaiting claim';
    lines.push([it.status, it.name, it.category, it.location, it.date, claim, it.hidden ? 'Yes' : 'No'].map(lfCsvEscape).join(','));
  });
  var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'lostfound-' + LF_VIEW_MONTH.y + '-' + (LF_VIEW_MONTH.m + 1) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  showToast(rows.length ? ('CSV exported — ' + rows.length + ' item' + (rows.length === 1 ? '' : 's') + '.') : 'CSV exported — no items in the current view.');
}

function lfSetAdminFilter(v){ lfAdminStatus = v; lfRenderAdmin(); }
function lfSetAdminQuery(v){ lfAdminQuery = v; lfRenderAdmin(); }

/* Items relevant to the month currently being viewed — logged that month,
   or still pending/claimed from an earlier month and so still carried
   forward. Everything else below (status tab, search) narrows this set
   further; it never widens back out to months not being viewed. */
function lfVisibleThisMonthSet(){
  return lfItems.filter(function(it){ return lfVisibleInMonth(it, LF_VIEW_MONTH.y, LF_VIEW_MONTH.m); });
}

function lfFilteredAdmin(){
  var q = lfAdminQuery.toLowerCase();
  return lfVisibleThisMonthSet().filter(function(it){
    /* Hiding an item never removes its row from the admin table — the
       record stays right where it is, just marked HIDDEN, because hiding
       only controls whether students can see it. The dedicated "Hidden"
       filter is just a quick way to isolate hidden items; every other
       filter keeps showing them alongside everything else. */
    if(lfAdminStatus === 'hidden') return !!it.hidden;
    if(lfAdminStatus !== 'all' && it.status !== lfAdminStatus) return false;
    if(q && (it.name.toLowerCase().indexOf(q) === -1 && it.category.toLowerCase().indexOf(q) === -1 && it.location.toLowerCase().indexOf(q) === -1)) return false;
    return true;
  });
}

/* Groups a (already-filtered, date-sorted) item list into per-month
   sections for the admin table — "September 2026" headers above that
   month's rows — rather than one long flat list. With carry-forward, a
   viewed month can show more than one of these headers at once: its own
   items, plus an earlier header for whichever still-pending items were
   carried in from before. */
function lfMonthLabel(dateStr){
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var parts = dateStr.split('-');
  return months[parseInt(parts[1],10)-1] + ' ' + parts[0];
}

function lfRenderStats(){
  var inView = lfVisibleThisMonthSet();
  document.getElementById('statTotal').textContent = inView.length;
  document.getElementById('statPending').textContent = inView.filter(function(it){ return it.status === 'pending'; }).length;
  document.getElementById('statCompleted').textContent = inView.filter(function(it){ return it.status === 'completed'; }).length;
}

function lfRenderAdmin(){
  lfUpdateMonthControls();
  lfRenderStats();
  var list = lfFilteredAdmin().slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  var body = document.getElementById('adminTableBody');
  if(!list.length){
    body.innerHTML = '<tr><td colspan="6" class="empty-table">No items found.</td></tr>';
    return;
  }
  var rows = [];
  var lastMonth = null;
  var viewingKey = lfMonthKey(LF_VIEW_MONTH.y, LF_VIEW_MONTH.m);
  list.forEach(function(it){
    var monthKey = it.date.slice(0,7);
    if(monthKey !== lastMonth){
      /* A carried-forward item keeps the month it was actually found in,
         which can read as "wrong" sitting under a VIEWING selector set to
         a later month — so a group that ISN'T the month being viewed is
         labeled as still-pending carryover, instead of a bare month name
         that looks like the view didn't really switch. */
      var dividerLabel = (monthKey === viewingKey)
        ? lfMonthLabel(it.date)
        : lfMonthLabel(it.date) + ' · still pending, carried forward';
      rows.push('<tr class="month-divider"><td colspan="6">'+dividerLabel+'</td></tr>');
      lastMonth = monthKey;
    }
    var thumbStyle = it.image ? ' style="background-image:url(\''+it.image+'\')"' : '';
    var thumb = '<div class="thumb-mini"'+thumbStyle+'>'+(it.image ? '' : catIcon())+'</div>';
    var claim, label;
    if(it.status === 'completed'){ claim = 'Picked up — '+it.claimedBy; label = 'COMPLETED'; }
    else { claim = 'Awaiting claim'; label = 'PENDING'; }
    /* The real workflow status (pending/completed) always shows,
       with a separate HIDDEN badge layered on when it.hidden is set — the
       two are independent: hiding doesn't change or hide the underlying
       status, it only controls student-side visibility. */
    var hiddenBadge = it.hidden ? ' <span class="status-chip hidden-status">HIDDEN</span>' : '';
    var actionBtn = it.status === 'completed'
      ? '<button class="ok" title="Reopen" onclick="lfReopenItem('+it.id+')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button>'
      : '<button class="ok" title="Confirm Pickup" onclick="lfOpenPickup('+it.id+')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></button>';
    /* Icon shows the item's CURRENT status, not the click action: a
       crossed-out eye means "currently hidden from students" (click to
       unhide), an open eye means "currently visible" (click to hide). */
    var hideToggleBtn = it.hidden
      ? '<button class="danger" title="Hidden from students — click to unhide" onclick="lfToggleHidden('+it.id+')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><path d="M4 4l16 16"/></svg></button>'
      : '<button class="ok" title="Visible to students — click to hide" onclick="lfToggleHidden('+it.id+')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button>';
    var editBtn = '<button class="ok" title="Edit" onclick="lfEditItem('+it.id+')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>';
    var deleteBtn = '<button class="danger" data-delete-id="'+it.id+'" title="Delete" onclick="lfDeleteItem('+it.id+',this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>';
    rows.push('<tr>'
      + '<td><span class="status-chip '+it.status+'">'+label+'</span>'+hiddenBadge+'</td>'
      + '<td style="display:flex;align-items:center;gap:9px;">'+thumb+'<span>'+it.name+'<br><span style="color:var(--muted-2);font-size:11px;">'+it.category+'</span></span></td>'
      + '<td>'+it.location+'</td>'
      + '<td>'+fmtDate(it.date)+'</td>'
      + '<td class="claim-txt">'+claim+'</td>'
      + '<td><div class="row-actions">'
      + actionBtn
      + hideToggleBtn
      + editBtn
      + deleteBtn
      + '</div></td></tr>');
  });
  body.innerHTML = rows.join('');
}

/* Confirm-pickup modal: captures WHO picked the item up and WHEN, instead
   of a single click silently stamping "in person · today". */
function lfOpenPickup(id){
  var it = lfItems.filter(function(x){ return x.id === id; })[0];
  if(!it) return;
  lfPickupItemId = id;
  document.getElementById('pickupItemName').textContent = it.name;
  document.getElementById('pickupName').value = it.claimant ? it.claimant.name : '';
  lfSetDatePicker('pickup', new Date().toISOString().slice(0,10));
  document.getElementById('pickup-modal').classList.remove('hidden');
}
function lfClosePickup(){
  document.getElementById('pickup-modal').classList.add('hidden');
  lfPickupItemId = null;
}
function lfConfirmPickup(){
  var it = lfItems.filter(function(x){ return x.id === lfPickupItemId; })[0];
  if(!it){ lfClosePickup(); return; }
  var name = document.getElementById('pickupName').value.trim();
  var date = document.getElementById('pickupDate').value;
  if(!name || !date){
    showToast('Enter who picked it up and the pickup date.');
    return;
  }
  it.status = 'completed';
  it.claimedBy = name + ' · ' + fmtDate(date);
  it.completedAt = date;
  it.claimant = null;
  lfPersist();
  lfClosePickup();
  showToast(it.name+' — marked picked up by '+name+'.');
  lfRenderAdmin();
}
function lfReopenItem(id){
  var it = lfItems.filter(function(x){ return x.id === id; })[0];
  if(!it) return;
  it.status = 'pending';
  it.claimedBy = null;
  it.claimant = null;
  it.completedAt = null;
  lfPersist();
  showToast('Reopened as pending.');
  lfRenderAdmin();
}
function lfToggleHidden(id){
  var it = lfItems.filter(function(x){ return x.id === id; })[0];
  if(!it) return;
  it.hidden = !it.hidden;
  lfPersist();
  showToast(it.hidden ? (it.name+' — hidden from the student registry. The record stays here in the admin table.') : (it.name+' — visible to students again.'));
  lfRenderAdmin();
}

/* ---------------- role gate ---------------- */
function lfApplyAdmin(){
  document.getElementById('lfPortalLabel').textContent = isAdmin ? 'Admin Portal' : 'Student Portal';
  document.getElementById('lfCrumb').textContent = isAdmin ? 'Lost & Found \u2014 Admin' : 'Lost & Found';
  document.getElementById('studentView').classList.toggle('hidden', isAdmin);
  document.getElementById('adminView').classList.toggle('hidden', !isAdmin);
  if(isAdmin){ lfRenderAdmin(); } else { lfRenderStudent(); }
}

document.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){
    lfCloseDetail(); lfClosePickup();
    var p1 = document.getElementById('regDatePop'); if(p1) p1.classList.add('hidden');
    var p2 = document.getElementById('pickupDatePop'); if(p2) p2.classList.add('hidden');
  }
});
