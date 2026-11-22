/* Campuspilot — GRADEPILOT page logic: a real syllabus-driven grade
   calculator / GPA simulator. shared/toast.js (showToast), shared/nav.js
   (mountNavRail) and shared/session.js (requireSession) are already
   loaded before this file. */
/* =====================================================================
   GradePilot — real grading-rules engine.

   Ported from a separate, already-working project (a Groq-backed syllabus
   parser + grade calculator) rather than invented fresh, so the math here
   matches a tested implementation instead of a guess. The key design
   decision carried over on purpose: of all the policy types a syllabus
   can state, ONLY drop_lowest / lowest_n / keep_highest / keep_best_n
   ever change the actual number (they're purely mechanical — "exclude
   the worst N" — so they're safe to automate). Everything else
   (exam_replacement, bonus_points, late_penalty, attendance_allowance,
   makeup_exam, grading_conflict, ...) is real information from the
   syllabus and is shown as a policy chip with a tooltip, but is NOT
   silently folded into the grade — those usually need a human judgment
   call (which exam counts, whether an absence was approved, etc.) that
   the tool has no safe way to make on its own.
   ===================================================================== */

var GP_FALLBACK_GRADES = [
  ['A',93,4.0],['A-',90,3.7],['B+',87,3.3],['B',83,3.0],['B-',80,2.7],
  ['C+',77,2.3],['C',73,2.0],['C-',70,1.7],['D',60,1.0],['F',0,0.0]
];
function gpGradesForCourse(course){
  return (course && course.gradeScale && course.gradeScale.length) ? course.gradeScale : GP_FALLBACK_GRADES;
}
function gpIsTargetGradeLabel(label){ return /^[ABCD][+-]?$/.test(String(label).trim().toUpperCase()); }
function gpTargetGradesForCourse(course){
  var targets = gpGradesForCourse(course).filter(function(g){ return gpIsTargetGradeLabel(g[0]); }).map(function(g){ return g[0].toUpperCase(); });
  return targets.length ? targets : GP_FALLBACK_GRADES.filter(function(g){ return gpIsTargetGradeLabel(g[0]); }).map(function(g){ return g[0]; });
}
function gpMinimumForTarget(scale, target){
  var want = String(target).trim().toUpperCase();
  for(var i=0;i<scale.length;i++){ if(scale[i][0].toUpperCase()===want) return scale[i][1]; }
  for(var j=0;j<GP_FALLBACK_GRADES.length;j++){ if(GP_FALLBACK_GRADES[j][0]===want) return GP_FALLBACK_GRADES[j][1]; }
  return 93.0;
}
function gpGradeFor(pct, scale){
  scale = scale || GP_FALLBACK_GRADES;
  for(var i=0;i<scale.length;i++){ if(pct >= scale[i][1]) return scale[i]; }
  return scale[scale.length-1];
}

var isAdmin = false;
var gpFeedbackStars = 0;

var gpCourses = {};
var gpActiveKey = null;
/* Mirrors exactly what's been typed into a score input while it still has
   focus (keyed by component id), so a mid-keystroke re-render never snaps
   a partial value like "8" or "0." back to its already-parsed number and
   drops the digit/decimal-point the person just typed. Cleared on blur so
   a later re-render falls back to the clean, clamped value. */
var gpRawInputDraft = {};
var gpStagedKey = null;
var gpStagedFile = '';
var gpStagedFileObj = null; // the real File object for the uploaded syllabus PDF
var gpExpandedGroups = {}; // groupId ("courseKey:stem") -> bool

/* ---- local persistence: scores, courses and the active course survive
   a refresh; "Clear All" is the only way to wipe them. ---- */
var GP_STORAGE_KEY = 'campuspilot.gradepilot.workspace.v1';

/* ---- admin-only: AI-analysis usage stats + student feedback ----
   There's no backend, so these are shared localStorage keys (same as every
   other store in this prototype) -- genuinely real counts/log entries of
   what's actually happened in THIS browser, not fabricated demo numbers.
   gpLogAiAttempt() is called only from the real syllabus-analysis path
   (gpRunRealAnalysis), never from the simulated/sample-file progress bar,
   so "AI requests" here always means an actual call to the grading-rules
   API. ---- */
var GP_AISTATS_KEY = 'campuspilot.gradepilot.aistats.v1';
var GP_FEEDBACK_KEY = 'campuspilot.gradepilot.feedback.v1';

function gpLoadAiStats(){
  return cpLoadJSON(GP_AISTATS_KEY, { total:0, success:0, fail:0, log:[] });
}
function gpLogAiAttempt(success, label){
  var stats = gpLoadAiStats();
  stats.total++;
  if(success) stats.success++; else stats.fail++;
  stats.log.unshift({ ts: Date.now(), label: label || 'Untitled syllabus', success: !!success });
  stats.log = stats.log.slice(0, 25);
  cpSaveJSON(GP_AISTATS_KEY, stats);
}

function gpLoadFeedback(){
  return cpLoadJSON(GP_FEEDBACK_KEY, []);
}
function gpSubmitFeedback(rating, comment){
  if(!rating) { showToast('Pick a star rating first.'); return; }
  var list = gpLoadFeedback();
  var session = (typeof SESSION !== 'undefined' && SESSION) ? SESSION : {};
  list.unshift({
    id: 'fb' + Date.now(),
    unid: session.unid || '',
    name: session.name || 'Student',
    rating: rating,
    comment: (comment || '').trim(),
    ts: Date.now()
  });
  cpSaveJSON(GP_FEEDBACK_KEY, list.slice(0, 100));
  showToast('Thanks for the feedback!');
}
/* GradePilot's workspace is each student's own data, so it's synced to a
   key namespaced by UNID server-side (GP_STORAGE_KEY + '::' + unid) even
   though it's stored locally under one flat key -- that way two students
   sharing a browser, or the same student on two different devices, never
   collide or overwrite each other's grades. Admin has no workspace. */
function gpRemoteWorkspaceKey(){
  var s = (typeof SESSION !== 'undefined') ? SESSION : null;
  return (s && s.unid) ? (GP_STORAGE_KEY + '::' + s.unid) : null;
}
function gpPersist(){
  try{
    var payload = { courses: gpCourses, activeKey: gpActiveKey };
    localStorage.setItem(GP_STORAGE_KEY, JSON.stringify(payload));
    var rk = gpRemoteWorkspaceKey();
    if(rk && typeof cpSyncPush === 'function') cpSyncPush(GP_STORAGE_KEY, payload, rk);
  }catch(e){ /* private mode / quota exceeded — persistence is best-effort */ }
}
function gpLoadPersisted(){
  try{
    var raw = localStorage.getItem(GP_STORAGE_KEY);
    if(!raw) return false;
    var data = JSON.parse(raw);
    if(!data || !data.courses || !Object.keys(data.courses).length) return false;
    gpCourses = data.courses;
    gpActiveKey = (data.activeKey && gpCourses[data.activeKey]) ? data.activeKey : Object.keys(gpCourses)[0];
    return true;
  }catch(e){ return false; }
}
/* Two-click confirm built into the button itself, instead of
   window.confirm() -- a sandboxed preview (e.g. this page viewed inside
   a published Claude Artifact) silently auto-dismisses confirm()/
   prompt()/alert(), so a confirm()-gated destructive action would
   silently no-op there even though it works fine in a real, unsandboxed
   browser. This button-based version works identically in both. */
var gpClearArmed = false;
var gpClearArmTimer = null;
function gpResetClearBtn(){
  gpClearArmed = false;
  clearTimeout(gpClearArmTimer);
  var btn = document.getElementById('gpClearBtn');
  var label = document.getElementById('gpClearBtnLabel');
  if(btn) btn.classList.remove('armed');
  if(label) label.textContent = 'Clear All';
}
function gpClearAll(){
  if(!gpClearArmed){
    gpClearArmed = true;
    var btn = document.getElementById('gpClearBtn');
    var label = document.getElementById('gpClearBtnLabel');
    if(btn) btn.classList.add('armed');
    if(label) label.textContent = 'Click again to confirm';
    clearTimeout(gpClearArmTimer);
    gpClearArmTimer = setTimeout(gpResetClearBtn, 4000);
    return;
  }
  gpResetClearBtn();
  gpCourses = {};
  gpActiveKey = null;
  gpExpandedGroups = {};
  try{ localStorage.removeItem(GP_STORAGE_KEY); }catch(e){}
  var rk = gpRemoteWorkspaceKey();
  if(rk && typeof cpSyncPush === 'function') cpSyncPush(GP_STORAGE_KEY, null, rk);
  gpShowUpload();
  gpRenderPills();
  showToast('All GradePilot data on this device has been cleared.');
}

