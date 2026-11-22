/* Campuspilot — login page logic.
   Students self-register (UNID + password + name + major/year) into a
   localStorage accounts store (createAccount / findAccount, defined in
   shared/session.js) and then sign in against that record — there is no
   shared demo password anymore, and no seeded account: every student has
   to sign up once before they can sign in. The admin side is unchanged:
   a single fixed departmental passcode, no accounts, no sign-up. */

var ADMIN_PASSCODE = '000000';
var studentMode = 'login'; // 'login' | 'signup'

/* UAC_DEPARTMENTS and fillDeptSelect now live in shared/session.js (loaded
   before this file) so My Profile's "Edit Major" flow can reuse the exact
   same department list instead of keeping a second copy here. */

function toggleMinorFields(){
  var box = document.getElementById('signup-minor-fields');
  var row = document.getElementById('signup-minor-toggle-row');
  var opening = box.classList.contains('hidden');
  box.classList.toggle('hidden', !opening);
  row.classList.toggle('hidden', opening);
  if(opening){
    document.getElementById('signup-minor-select').value = '';
    document.getElementById('signup-minor-other-wrap').classList.add('hidden');
    document.getElementById('signup-minor-other').value = '';
  }
}

function refreshMinorOtherVisibility(){
  var sel = document.getElementById('signup-minor-select');
  document.getElementById('signup-minor-other-wrap').classList.toggle('hidden', !sel || sel.value !== '__other__');
}

function wireMajorSelects(){
  fillDeptSelect(document.getElementById('signup-major-select'), 'Select your major…');
  fillDeptSelect(document.getElementById('signup-minor-select'), 'Select a department…');
  document.getElementById('signup-major-select').addEventListener('change', function(){
    document.getElementById('signup-major-other-wrap').classList.toggle('hidden', this.value !== '__other__');
  });
  document.getElementById('signup-minor-select').addEventListener('change', refreshMinorOtherVisibility);
}

/* Resolves the primary-major select (+ its "Other" fallback input) into the
   plain string that gets stored as account.major. */
function resolveMajorValue(){
  var sel = document.getElementById('signup-major-select').value;
  if(sel === '__other__') return (document.getElementById('signup-major-other').value || '').trim();
  return sel;
}

/* Resolves the optional double-major/minor block into the formatted label
   stored as account.major2 ("Double Major: X" / "Minor: Y"), or '' if the
   student never opened that section or left it blank. */
function resolveMajor2Value(){
  var box = document.getElementById('signup-minor-fields');
  if(box.classList.contains('hidden')) return '';
  var typeEl = document.querySelector('input[name="signup-minor-type"]:checked');
  var type = typeEl ? typeEl.value : 'double';
  var sel = document.getElementById('signup-minor-select').value;
  var dept = (sel === '__other__') ? (document.getElementById('signup-minor-other').value || '').trim() : sel;
  if(!dept) return '';
  return (type === 'minor' ? 'Minor: ' : 'Double Major: ') + dept;
}

function toggleSignupMode(){
  studentMode = (studentMode === 'login') ? 'signup' : 'login';
  renderStudentMode();
}

function renderStudentMode(){
  var isSignup = studentMode === 'signup';
  document.getElementById('loginFields').classList.toggle('hidden', isSignup);
  document.getElementById('signupFields').classList.toggle('hidden', !isSignup);
  document.getElementById('studentPanelTitle').textContent = isSignup ? 'Create Student Account' : 'Student Login';
  document.getElementById('studentPanelDesc').textContent = isSignup
    ? 'Register with your University ID to create your Campuspilot account — then sign in with it below.'
    : 'Sign in with your University ID (UNID) to view departmental campus events, RSVP for workshops, and configure personal schedule sync.';
  document.getElementById('studentActionLabel').textContent = isSignup ? 'Create Account' : 'Sign In with UNID';
  document.getElementById('studentActionBtn').onclick = isSignup ? trySignUp : tryStudentLogin;
  document.getElementById('forgotPwBtn').classList.toggle('hidden', isSignup);
  document.getElementById('studentModeToggle').textContent = isSignup ? 'Already have an account? Sign In' : "Don't have an account? Sign Up";
}

/* UNID must be "u" followed by exactly 7 digits (e.g. u1621896) -- same
   pattern the server enforces (shared/session.js's isValidUnid /
   api/accounts/*), checked here too just so a badly-formatted UNID gets
   an immediate, specific message instead of waiting on a round trip. */
function unidFormatError(unid){
  return (typeof isValidUnid === 'function' && !isValidUnid(unid))
    ? 'UNID must be "u" followed by 7 digits, e.g. u1621896.'
    : null;
}

async function tryStudentLogin(){
  var unid = (document.getElementById('login-unid').value || '').trim();
  var pw = (document.getElementById('login-pw').value || '').trim();

  if(!unid || !pw){
    showToast('Enter your UNID and password.');
    return;
  }
  var fmtErr = unidFormatError(unid);
  if(fmtErr){ showToast(fmtErr); return; }

  var btn = document.getElementById('studentActionBtn');
  if(btn) btn.disabled = true;
  var result = await loginAccount(unid, pw);
  if(btn) btn.disabled = false;

  if(!result || !result.ok){
    showToast((result && result.error) || 'Incorrect UNID or password.');
    return;
  }
  setSession('student', result.account);
  window.location.href = '../home/index.html';
}

