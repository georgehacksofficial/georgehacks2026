import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.98.0/+esm';

const SUPABASE_URL = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_URL) || 'https://gtuytjhvjdpwtubaxnrg.supabase.co';
const SUPABASE_ANON_KEY = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_ANON_KEY) || 'sb_publishable_ERd3MFPLUPWIoNXhC64uJQ_fHGx2Jv0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.getElementById('signinForm');
const email = document.getElementById('email');
const password = document.getElementById('password');
const err = document.getElementById('signinError');
const success = document.getElementById('signinSuccess');
const signoutBtn = document.getElementById('signoutBtn');
const otpSection = document.getElementById('otpSection');
const otpCode = document.getElementById('otpCode');
const otpVerifyBtn = document.getElementById('otpVerifyBtn');
const otpMessage = document.getElementById('otpMessage');
const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
// Magic link (OTP) UI elements - disabled for now
// const otpRequestForm = document.getElementById('otpRequestForm');
// const otpEmail = document.getElementById('otpEmail');
// const otpMessage = document.getElementById('otpMessage');

// Enable magic link flow only when the OTP form exists on the page
// const OTP_ENABLED = !!(otpRequestForm && otpEmail && otpMessage);
const missingElements = !form || !email || !password || !err || !success || !signoutBtn;

if (missingElements) {
  // Exit if required elements are missing (e.g., script loaded on a different page)
  // eslint-disable-next-line no-console
  console.warn('signin.js: required elements not found, skipping init.');
} else {

const stripAuthParams = () => {
  const url = new URL(window.location.href);
  if (url.searchParams.has('email') || url.searchParams.has('password')) {
    url.searchParams.delete('email');
    url.searchParams.delete('password');
    window.history.replaceState({}, document.title, url.toString());
  }
};

const prefillEmailFromQuery = () => {
  const url = new URL(window.location.href);
  const qEmail = url.searchParams.get('email');
  if (qEmail) {
    email.value = qEmail;
  }
  stripAuthParams();
};

const showReasonFromQuery = () => {
  const url = new URL(window.location.href);
  const reason = url.searchParams.get('reason');
  if (reason === 'admin') {
    setMessage('Admin access required. Please sign in with an admin account.', true);
  }
  if (reason === 'judge') {
    setMessage('Invalid judge account. Please sign in with a judge account.', true);
  }
};

const ENABLE_ADMIN_CHECK = true;

const ensureAdmin = async () => {
  if (!ENABLE_ADMIN_CHECK) {
    return { ok: true };
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return { ok: false, message: 'Unable to verify user.' };
  }

  const { data: adminRow, error: adminError } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (adminError) {
    return { ok: false, message: 'Admin check failed.' };
  }

  if (!adminRow) {
    return { ok: false, message: 'This account is not an admin.' };
  }

  return { ok: true };
};

const ensureJudge = async () => {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return { ok: false, message: 'Unable to verify user.' };
  }

  const { data: judgeRow, error: judgeError } = await supabase
    .from('judges')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (judgeError) {
    return { ok: false, message: 'Judge check failed.' };
  }

  if (!judgeRow) {
    return { ok: false, message: 'Invalid judge account.' };
  }

  return { ok: true };
};

// Keep for now (used when explicitly signing out)
const setSignedIn = (isSignedIn) => {
  if (isSignedIn) {
    form.style.display = 'none';
    success.style.display = 'block';
  } else {
    form.style.display = 'block';
    success.style.display = 'none';
  }
};

  const setMessage = (text, isError) => {
    err.textContent = text;
    err.style.display = 'block';
    err.style.color = isError ? '#ff6b6b' : '#7CFC90';
  };

const setOtpMessage = (text, isError) => {
  if (!otpMessage) return;
  otpMessage.textContent = text;
  otpMessage.style.display = 'block';
  otpMessage.style.color = isError ? '#ff6b6b' : '#7CFC90';
};

const showOtpSection = (show) => {
  if (!otpSection) return;
  otpSection.style.display = show ? 'block' : 'none';
};

const setFormEnabled = (enabled) => {
  email.disabled = !enabled;
  password.disabled = !enabled;
};

// Redirect admins to the admin hub after successful auth
const goToAdmin = () => {
  window.location.href = `${window.location.origin}/pages/admin.html`;
};

const goToJudge = () => {
  window.location.href = `${window.location.origin}/pages/judge.html`;
};
// Show status/errors for magic link requests
// const setOtpMessage = (text, isError) => {
//   otpMessage.textContent = text;
//   otpMessage.style.display = 'block';
//   otpMessage.style.color = isError ? '#ff6b6b' : '#7CFC90';
// };