/* Real syllabus-analysis backend: a Groq-backed Vercel serverless
   function that now lives in THIS SAME repo, at api/parse-syllabus/
   (see package.json's groq-sdk dependency + vercel.json). Deployed
   together with this static frontend as one Vercel project, so the
   call below is same-origin — no CORS setup needed. It only responds
   once that Vercel project is deployed with a GROQ_API_KEY environment
   variable set (Vercel dashboard -> Project -> Settings -> Environment
   Variables). Locally, run `vercel dev` from the repo root so both the
   static pages and this function are served together; opening
   index.html directly as a file:// page can't reach any API route, so
   it always falls back to the demo template below. */
var GP_SYLLABUS_API_URL = '/api/parse-syllabus';

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
function gpWithTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise(function(_, reject){ setTimeout(function(){ reject(new Error('timed out')); }, ms); })
  ]);
}
/* Pulls plain text out of every page of an uploaded PDF, on the main
   thread (disableWorker) so it doesn't depend on being able to spin up
   a cross-origin worker inside a sandboxed preview. */
async function gpExtractPdfText(file){
  if(!window.pdfjsLib) throw new Error('pdf.js did not load');
  var buf = await file.arrayBuffer();
  var pdf = await pdfjsLib.getDocument({ data: buf, disableWorker: true }).promise;
  var text = '';
  for(var i = 1; i <= Math.min(pdf.numPages, 15); i++){
    var page = await pdf.getPage(i);
    var content = await page.getTextContent();
    text += content.items.map(function(it){ return it.str; }).join(' ') + '\n\n';
  }
  return text;
}
async function gpParseSyllabusReal(text){
  var res = await fetch(GP_SYLLABUS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 80000) })
  });
  var data = await res.json().catch(function(){ return {}; });
  if(!res.ok) throw new Error((data && data.error) || ('syllabus API returned ' + res.status));
  return data;
}

/* ---- gradingPolicies normalization (mirrors the real API's schema) ---- */
var GP_POLICY_TYPES = {
  drop_lowest:1, drop_highest:1, keep_highest:1, keep_best_n:1, lowest_n:1, free_pass:1,
  attendance_allowance:1, attendance_grace:1, attendance_penalty:1, excused_absence:1,
  extra_credit:1, bonus_points:1, late_penalty:1, late_grace:1, exam_replacement:1,
  makeup_exam:1, score_replacement:1, optional_assignment:1, missed_assignment:1,
  participation_exception:1, assignment_exception:1, informational:1, grading_conflict:1, other:1
};
var GP_MATH_POLICY_TYPES = { drop_lowest:1, lowest_n:1, keep_highest:1, keep_best_n:1 };
function gpNormalizeGradingPolicies(raw){
  if(!Array.isArray(raw)) return undefined;
  var policies = [];
  raw.forEach(function(item){
    if(!item || typeof item.description !== 'string' || !item.description.trim()) return;
    var mappedType = item.type === 'lowest_n' ? 'lowest_n' : item.type;
    var type = GP_POLICY_TYPES[mappedType] ? mappedType : 'other';
    var quantityRaw = item.quantity != null ? item.quantity : item.count;
    var quantity = (typeof quantityRaw === 'number' && quantityRaw > 0) ? Math.floor(quantityRaw) : undefined;
    var appliesTo = (typeof item.appliesTo === 'string' && item.appliesTo.trim()) ? item.appliesTo.trim()
      : ((typeof item.component === 'string' && item.component.trim()) ? item.component.trim() : undefined);
    var componentIds = Array.isArray(item.componentIds) ? item.componentIds.filter(function(id){ return typeof id === 'string'; }) : undefined;
    var relatedComponents = Array.isArray(item.relatedComponents) ? item.relatedComponents.filter(function(id){ return typeof id === 'string'; }) : undefined;
    var sourceStatements = Array.isArray(item.sourceStatements) ? item.sourceStatements.filter(function(t){ return typeof t === 'string' && t.trim(); }).map(function(t){ return t.trim(); }) : undefined;
    var informationalOnly = item.informationalOnly === true || type === 'grading_conflict' || type === 'informational';
    var requiresVerification = item.requiresVerification === true || type === 'grading_conflict';
    var appliesToCalculation = (informationalOnly || requiresVerification) ? false : (item.appliesToCalculation === true || item.applies === 'grade');
    var applies = (GP_MATH_POLICY_TYPES[type] && appliesToCalculation) ? 'grade' : 'info';
    policies.push({
      type:type, appliesTo:appliesTo, component:appliesTo,
      componentIds: (componentIds && componentIds.length) ? componentIds : undefined,
      relatedComponents: (relatedComponents && relatedComponents.length) ? relatedComponents : undefined,
      quantity:quantity, count:quantity,
      description: item.description.trim(),
      calculationEffect: (typeof item.calculationEffect === 'string' && item.calculationEffect.trim()) ? item.calculationEffect.trim() : undefined,
      appliesToCalculation: appliesToCalculation, informationalOnly: informationalOnly, applies: applies,
      severity: (item.severity==='warning'||item.severity==='info') ? item.severity : (type==='grading_conflict' ? 'warning' : undefined),
      requiresVerification: requiresVerification || undefined,
      sourceStatements: (sourceStatements && sourceStatements.length) ? sourceStatements : undefined
    });
  });
  // demo templates above already hand us normalized-shaped policies — just
  // fill in applies/componentIds consistently so both paths behave alike.
  return policies.length ? policies : undefined;
}

function gpCutoffMentionedInSyllabus(text, min){
  var variants = {};
  variants[String(min)] = 1;
  variants[min.toFixed(1)] = 1;
  variants[String(Math.trunc(min))] = 1;
  if(Number.isInteger(min)) variants[min+'.0'] = 1;
  var haystack = (text||'').replace(/,/g,'');
  return Object.keys(variants).some(function(token){
    var escaped = token.replace(/\./g,'\\.');
    return new RegExp('(?:^|\\D)'+escaped+'(?:\\D|$)').test(haystack);
  });
}

/* Maps the real API's parsed-syllabus JSON (components + gradingPolicies
   + gradeScale) onto a GradePilot course. A proposed grade-scale cutoff
   is only trusted if its number is literally present in the syllabus
   text — otherwise the course falls back to the standard scale rather
   than risk a hallucinated cutoff. */
/* The course "code" is what shows in the small pill at the top of the
   page (gpRenderPills) -- it's meant to be a short department+number
   label like "CS 2100", but the AI parser doesn't always return a clean
   one: sometimes it's the full course title, sometimes it's missing, and
   the old code just blindly truncated whatever came back to 14
   characters, which could cut a real title mid-word into something
   unreadable. This instead actually looks for something that resembles
   a real course code (letters + a number, e.g. "CHEM 1210", "CS-2100")
   in the parsed code first, then in the course name (a few models put
   the code there instead), and only falls back to a short, word-
   boundary-safe label built from the name/filename if neither looks like
   a real code -- so the pill always shows either a real code or a short,
   legible phrase, never a mid-word fragment. */
var GP_COURSE_CODE_RE = /\b([A-Za-z]{2,6})[\s-]?(\d{3,4}[A-Za-z]?)\b/;
function gpExtractCourseCode(s){
  if(!s) return null;
  var m = String(s).match(GP_COURSE_CODE_RE);
  return m ? (m[1].toUpperCase() + ' ' + m[2].toUpperCase()) : null;
}
function gpShortLabel(base, maxLen){
  var words = String(base||'').replace(/[_]+/g,' ').trim().split(/\s+/).filter(Boolean);
  var label = '';
  for(var i=0;i<words.length;i++){
    var next = label ? (label + ' ' + words[i]) : words[i];
    if(next.length > maxLen) break;
    label = next;
  }
  return label || 'New Course';
}
function gpCleanCourseCode(rawCode, name, fallbackBase){
  return gpExtractCourseCode(rawCode)
    || gpExtractCourseCode(name)
    || gpShortLabel(name || fallbackBase, 18);
}