async function trySignUp(){
  var unid = document.getElementById('signup-unid').value;
  var name = document.getElementById('signup-name').value;
  var major = resolveMajorValue();
  var major2 = resolveMajor2Value();
  var pw = document.getElementById('signup-pw').value;
  var pw2 = document.getElementById('signup-pw2').value;

  if(!unid.trim() || !name.trim() || !pw){
    showToast('Fill in your UNID, name, and password.');
    return;
  }
  var fmtErr = unidFormatError(unid);
  if(fmtErr){ showToast(fmtErr); return; }
  if(!major){
    showToast('Select your major (or choose "Other" and type it in).');
    return;
  }
  if(pw.length < 6){
    showToast('Password must be at least 6 characters.');
    return;
  }
  if(pw !== pw2){
    showToast('Passwords do not match.');
    return;
  }

  var btn = document.getElementById('studentActionBtn');
  if(btn) btn.disabled = true;
  var result = await createAccount(unid, pw, name, major, major2);
  if(btn) btn.disabled = false;

  if(!result || !result.ok){
    showToast((result && result.error) || 'Could not create account. Please try again.');
    return;
  }

  showToast(result.wasReset
    ? 'Password reset — sign in with your UNID and new password.'
    : 'Account created — sign in with your new UNID and password.');
  document.getElementById('login-unid').value = result.account.unid;
  document.getElementById('login-pw').value = '';
  document.getElementById('signup-unid').value = '';
  document.getElementById('signup-name').value = '';
  document.getElementById('signup-major-select').value = '';
  document.getElementById('signup-major-other-wrap').classList.add('hidden');
  document.getElementById('signup-major-other').value = '';
  document.getElementById('signup-minor-fields').classList.add('hidden');
  document.getElementById('signup-minor-toggle-row').classList.remove('hidden');
  document.getElementById('signup-minor-select').value = '';
  document.getElementById('signup-minor-other-wrap').classList.add('hidden');
  document.getElementById('signup-minor-other').value = '';
  document.getElementById('signup-pw').value = '';
  document.getElementById('signup-pw2').value = '';
  studentMode = 'login';
  renderStudentMode();
}

function getOtpValue(){
  var out = '';
  for(var i = 0; i < 6; i++){
    var box = document.getElementById('otp-' + i);
    out += (box && box.value) ? box.value : '';
  }
  return out;
}

function clearOtp(){
  for(var i = 0; i < 6; i++){
    var box = document.getElementById('otp-' + i);
    if(box) box.value = '';
  }
  var first = document.getElementById('otp-0');
  if(first) first.focus();
}

function tryAdminLogin(){
  var code = getOtpValue();
  if(code.length < 6){
    showToast('Enter the full 6-digit departmental passcode.');
    return;
  }
  if(code !== ADMIN_PASSCODE){
    showToast('Incorrect departmental passcode.');
    clearOtp();
    return;
  }
  setSession('admin');
  window.location.href = '../home/index.html';
}

function wireOtpBoxes(){
  for(var i = 0; i < 6; i++){
    (function(idx){
      var box = document.getElementById('otp-' + idx);
      if(!box) return;
      box.addEventListener('input', function(){
        box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
        if(box.value && idx < 5){
          var next = document.getElementById('otp-' + (idx + 1));
          if(next) next.focus();
        }
      });
      box.addEventListener('keydown', function(e){
        if(e.key === 'Backspace' && !box.value && idx > 0){
          var prev = document.getElementById('otp-' + (idx - 1));
          if(prev){ prev.focus(); }
        }else if(e.key === 'Enter'){
          tryAdminLogin();
        }
      });
    })(i);
  }
}

/* ---------------- Forgot Password modal ----------------
   Used to ask for a UNID/email and fake-send a reset link -- there was
   never a real email service behind it, so nothing was ever actually
   sent. Campuspilot has no email/SMS channel at all, so instead of
   pretending to send something, this now says so plainly and points at
   the one real way to regain access: signing up again with the same
   UNID. createAccount()/api/accounts/signup now treats a signup for an
   already-registered UNID as a password reset (it overwrites that
   account's password/name/major rather than rejecting it or creating a
   second account) -- so this never piles up duplicate accounts, and the
   student roster an admin sees never grows just because someone forgot
   their password. */
function openForgotPwModal(){
  document.getElementById('forgotPwModal').classList.remove('hidden');
}
function closeForgotPwModal(){
  document.getElementById('forgotPwModal').classList.add('hidden');
}
function goToSignupFromForgotPw(){
  closeForgotPwModal();
  if(studentMode !== 'signup') toggleSignupMode();
  var unidEl = document.getElementById('signup-unid');
  if(unidEl) unidEl.focus();
}

/* ---------------- Request Department Key modal ----------------
   Same issue as above -- used to confirm a review with zero input. Now
   collects name, department, and a short reason before confirming. */
function openDeptKeyModal(){
  document.getElementById('deptKeyName').value = '';
  document.getElementById('deptKeyDept').value = '';
  document.getElementById('deptKeyReason').value = '';
  document.getElementById('deptKeyModal').classList.remove('hidden');
  document.getElementById('deptKeyName').focus();
}
function closeDeptKeyModal(){
  document.getElementById('deptKeyModal').classList.add('hidden');
}
function submitDeptKeyRequest(){
  var name = (document.getElementById('deptKeyName').value || '').trim();
  var dept = (document.getElementById('deptKeyDept').value || '').trim();
  var reason = (document.getElementById('deptKeyReason').value || '').trim();
  if(!name || !dept || !reason){
    showToast('Fill in your name, department, and reason for access.');
    return;
  }
  closeDeptKeyModal();
  showToast('Department key requests are reviewed by UAC IT within 1 business day');
}

document.addEventListener('DOMContentLoaded', function(){
  wireOtpBoxes();
  wireMajorSelects();
});