const initSession = async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    setSignedIn(false);
    return;
  }

  // Always show the login form and clear any existing session
  await supabase.auth.signOut();
  setSignedIn(false);
  return;

  // Success UI disabled on signin page
};

supabase.auth.onAuthStateChange((event, session) => {
  if (!session) {
    setSignedIn(false);
    return;
  }
  ensureAdmin().then((adminCheck) => {
    if (!adminCheck.ok) {
      setSignedIn(false);
      setMessage(adminCheck.message || 'Admin access required.', true);
      return;
    }
    // Success UI disabled on signin page
  });
});

signoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  setSignedIn(false);
});

if (forgotPasswordBtn) {
  forgotPasswordBtn.addEventListener('click', async () => {
    err.style.display = 'none';
    err.textContent = '';

    const eVal = (email.value || '').trim();
    if (!eVal) {
      setMessage('Enter your email to reset password.', true);
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(eVal, {
      redirectTo: `${window.location.origin}/pages/reset-password.html`,
    });

    if (error) {
      setMessage(error.message || 'Failed to send reset email.', true);
      return;
    }

    setMessage('Password reset email sent. Check your inbox.', false);
  });
}

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  err.style.display = 'none';
  err.textContent = '';
  if (otpMessage) {
    otpMessage.style.display = 'none';
    otpMessage.textContent = '';
  }

  const eVal = (email.value || '').trim();
  const pVal = (password.value || '').trim();

  if (!eVal || !pVal) {
    setMessage('Please enter your email and password.', true);
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: eVal,
    password: pVal,
  });

  if (error) {
    setMessage(error.message || 'Sign-in failed.', true);
    return;
  }

  const session = data?.session || (await supabase.auth.getSession()).data.session;
  if (!session) {
    setMessage('Unable to start session.', true);
    return;
  }

  // Admins must complete OTP before continuing.
  const adminCheck = await ensureAdmin();
  if (adminCheck.ok) {
    setFormEnabled(false);
    showOtpSection(true);

    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({}),
    });

    if (!sendRes.ok) {
      setFormEnabled(true);
      showOtpSection(false);
      const text = await sendRes.text();
      setMessage(`Failed to send OTP: ${text}`, true);
      return;
    }

    setOtpMessage('OTP sent to your email. Enter the code to continue.', false);
    return;
  }

  // Judges can proceed with password-only login for demo.
  const judgeCheck = await ensureJudge();
  if (judgeCheck.ok) {
    form.reset();
    goToJudge();
    return;
  }

  await supabase.auth.signOut();
  setMessage(judgeCheck.message || 'Invalid judge account.', true);
  setFormEnabled(true);
  showOtpSection(false);
});

if (otpVerifyBtn && otpCode) {
  otpVerifyBtn.addEventListener('click', async () => {
    if (otpMessage) {
      otpMessage.style.display = 'none';
      otpMessage.textContent = '';
    }

    const code = (otpCode.value || '').trim();
    if (!code) {
      setOtpMessage('Enter the OTP code.', true);
      return;
    }

    const session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      setMessage('Session expired. Please sign in again.', true);
      showOtpSection(false);
      setFormEnabled(true);
      return;
    }

    const verifyRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-email-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ otp: code }),
    });

    if (!verifyRes.ok) {
      const text = await verifyRes.text();
      setOtpMessage(`Invalid OTP: ${text}`, true);
      return;
    }

    const adminCheck = await ensureAdmin();
    if (adminCheck.ok) {
      form.reset();
      goToAdmin();
      return;
    }
    await supabase.auth.signOut();
    setMessage('Admin access required.', true);
    showOtpSection(false);
    setFormEnabled(true);
  });
}

// Magic link login: send a one-time sign-in email via Supabase (disabled)
// if (OTP_ENABLED) {
//   otpRequestForm.addEventListener('submit', async function (e) {
//     e.preventDefault();
//     otpMessage.style.display = 'none';
//     otpMessage.textContent = '';
//
//     const eVal = (otpEmail.value || '').trim();
//     if (!eVal) {
//       setOtpMessage('Please enter your email.', true);
//       return;
//     }
//
//     const { error } = await supabase.auth.signInWithOtp({
//       email: eVal,
//       options: {
//         emailRedirectTo: `${window.location.origin}/index.html`,
//       },
//     });
//
//     if (error) {
//       setOtpMessage(error.message || 'Failed to send magic link.', true);
//       return;
//     }
//
//     setOtpMessage('Magic link sent. Check your email.', false);
//     otpRequestForm.reset();
//   });
// }

  initSession();
  prefillEmailFromQuery();
  showReasonFromQuery();
}