function gpMapParsedSyllabus(parsed, filename, rawText){
  var gradeScaleRaw = Array.isArray(parsed.gradeScale) ? parsed.gradeScale
    .filter(function(g){ return typeof g.label === 'string' && isFinite(Number(g.min)); })
    .map(function(g){ return [g.label.trim().toUpperCase(), Number(g.min), isFinite(Number(g.gpa)) ? Number(g.gpa) : 0]; })
    .sort(function(a,b){ return b[1]-a[1]; }) : undefined;
  if(gradeScaleRaw && gradeScaleRaw.length && !gradeScaleRaw.some(function(g){ return g[0]==='F'; })){
    gradeScaleRaw.push(['F',0,0]);
  }
  var attested = (gradeScaleRaw||[]).filter(function(g){ return g[0]==='F' || gpCutoffMentionedInSyllabus(rawText, g[1]); });
  var explicitCount = attested.filter(function(g){ return g[0]!=='F'; }).length;
  var explicitScale = explicitCount >= 4 ? attested : undefined;
  var hasParsedScale = !!(explicitScale && explicitScale.length);

  var gradingPolicies = gpNormalizeGradingPolicies(parsed.gradingPolicies);

  var comps = Array.isArray(parsed.components) ? parsed.components : [];
  var components = comps.map(function(c, i){
    return {
      id: c.id || ('c'+i), name: c.name || ('Item '+(i+1)),
      weight: Number(c.weight) || 0, earned: null, total: Number(c.total) || 100,
      category: (typeof c.category === 'string' && c.category.trim()) ? c.category.trim() : undefined
    };
  });

  var credits = (typeof parsed.credits === 'number' && parsed.credits > 0) ? parsed.credits : undefined;

  var fallbackBase = (filename.split('.')[0]||'New Course');
  var name = (typeof parsed.name === 'string' && parsed.name.trim()) ? parsed.name.trim() : fallbackBase;

  return {
    code: gpCleanCourseCode(parsed.code, name, fallbackBase),
    name: name,
    instructor: parsed.professor || 'Instructor TBD',
    credits: credits, file: filename, target: 'A',
    components: components,
    gradeScale: hasParsedScale ? explicitScale : GP_FALLBACK_GRADES.map(function(g){ return g.slice(); }),
    gradeScaleSource: hasParsedScale ? 'parsed' : 'fallback',
    gradingPolicies: gradingPolicies
  };
}

/* ---- policy chips (display only — see the big comment at the top) ---- */
var GP_POLICY_CHIP_STYLES = {
  'DROP LOWEST': {color:'#1d4ed8', bg:'#eff6ff'}, 'KEEP BEST': {color:'#1d4ed8', bg:'#eff6ff'},
  PENALTY: {color:'#92400e', bg:'#fffbeb'}, BONUS: {color:'#15803d', bg:'#f0fdf4'},
  REPLACEMENT: {color:'#6d28d9', bg:'#f5f3ff'}, 'FREE PASS': {color:'#0f766e', bg:'#f0fdfa'},
  ALLOWANCE: {color:'#0f766e', bg:'#f0fdfa'}, 'MAKE-UP': {color:'#0f766e', bg:'#f0fdfa'},
  RECOVERY: {color:'#0f766e', bg:'#f0fdfa'}, 'HARD CONSEQUENCE': {color:'#b91c1c', bg:'#fef2f2'},
  CONFLICT: {color:'#b91c1c', bg:'#fef2f2'}
};
var GP_POLICY_CHIP_GENERAL = {
  'DROP LOWEST':'The lowest N scores in a category are excluded from the course grade.',
  'KEEP BEST':'Only the highest N scores in a category count toward the course grade.',
  PENALTY:'The syllabus reduces a score or the course grade when a stated rule is broken.',
  BONUS:'Optional extra points. Not a regular weighted component unless the syllabus gives a percentage.',
  REPLACEMENT:'A later score can replace an earlier one when the stated condition is met.',
  'FREE PASS':'A limited number of items may be skipped. Not the same as dropping the lowest scores.',
  ALLOWANCE:'A limited number of absences or misses are permitted under the stated conditions.',
  'MAKE-UP':'A missed assessment may be completed later only under the stated conditions.',
  RECOVERY:'A missed or excused item can be restored through the process described in the syllabus.',
  'HARD CONSEQUENCE':'Missing this requirement can cap or fail the course regardless of other scores.',
  CONFLICT:'The syllabus states grading rules that do not agree. Confirm the intended rule with the instructor.'
};
function gpPolicyCount(policy){
  var v = policy.quantity != null ? policy.quantity : policy.count;
  return (typeof v === 'number' && v > 0) ? Math.floor(v) : 1;
}
function gpPolicyCategoryKey(policy){ return (policy.appliesTo||policy.component||'').trim().toLowerCase(); }
function gpIsMathDropOrKeep(type){ return type==='drop_lowest'||type==='lowest_n'||type==='keep_highest'||type==='keep_best_n'; }
function gpFormatPolicyTarget(policy){
  var raw = (policy.appliesTo||policy.component||'').trim();
  if(!raw || /^(course|all|entire course)$/i.test(raw)) return null;
  return raw.replace(/_/g,' ').replace(/\s+/g,' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
}
function gpPolicyTextBlob(policy){
  return [policy.description, policy.calculationEffect].concat(policy.sourceStatements||[]).filter(Boolean).join(' ').toLowerCase();
}
function gpIsHardConsequencePolicy(policy){
  return /grade of e\b|receive a grade of e|receive an e\b|fail the course|failing grade|regardless of (their )?performance|letter grade of e/.test(gpPolicyTextBlob(policy));
}
function gpIsRecoveryPolicy(policy){ return /\brecover/.test(gpPolicyTextBlob(policy)); }
function gpConflictCategories(policies){
  var flagged = {}, mathByCategory = {};
  (policies||[]).forEach(function(policy){
    var category = gpPolicyCategoryKey(policy);
    if(!category || category==='course' || category==='all' || category==='entire course') return;
    if(policy.type==='grading_conflict') flagged[category]=true;
    if(!GP_MATH_POLICY_TYPES[policy.type]) return;
    var family = (policy.type==='keep_highest'||policy.type==='keep_best_n') ? 'keep' : 'drop';
    mathByCategory[category] = mathByCategory[category] || {};
    mathByCategory[category][family] = true;
  });
  Object.keys(mathByCategory).forEach(function(category){
    var fam = mathByCategory[category];
    if(fam.drop && fam.keep) flagged[category] = true;
  });
  return flagged;
}
function gpConflictChipSpecific(policies, category){
  var related = policies.filter(function(p){ return gpPolicyCategoryKey(p)===category && (p.type==='grading_conflict' || gpIsMathDropOrKeep(p.type)); });
  var statements = [];
  related.forEach(function(p){
    var quoted = (p.sourceStatements||[]).map(function(t){ return '"'+t+'"'; });
    if(quoted.length) statements = statements.concat(quoted);
    else if(p.description && p.description.trim()) statements.push(p.description.trim());
  });
  var unique = statements.filter(function(s,i){ return statements.indexOf(s)===i; });
  if(unique.length) return 'The syllabus contains conflicting instructions for this category and does not resolve which rule to use. ' + unique.join(' ');
  return 'The syllabus contains conflicting grading instructions for this category and does not resolve which rule to use.';
}
function gpMapPolicyToChip(policy, index){
  var target = gpFormatPolicyTarget(policy);
  var specificParts = [policy.description ? policy.description.trim() : ''].concat(policy.sourceStatements||[]).filter(function(t,i,arr){ return t && arr.indexOf(t)===i; });
  var specific = specificParts.join(' ');
  var quantity = gpPolicyCount(policy);
  var id = policy.type+'-'+index;
  function chip(kind, label){ return { id:id, kind:kind, label:label, target:target, general:GP_POLICY_CHIP_GENERAL[kind], specific:specific }; }
  if(policy.type==='grading_conflict') return chip('CONFLICT','CONFLICT');
  if(gpIsHardConsequencePolicy(policy)) return chip('HARD CONSEQUENCE','HARD CONSEQUENCE');
  if(policy.type==='drop_lowest'||policy.type==='lowest_n') return chip('DROP LOWEST','DROP LOWEST '+quantity);
  if(policy.type==='keep_highest'||policy.type==='keep_best_n') return chip('KEEP BEST','KEEP BEST '+quantity);
  if(policy.type==='free_pass') return chip('FREE PASS','FREE PASS');
  if(policy.type==='makeup_exam') return chip('MAKE-UP','MAKE-UP');
  if(policy.type==='exam_replacement'||policy.type==='score_replacement') return chip('REPLACEMENT','REPLACEMENT');
  if(policy.type==='extra_credit'||policy.type==='bonus_points') return chip('BONUS','BONUS');
  if(policy.type==='late_penalty'||policy.type==='attendance_penalty'){ if(!specific) return null; return chip('PENALTY','PENALTY'); }
  if(gpIsRecoveryPolicy(policy)) return chip('RECOVERY','RECOVERY');
  if(policy.type==='attendance_allowance'||policy.type==='attendance_grace'||policy.type==='excused_absence'||policy.type==='late_grace') return chip('ALLOWANCE','ALLOWANCE');
  return null;
}
function gpPolicyChipsForCourse(course){
  var policies = course.gradingPolicies || [];
  var blocked = gpConflictCategories(policies);
  var chips = [];
  policies.forEach(function(policy, index){
    if(gpIsMathDropOrKeep(policy.type) && blocked[gpPolicyCategoryKey(policy)]) return;
    var chip = gpMapPolicyToChip(policy, index);
    if(chip) chips.push(chip);
  });
  Object.keys(blocked).forEach(function(category){
    var target = gpFormatPolicyTarget({ appliesTo: category });
    var already = chips.some(function(c){ return c.kind==='CONFLICT' && (c.target||'').toLowerCase()===(target||'').toLowerCase(); });
    if(already) return;
    chips.unshift({ id:'conflict-'+category, kind:'CONFLICT', label:'CONFLICT', target:target, general:GP_POLICY_CHIP_GENERAL.CONFLICT, specific:gpConflictChipSpecific(policies, category) });
  });
  return chips;
}

/* ---- the calculation engine itself ---- */
function gpMatchesPolicyComponent(component, policy){
  if(policy.componentIds && policy.componentIds.indexOf(component.id) > -1) return true;
  var label = (policy.appliesTo||policy.component||'').trim().toLowerCase();
  if(!label) return false;
  var category = (component.category||'').trim().toLowerCase();
  var name = component.name.trim().toLowerCase();
  if(category===label || name===label) return true;
  if((category && category.indexOf(label)>-1) || label.indexOf(category||'\0')>-1) return true;
  var singular = label.replace(/ies$/,'y').replace(/s$/,'').replace(/_/g,' ');
  return name.indexOf(singular)===0 || (!!category && category.replace(/_/g,' ').indexOf(singular)===0);
}
function gpComponentsForPolicy(course, policy){ return course.components.filter(function(c){ return gpMatchesPolicyComponent(c, policy); }); }
function gpIdsToDropForPolicy(course, scores, policy){
  var matched = gpComponentsForPolicy(course, policy).map(function(c){
    var score = scores[c.id];
    if(score===undefined) return null;
    return { id:c.id, pct:(score/c.total)*100 };
  }).filter(Boolean);
  if(matched.length<2) return [];
  var count = Math.min(gpPolicyCount(policy), matched.length-1);
  if(count<=0) return [];
  var keepCount = Math.max(1, Math.min(count, matched.length));
  if(policy.type==='keep_highest'||policy.type==='keep_best_n'){
    return matched.slice().sort(function(a,b){ return b.pct-a.pct; }).slice(keepCount).map(function(x){ return x.id; });
  }
  return matched.slice().sort(function(a,b){ return a.pct-b.pct; }).slice(0,count).map(function(x){ return x.id; });
}
function gpDroppedIdsForScores(course, scores){
  var dropped = {};
  var blocked = gpConflictCategories(course.gradingPolicies);
  (course.gradingPolicies||[]).forEach(function(policy){
    if(policy.applies!=='grade' || !GP_MATH_POLICY_TYPES[policy.type]) return;
    if(blocked[gpPolicyCategoryKey(policy)]) return;
    gpIdsToDropForPolicy(course, scores, policy).forEach(function(id){ dropped[id]=true; });
  });
  return dropped;
}
function gpApplyGradingPolicies(course, scores){
  var dropped = gpDroppedIdsForScores(course, scores);
  if(!Object.keys(dropped).length) return scores;
  var result = {};
  Object.keys(scores).forEach(function(id){ if(!dropped[id]) result[id]=scores[id]; });
  return result;
}
function gpEffectiveWeights(course, scores){
  var weights = {};
  course.components.forEach(function(c){ weights[c.id]=c.weight; });
  var dropped = gpDroppedIdsForScores(course, scores);
  var blocked = gpConflictCategories(course.gradingPolicies);
  (course.gradingPolicies||[]).forEach(function(policy){
    if(policy.applies!=='grade' || !GP_MATH_POLICY_TYPES[policy.type]) return;
    if(blocked[gpPolicyCategoryKey(policy)]) return;
    var members = gpComponentsForPolicy(course, policy);
    if(members.length<2) return;
    var categoryWeight = members.reduce(function(s,c){ return s+c.weight; },0);
    var remaining = members.filter(function(c){ return !dropped[c.id]; });
    if(!remaining.length || categoryWeight<=0) return;
    var share = categoryWeight/remaining.length;
    members.forEach(function(c){ weights[c.id] = dropped[c.id] ? 0 : share; });
  });
  return weights;
}
function gpRawScores(course, overrides){
  var raw = {};
  course.components.forEach(function(c){
    if(overrides && Object.prototype.hasOwnProperty.call(overrides, c.id)) raw[c.id] = overrides[c.id];
    else if(c.earned !== null && c.earned !== undefined) raw[c.id] = c.earned;
  });
  return raw;
}
function gpComputeProjectedFromScores(course, raw){
  var weights = gpEffectiveWeights(course, raw);
  var scores = gpApplyGradingPolicies(course, raw);
  var ws=0, tw=0;
  course.components.forEach(function(c){
    var score = scores[c.id];
    if(score===undefined) return;
    var weight = weights[c.id]!=null ? weights[c.id] : c.weight;
    if(weight<=0) return;
    ws += (score/c.total)*100*weight;
    tw += weight;
  });
  return tw>0 ? ws/tw : null;
}
function gpComputeProjected(course){ return gpComputeProjectedFromScores(course, gpRawScores(course)); }
function gpDroppedIdsCurrently(course){
  var raw = gpRawScores(course);
  var kept = gpApplyGradingPolicies(course, raw);
  var droppedSet = {};
  Object.keys(raw).forEach(function(id){ if(!(id in kept)) droppedSet[id]=true; });
  return droppedSet;
}
function gpSolveRequiredScore(targetPct, projectedAt){
  if(projectedAt(0) >= targetPct) return 0;
  if(projectedAt(100) < targetPct) return 101;
  if(projectedAt(targetPct) >= targetPct){
    var justBelow = Math.max(0, targetPct - 1e-6);
    if(projectedAt(justBelow) < targetPct) return targetPct;
  }
  var low=0, high=100;
  for(var i=0;i<32;i++){
    var mid=(low+high)/2;
    if(projectedAt(mid) >= targetPct) high=mid; else low=mid;
  }
  if(projectedAt(targetPct) >= targetPct && high >= targetPct) return targetPct;
  return high;
}
function gpRequiredAcrossPending(course, targetPct){
  var raw = gpRawScores(course);
  var pending = course.components.filter(function(c){ return raw[c.id]===undefined; });
  if(!pending.length) return NaN;
  function projectedAt(scorePct){
    var sim = {};
    course.components.forEach(function(c){ sim[c.id] = raw[c.id]!==undefined ? raw[c.id] : (scorePct/100)*c.total; });
    return gpComputeProjectedFromScores(course, sim) || 0;
  }
  return gpSolveRequiredScore(targetPct, projectedAt);
}
function gpSafetyRange(course){
  var raw = gpRawScores(course);
  var hasPending = course.components.some(function(c){ return raw[c.id]===undefined; });
  if(!hasPending){
    var p = gpComputeProjected(course) || 0;
    return { minPct:p, maxPct:p };
  }
  function simAt(pct){
    var sim = {};
    course.components.forEach(function(c){ sim[c.id] = raw[c.id]!==undefined ? raw[c.id] : (pct/100)*c.total; });
    return gpComputeProjectedFromScores(course, sim) || 0;
  }
  return { minPct: simAt(0), maxPct: simAt(100) };
}

/* ---- numbered-assessment auto-grouping ("Quiz 1..Quiz 8" -> one
   collapsible "Quizzes" row) so an arbitrary real syllabus with many
   repeated items still renders as a clean, groupable table. ---- */
function gpNumberedAssessmentParts(name){
  var m = String(name).trim().match(/^(.*\S)\s+(\d+)$/);
  if(!m) return null;
  var n = Number(m[2]);
  if(!Number.isInteger(n) || n<1) return null;
  return { stem:m[1].trim(), n:n };
}
function gpIsExamLikeStem(stem){ return /^(unit|exam|midterm|final)s?$/i.test(stem.trim()); }
function gpPluralizeAssessmentWord(word){
  if(/homework$/i.test(word)) return word;
  if(/quiz$/i.test(word)) return /^[A-Z]/.test(word) ? 'Quizzes' : 'quizzes';
  if(/(?:s|x|z|ch|sh)$/i.test(word)) return word+'es';
  if(/[^aeiou]y$/i.test(word)) return word.slice(0,-1)+'ies';
  return word+'s';
}
function gpGroupTitleForMembers(members){
  var categories = [];
  members.forEach(function(m){ if(m.category && categories.indexOf(m.category.trim())===-1) categories.push(m.category.trim()); });
  if(categories.length===1) return categories[0];
  var parts = gpNumberedAssessmentParts(members[0].name);
  var stem = parts ? parts.stem : members[0].name;
  var words = stem.split(/\s+/);
  words[words.length-1] = gpPluralizeAssessmentWord(words[words.length-1]);
  return words.join(' ');
}
function gpAssessmentListEntries(components){
  var stemCount = {};
  components.forEach(function(c){
    var parts = gpNumberedAssessmentParts(c.name);
    if(!parts || gpIsExamLikeStem(parts.stem)) return;
    var key = parts.stem.toLowerCase();
    stemCount[key] = (stemCount[key]||0)+1;
  });
  var consumed = {};
  var entries = [];
  components.forEach(function(c){
    if(consumed[c.id]) return;
    var parts = gpNumberedAssessmentParts(c.name);
    var key = parts && !gpIsExamLikeStem(parts.stem) ? parts.stem.toLowerCase() : null;
    if(key && (stemCount[key]||0) >= 2){
      var members = components.filter(function(item){
        var ip = gpNumberedAssessmentParts(item.name);
        return ip && !gpIsExamLikeStem(ip.stem) && ip.stem.toLowerCase()===key;
      });
      members.forEach(function(m){ consumed[m.id]=true; });
      entries.push({ type:'group', key:key, title:gpGroupTitleForMembers(members), members:members });
    } else {
      entries.push({ type:'item', component:c });
    }
  });
  return entries;
}

function gpShowUpload(){
  document.getElementById('gpDashboardView').classList.add('hidden');
  document.getElementById('gpUploadView').classList.remove('hidden');
  var cancelBtn = document.getElementById('gpCancelBtn');
  cancelBtn.classList.toggle('hidden', Object.keys(gpCourses).length === 0);
}
function gpShowDashboard(){
  if(!gpActiveKey || !gpCourses[gpActiveKey]){ gpShowUpload(); return; }
  document.getElementById('gpUploadView').classList.add('hidden');
  document.getElementById('gpDashboardView').classList.remove('hidden');
}

function gpRenderPills(){
  var toolbar = document.getElementById('gpToolbar');
  var wrap = document.getElementById('gpPills');
  var keys = Object.keys(gpCourses);
  toolbar.classList.toggle('hidden', keys.length === 0);
  wrap.innerHTML = keys.map(function(key){
    var c = gpCourses[key];
    var active = key === gpActiveKey;
    var armed = key === gpDeleteArmedKey;
    var gradeSpan = c.currentLetter ? ' <span class="pill-grade">'+c.currentLetter+'</span>' : '';
    return '<span class="gp-pill-wrap">' +
      '<button class="gp-pill'+(active?' active':'')+'" onclick="gpSelectCourse(\''+key+'\')"><span class="dot"></span>'+c.code+gradeSpan+'</button>' +
      '<button type="button" class="gp-pill-x'+(armed?' armed':'')+'" onclick="event.stopPropagation();gpDeleteCourse(\''+key+'\')" title="'+(armed?'Click again to remove':'Remove this course')+'" aria-label="Remove '+c.code+'">'+(armed?'Confirm':'×')+'</button>' +
    '</span>';
  }).join('');
}
/* Per-course delete -- separate from "Clear All" (gpClearAll above),
   which wipes every course at once. Uses the same two-click armed
   pattern (window.confirm()/alert() are silently auto-dismissed inside a
   sandboxed Artifact preview, so a real confirm() dialog can't be relied
   on there) but tracks ONE armed course key at a time instead of a single
   global flag, since several pills can sit side by side. */
var gpDeleteArmedKey = null;
var gpDeleteArmTimer = null;
function gpResetDeleteArm(){
  gpDeleteArmedKey = null;
  clearTimeout(gpDeleteArmTimer);
}
function gpDeleteCourse(key){
  if(!gpCourses[key]) return;
  if(gpDeleteArmedKey !== key){
    gpDeleteArmedKey = key;
    clearTimeout(gpDeleteArmTimer);
    gpDeleteArmTimer = setTimeout(function(){ gpResetDeleteArm(); gpRenderPills(); }, 4000);
    gpRenderPills();
    return;
  }
  gpResetDeleteArm();
  var removedCode = gpCourses[key].code;
  var wasActive = (key === gpActiveKey);
  delete gpCourses[key];

  if(wasActive){
    var remaining = Object.keys(gpCourses);
    gpActiveKey = remaining.length ? remaining[0] : null;
  }
  gpPersist();

  if(Object.keys(gpCourses).length === 0){
    gpShowUpload();
  } else {
    gpShowDashboard();
    gpRenderCourse();
  }
  gpRenderPills();
  showToast('Removed ' + (removedCode || 'course') + '.');
}
function gpSelectCourse(key){
  gpActiveKey = key;
  gpPersist();
  gpShowDashboard();
  gpRenderPills();
  gpRenderCourse();
  showToast('Switched to ' + gpCourses[key].code);
}

function gpSetStaged(key, filename, fileObj){
  gpStagedKey = key;
  gpStagedFile = filename;
  gpStagedFileObj = fileObj || null;
  var el = document.getElementById('gpStagedName');
  el.textContent = 'Selected: ' + filename;
  el.classList.remove('hidden');
}
function gpHandleFileSelected(e){
  var file = e.target.files[0];
  if(!file) return;
  gpSetStaged(null, file.name, file);
}
function gpHandleDrop(e){
  e.preventDefault();
  var file = e.dataTransfer.files[0];
  if(!file) return;
  gpSetStaged(null, file.name, file);
}

function gpStartAnalysis(){
  if(!gpStagedFile && !gpStagedFileObj){
    showToast('Choose a syllabus PDF first.');
    return;
  }

  var overlay = document.getElementById('gpOverlay');
  var bar = document.getElementById('gpOverlayBar');
  var title = document.getElementById('gpOverlayTitle');
  var sub = document.getElementById('gpOverlaySub');

  overlay.classList.remove('hidden');

  if(gpStagedFileObj){
    // A real PDF was dropped in (not a quick-load sample): read it and
    // send it to the live syllabus-parsing API. If that call can't go
    // through — e.g. this exact page is running inside a sandboxed
    // preview that blocks outbound requests — gpRunRealAnalysis falls
    // back to the same demo behavior as a sample, so the tool never
    // just hangs or dead-ends on the overlay.
    title.textContent = 'Reading your syllabus...';
    sub.textContent = 'Extracting text from the PDF';
    bar.style.width = '12%';
    gpRunRealAnalysis(overlay, bar, title, sub);
    return;
  }

  title.textContent = 'Extracting course rules...';
  sub.textContent = 'Parsing weights, drop policies & grade cutoffs';
  bar.style.width = '15%';

  var progress = 15;
  var timer = setInterval(function(){
    progress += 28;
    bar.style.width = Math.min(progress,100) + '%';
    if(progress >= 65 && progress < 93){
      title.textContent = 'Building grade model...';
      sub.textContent = 'Mapping assessments to letter-grade thresholds';
    }
    if(progress >= 100){
      clearInterval(timer);
      setTimeout(function(){
        overlay.classList.add('hidden');
        gpFinishAnalysis();
      }, 300);
    }
  }, 220);
}

async function gpRunRealAnalysis(overlay, bar, title, sub){
  var fileObj = gpStagedFileObj;
  var filename = gpStagedFile;
  try{
    bar.style.width = '30%';
    var text = await gpExtractPdfText(fileObj);
    title.textContent = 'Analyzing with AI...';
    sub.textContent = 'Sending syllabus text to the grading-rules model';
    bar.style.width = '55%';
    var parsed = await gpWithTimeout(gpParseSyllabusReal(text), 20000);
    bar.style.width = '85%';
    var course = gpMapParsedSyllabus(parsed, filename, text);
    bar.style.width = '100%';
    gpLogAiAttempt(true, course.code || filename);
    setTimeout(function(){
      overlay.classList.add('hidden');
      gpCommitCourse(course, 'REAL_' + Date.now(), 'AI analyzed ' + course.code + ' from your syllabus!');
    }, 250);
  } catch(err){
    console.warn('GradePilot: real syllabus analysis failed, falling back to demo data.', err);
    gpLogAiAttempt(false, filename);
    overlay.classList.add('hidden');
    showToast('Could not reach the syllabus AI (sandboxed preview or network) — loaded demo data instead.');
    gpFinishAnalysis();
  }
}

function gpCommitCourse(course, forcedKey, toastMsg){
  if(gpStagedFile && !course.file) course.file = gpStagedFile;
  var key = forcedKey || gpStagedKey || ('CUSTOM_' + Date.now());
  gpCourses[key] = course;
  gpActiveKey = key;
  gpPersist();

  gpShowDashboard();
  gpRenderPills();
  gpRenderCourse();
  showToast(toastMsg);

  gpStagedKey = null;
  gpStagedFile = '';
  gpStagedFileObj = null;
}

/* Fallback when the real syllabus-analysis API can't be reached (e.g. this
   exact page running inside a sandboxed preview that blocks outbound
   fetch()) — a minimal, generic starting structure, not canned course
   content, so the person can still fill in real weights by hand. */
function gpFinishAnalysis(){
  var label = (gpStagedFile.split('.')[0] || 'New Course').slice(0, 24);
  var course = {
    code: label.slice(0,10), name: label, instructor: 'Instructor TBD', credits: undefined,
    file: gpStagedFile, target: 'A', gradeScaleSource: 'fallback',
    components: [
      { id:'c1', name:'Assignments', weight:40, total:100, earned:null },
      { id:'c2', name:'Midterm Exam', weight:30, total:100, earned:null },
      { id:'c3', name:'Final Exam', weight:30, total:100, earned:null }
    ],
    gradingPolicies: []
  };
  gpCommitCourse(course, gpStagedKey, 'Grade model created for ' + course.code + '!');
}

function gpRenderCourse(){
  var c = gpCourses[gpActiveKey];
  if(!c) return;

  document.getElementById('gpCourseTitle').textContent = c.name;
  document.getElementById('gpCourseInstructor').textContent = c.instructor;
  document.getElementById('gpActiveFileName').textContent = c.file;
  document.getElementById('gpAppliedCourse').textContent = c.code;
  document.getElementById('gpRightCourseBadge').textContent = c.code;
  document.getElementById('gpGpaCourse').textContent = c.code;

  gpRenderCourseRules();
  gpRenderGradeGrid();
  gpRenderRows();
  gpCalculate();
}

function gpRenderCourseRules(){
  var c = gpCourses[gpActiveKey];
  var wrap = document.getElementById('gpCourseRules');
  if(!wrap) return;
  var chips = c ? gpPolicyChipsForCourse(c) : [];
  if(!chips.length){ wrap.innerHTML = ''; return; }
  /* Every chip (DROP LOWEST, REPLACEMENT, RECOVERY, CONFLICT, ...) used to
     explain itself only through a native `title` hover tooltip, which a
     first-time student is unlikely to ever discover — a syllabus's less
     common grading rules (replacement, recovery, drop-N, etc.) would just
     show up as a bare unexplained badge. Each chip now gets its own
     clickable "i" button that opens a small popup with a general
     explanation of what that rule type means, plus (when available) the
     specific version of the rule this syllabus actually stated. */
  wrap.innerHTML = chips.map(function(chip){
    var style = GP_POLICY_CHIP_STYLES[chip.kind] || {};
    var general = chip.general || '';
    var specific = (chip.specific && chip.specific !== general) ? chip.specific : '';
    var css = (style.color ? ('color:'+style.color+';') : '') + (style.bg ? ('background:'+style.bg+';') : '');
    var popupCss = style.color ? ('border-top-color:'+style.color+';') : '';
    var titleCss = style.color ? ('color:'+style.color+';') : '';
    return '<span class="gp-rule-chip" style="'+css+'">'
      + '<svg width="7" height="7" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>'
      + gpEsc(chip.label)
      + '<button type="button" class="gp-rule-info-btn" aria-label="What does '+gpEsc(chip.label)+' mean?" onclick="event.stopPropagation();gpToggleRuleInfo(this)">i</button>'
      + '<div class="gp-rule-popup" style="'+popupCss+'" onclick="event.stopPropagation()">'
        + '<div class="gp-rule-popup-title" style="'+titleCss+'">'+gpEsc(chip.label)+'</div>'
        + (general ? '<p>'+gpEsc(general)+'</p>' : '')
        + (specific ? '<p>'+gpEsc(specific)+'</p>' : '')
      + '</div>'
      + '</span>';
  }).join('');
}
function gpToggleRuleInfo(btn){
  var chip = btn.closest('.gp-rule-chip');
  var popup = chip ? chip.querySelector('.gp-rule-popup') : null;
  if(!popup) return;
  var wasOpen = popup.classList.contains('open');
  document.querySelectorAll('.gp-rule-popup.open').forEach(function(p){ p.classList.remove('open'); });
  if(!wasOpen) popup.classList.add('open');
}
document.addEventListener('click', function(e){
  if(e.target.closest('.gp-rule-chip')) return;
  document.querySelectorAll('.gp-rule-popup.open').forEach(function(p){ p.classList.remove('open'); });
});

function gpRenderGradeGrid(){
  var c = gpCourses[gpActiveKey];
  var targets = gpTargetGradesForCourse(c);
  if(!c.target || targets.indexOf(c.target) === -1) c.target = targets[0] || 'A';
  var grid = document.getElementById('gpGradeGrid');
  grid.innerHTML = targets.map(function(grade){
    var active = grade === c.target;
    return '<button class="gp-grade-btn'+(active?' active':'')+'" onclick="gpSetTargetGrade(\''+grade+'\')">'+grade+'</button>';
  }).join('');
}
function gpSetTargetGrade(grade){
  gpCourses[gpActiveKey].target = grade;
  gpPersist();
  gpRenderGradeGrid();
  gpCalculate();
}

function gpRenderRows(){
  var c = gpCourses[gpActiveKey];
  var list = document.getElementById('gpRows');
  if(!c){ list.innerHTML = ''; return; }
  var scale = gpGradesForCourse(c);
  var dropped = gpDroppedIdsCurrently(c);
  var entries = gpAssessmentListEntries(c.components);
  var html = '';
  var totalWeight = 0;

  function gradeCell(comp){
    if(dropped[comp.id]) return '<span class="gp-dropped-tag">DROPPED</span>';
    if(comp.earned === null || comp.earned === undefined) return '<span class="gp-status-tag pending">PENDING</span>';
    var pct = (comp.earned / comp.total) * 100;
    return '<span class="gp-row-grade">'+gpGradeFor(pct, scale)[0]+'</span>';
  }

  entries.forEach(function(entry){
    if(entry.type === 'group'){
      var groupId = gpActiveKey + ':' + entry.key;
      var expanded = !!gpExpandedGroups[groupId];
      var groupWeight = entry.members.reduce(function(s,m){ return s+m.weight; }, 0);
      totalWeight += groupWeight;
      var done = entry.members.filter(function(m){ return m.earned !== null && m.earned !== undefined; }).length;
      html += '<div class="gp-row gp-row-group'+(expanded?' expanded':'')+'" onclick="gpToggleGroup(\''+groupId+'\')">'
        + '<div class="gp-row-name"><span class="gp-chevron"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span><span class="label">'+entry.title+'</span></div>'
        + '<div class="gp-row-wt">'+(Math.round(groupWeight*10)/10)+'%</div>'
        + '<div class="gp-row-group-count">'+done+'/'+entry.members.length+' completed</div>'
        + '</div>';
      if(expanded){
        html += '<div class="gp-subrows">' + entry.members.map(function(m){
          var isDone = m.earned !== null && m.earned !== undefined;
          var isDropped = !!dropped[m.id];
          return '<div class="gp-subrow'+(isDropped?' is-dropped':'')+'">'
            + '<div class="gp-row-name"><span class="gp-dot'+(isDone?' done':'')+'"></span><span class="label'+(isDropped?' is-dropped-label':'')+'">'+m.name+'</span></div>'
            + '<div class="gp-row-wt">'+(Math.round(m.weight*10)/10)+'%</div>'
            + '<div class="gp-row-score"><input type="text" inputmode="decimal" autocomplete="off" id="gp-score-'+m.id+'" value="'+(Object.prototype.hasOwnProperty.call(gpRawInputDraft,m.id)?gpRawInputDraft[m.id]:(isDone?m.earned:''))+'" placeholder="—" oninput="gpSetComponentScore(\''+m.id+'\',this.value)" onblur="gpClearScoreDraft(\''+m.id+'\')"><span>/'+m.total+'</span></div>'
            + '<div class="gp-row-status">'+gradeCell(m)+'</div>'
            + '</div>';
        }).join('') + '</div>';
      }
    } else {
      var comp = entry.component;
      totalWeight += comp.weight;
      var isDone2 = comp.earned !== null && comp.earned !== undefined;
      var isDropped2 = !!dropped[comp.id];
      html += '<div class="gp-row'+(isDropped2?' is-dropped':'')+'">'
        + '<div class="gp-row-name"><span class="gp-dot'+(isDone2?' done':'')+'"></span><span class="label'+(isDropped2?' is-dropped-label':'')+'">'+comp.name+'</span></div>'
        + '<div class="gp-row-wt">'+(Math.round(comp.weight*10)/10)+'%</div>'
        + '<div class="gp-row-score"><input type="text" inputmode="decimal" autocomplete="off" id="gp-score-'+comp.id+'" value="'+(Object.prototype.hasOwnProperty.call(gpRawInputDraft,comp.id)?gpRawInputDraft[comp.id]:(isDone2?comp.earned:''))+'" placeholder="—" oninput="gpSetComponentScore(\''+comp.id+'\',this.value)" onblur="gpClearScoreDraft(\''+comp.id+'\')"><span>/'+comp.total+'</span></div>'
        + '<div class="gp-row-status">'+gradeCell(comp)+'</div>'
        + '</div>';
    }
  });

  list.innerHTML = html;
  document.getElementById('gpWeightTotal').textContent = 'Total weight: ' + (Math.round(totalWeight*10)/10) + '%';
}

function gpToggleGroup(groupId){
  gpExpandedGroups[groupId] = !gpExpandedGroups[groupId];
  gpRenderRows();
}
function gpSetComponentScore(componentId, value){
  var c = gpCourses[gpActiveKey];
  if(!c) return;
  var comp = c.components.filter(function(x){ return x.id === componentId; })[0];
  if(!comp) return;

  gpRawInputDraft[componentId] = value; // keep exactly what was typed, decimal point included
  var v = value.trim();
  comp.earned = v === '' ? null : Math.max(0, Math.min(comp.total, parseFloat(v) || 0));
  gpPersist();

  // gpRenderRows() rebuilds every row's HTML (drop-policy status can shift
  // on any keystroke), which destroys and recreates this very <input> —
  // normally kicking the cursor out after the very first digit. Capture
  // focus + caret position first and restore them once the new input for
  // this same component exists in the DOM.
  var active = document.activeElement;
  var inputId = 'gp-score-' + componentId;
  var hadFocus = active && active.id === inputId;
  var selStart = hadFocus ? active.selectionStart : null;
  var selEnd = hadFocus ? active.selectionEnd : null;

  gpRenderRows();
  gpCalculate();

  if(hadFocus){
    var el = document.getElementById(inputId);
    if(el){
      el.focus();
      try{ el.setSelectionRange(selStart, selEnd); }catch(e){}
    }
  }
}
function gpClearScoreDraft(componentId){
  delete gpRawInputDraft[componentId];
}

function gpPromptNewAssessment(){
  var name = prompt('Assessment title:', 'Homework / Quiz');
  if(!name) return;
  var weight = parseInt(prompt('Weight percentage (e.g. 10):', '10'), 10) || 10;
  gpCourses[gpActiveKey].components.push({ id:'custom_'+Date.now(), name:name, weight:weight, total:100, earned:null });
  gpPersist();
  gpRenderRows();
  gpCalculate();
  showToast('Added ' + name);
}

/* ---- credit-weighted real semester GPA across every added course
   (only courses with both a computed current letter grade and a known
   credit count are counted; the letter's flat .gpa value from that
   course's own grade scale is used — no fractional interpolation). ---- */
function gpRenderGpaCard(){
  var keys = Object.keys(gpCourses);
  var totalCredits = 0, totalPoints = 0, countedCourses = 0;
  keys.forEach(function(key){
    var course = gpCourses[key];
    if(!course || !course.currentLetter || !course.credits) return;
    var scale = gpGradesForCourse(course);
    var match = scale.filter(function(g){ return g[0] === course.currentLetter; })[0];
    var gpaVal = match ? match[2] : 0;
    totalCredits += course.credits;
    totalPoints += gpaVal * course.credits;
    countedCourses++;
  });

  var gpaEl = document.getElementById('gpGpaVal');
  var barEl = document.getElementById('gpGpaBar');
  var subEl = document.getElementById('gpGpaCourse');
  if(totalCredits > 0){
    var gpa = totalPoints / totalCredits;
    gpaEl.textContent = gpa.toFixed(2);
    barEl.style.width = Math.min(100, (gpa / 4.0) * 100) + '%';
    subEl.textContent = countedCourses + ' course' + (countedCourses===1?'':'s') + ' · ' + totalCredits + ' credit' + (totalCredits===1?'':'s');
  } else {
    gpaEl.textContent = '—';
    barEl.style.width = '0%';
    subEl.textContent = keys.length ? 'Enter scores to estimate' : '';
  }
}

function gpCalculate(){
  var c = gpCourses[gpActiveKey];
  if(!c) return;
  var scale = gpGradesForCourse(c);
  var targets = gpTargetGradesForCourse(c);
  if(!c.target || targets.indexOf(c.target) === -1) c.target = targets[0] || 'A';
  var targetPct = gpMinimumForTarget(scale, c.target);

  var dropped = gpDroppedIdsCurrently(c);
  var raw = gpRawScores(c);
  var pendingComponents = c.components.filter(function(comp){ return raw[comp.id] === undefined && !dropped[comp.id]; });
  var hasPending = pendingComponents.length > 0;
  var requiredPct = gpRequiredAcrossPending(c, targetPct);

  var safety = gpSafetyRange(c);
  var floor = (Math.round(Math.max(0, safety.minPct) * 10) / 10).toFixed(1);
  var ceiling = (Math.round(Math.min(100, safety.maxPct) * 10) / 10).toFixed(1);
  document.getElementById('gpFloorCeil').textContent = 'Current floor ' + floor + '% · ceiling ' + ceiling + '%.';

  var bigNum = document.getElementById('gpBigNum');
  var badge = document.getElementById('gpGoalBadge');
  if(!hasPending){
    var finalPct = gpComputeProjected(c);
    bigNum.textContent = '—';
    if(finalPct !== null && finalPct >= targetPct){
      badge.innerHTML = '<span class="gp-goal-tag ok">✓ Goal Secured</span>';
    } else if(finalPct !== null){
      badge.innerHTML = '<span class="gp-goal-tag over">⚠ Target Missed</span>';
    } else {
      badge.innerHTML = '';
    }
  } else if(requiredPct <= 0){
    bigNum.textContent = '0';
    badge.innerHTML = '<span class="gp-goal-tag ok">✓ Goal Secured</span>';
  } else if(requiredPct <= 100){
    bigNum.textContent = Math.round(requiredPct);
    badge.innerHTML = '<span class="gp-goal-tag ok">✓ Goal Achievable</span>';
  } else {
    bigNum.textContent = Math.round(requiredPct);
    badge.innerHTML = '<span class="gp-goal-tag over">⚠ Needs &gt;100%</span>';
  }

  document.getElementById('gpSharedLabel').textContent = c.target + ' target';
  document.getElementById('gpSharedRows').innerHTML = pendingComponents.length ? pendingComponents.map(function(comp){
    var pts = (isFinite(requiredPct) && requiredPct > 0) ? Math.round(Math.max(0, Math.min(100, requiredPct)) / 100 * comp.total) : 0;
    return '<div class="gp-shared-row"><div><div class="gp-shared-row-name">'+comp.name+'</div><div class="gp-shared-row-wt">'+(Math.round(comp.weight*10)/10)+'% of course grade</div></div>'
      + '<span class="gp-shared-row-val">'+pts+' / '+comp.total+' pts</span></div>';
  }).join('') : '<div class="gp-shared-row"><div class="gp-shared-row-name muted">All assessments graded</div></div>';

  var courseBadgeEl = document.getElementById('gpCourseGradeBadge');
  var projectedRow = document.getElementById('gpProjectedRow');
  var projectedBadgeEl = document.getElementById('gpProjectedBadge');
  var projectedPct = gpComputeProjected(c);
  if(projectedPct !== null){
    var g = gpGradeFor(projectedPct, scale);
    var badgeHtml = '<span class="letter">'+g[0]+'</span><span class="pct">'+projectedPct.toFixed(1)+'%</span>';
    courseBadgeEl.innerHTML = badgeHtml;
    courseBadgeEl.classList.remove('hidden');
    projectedBadgeEl.innerHTML = badgeHtml;
    projectedRow.classList.remove('hidden');
    c.currentLetter = g[0];
  } else {
    courseBadgeEl.classList.add('hidden');
    projectedRow.classList.add('hidden');
    c.currentLetter = null;
  }

  gpPersist();
  gpRenderPills();
  gpRenderGpaCard();
}

/* ---- admin-only dashboard: registered-student / major breakdown, real AI
   usage stats (see gpLogAiAttempt above) and student feedback -- there's no
   backend, so these all read the same shared localStorage stores every
   other admin page in this app already reads from. ---- */
function gpTimeAgo(ts){
  var diff = Math.max(0, Date.now() - ts);
  var mins = Math.floor(diff / 60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if(hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}
function gpEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

async function gpRenderAdminDashboard(){
  var accounts = await listAccounts();
  document.getElementById('gpStatStudents').textContent = accounts.length;

  var aiStats = gpLoadAiStats();
  document.getElementById('gpStatAiRequests').textContent = aiStats.total;
  var rate = aiStats.total ? Math.round((aiStats.success / aiStats.total) * 100) : 0;
  document.getElementById('gpStatAiRate').textContent = aiStats.total ? (rate + '%') : '—';

  var feedback = gpLoadFeedback();
  document.getElementById('gpStatFeedbackCount').textContent = feedback.length;
  var avg = feedback.length ? (feedback.reduce(function(s,f){ return s + f.rating; }, 0) / feedback.length) : 0;
  document.getElementById('gpStatFeedbackAvg').textContent = feedback.length ? (avg.toFixed(1) + ' / 5') : '—';

  var counts = {};
  accounts.forEach(function(a){
    var m = (a.major || 'Not set').trim() || 'Not set';
    counts[m] = (counts[m] || 0) + 1;
  });
  var majorRows = Object.keys(counts).map(function(m){ return {m:m, n:counts[m]}; }).sort(function(a,b){ return b.n - a.n; }).slice(0, 8);
  var maxN = majorRows.length ? majorRows[0].n : 1;
  document.getElementById('gpMajorBars').innerHTML = majorRows.length ? majorRows.map(function(row){
    var pct = Math.round((row.n / maxN) * 100);
    return '<div class="gp-major-row"><span class="gp-major-name">'+gpEsc(row.m)+'</span>'
      + '<div class="gp-major-bar-track"><div class="gp-major-bar-fill" style="width:'+pct+'%;"></div></div>'
      + '<span class="gp-major-count">'+row.n+'</span></div>';
  }).join('') : '<p class="muted">No students registered yet.</p>';

  document.getElementById('gpAiLog').innerHTML = aiStats.log.length ? aiStats.log.map(function(e){
    return '<div class="gp-log-row"><span class="gp-log-dot '+(e.success?'ok':'fail')+'"></span>'
      + '<span class="gp-log-label">'+gpEsc(e.label)+'</span>'
      + '<span class="gp-log-outcome">'+(e.success ? 'Parsed successfully' : 'Fell back to demo data')+'</span>'
      + '<span class="gp-log-time">'+gpTimeAgo(e.ts)+'</span></div>';
  }).join('') : '<p class="muted">No syllabus has been analyzed via the live AI yet.</p>';

  document.getElementById('gpFeedbackList').innerHTML = feedback.length ? feedback.slice(0, 12).map(function(f){
    var stars = '★★★★★☆☆☆☆☆'.slice(5 - f.rating, 10 - f.rating);
    return '<div class="gp-fb-row"><div class="gp-fb-top"><span class="gp-fb-stars">'+stars+'</span><span class="gp-fb-name">'+gpEsc(f.name)+'</span><span class="gp-fb-time">'+gpTimeAgo(f.ts)+'</span></div>'
      + (f.comment ? '<p class="gp-fb-comment">'+gpEsc(f.comment)+'</p>' : '') + '</div>';
  }).join('') : '<p class="muted">No feedback submitted yet.</p>';
}

/* ---- student-only: a lightweight "rate GradePilot" widget (stars +
   optional comment) feeding the admin feedback list above. ---- */
function gpSetFeedbackStars(n){
  gpFeedbackStars = n;
  document.querySelectorAll('#gpFeedbackStars .gp-star').forEach(function(el){
    el.classList.toggle('on', Number(el.getAttribute('data-star')) <= n);
  });
}
function gpSubmitFeedbackForm(){
  if(!gpFeedbackStars){ showToast('Pick a star rating first.'); return; }
  gpSubmitFeedback(gpFeedbackStars, document.getElementById('gpFeedbackComment').value);
  document.getElementById('gpFeedbackComment').value = '';
  gpSetFeedbackStars(0);
}

/* Called from index.html's own inline script, AFTER it sets both SESSION
   (via requireSession()) and isAdmin -- this file loads before that inline
   script runs, so it can't safely read either one at its own top level. */
function gpInit(){
  if(isAdmin){
    var statsKeys = (typeof cpSyncPull === 'function') ? cpSyncPull([GP_AISTATS_KEY, GP_FEEDBACK_KEY]) : Promise.resolve();
    statsKeys.then(function(){ gpRenderAdminDashboard(); });
  } else {
    var rk = gpRemoteWorkspaceKey();
    var pull = (rk && typeof cpSyncPull === 'function') ? cpSyncPull([[GP_STORAGE_KEY, rk]]) : Promise.resolve();
    pull.then(function(){
      if(gpLoadPersisted()){
        gpShowDashboard();
        gpRenderCourse();
      } else {
        gpShowUpload();
      }
      gpRenderPills();
    });
  }
}
