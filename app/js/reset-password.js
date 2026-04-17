import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.98.0/+esm';

const SUPABASE_URL = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_URL) || 'https://gtuytjhvjdpwtubaxnrg.supabase.co';
const SUPABASE_ANON_KEY = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_ANON_KEY) || 'sb_publishable_ERd3MFPLUPWIoNXhC64uJQ_fHGx2Jv0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.getElementById('resetForm');
const newPassword = document.getElementById('newPassword');
const confirmPassword = document.getElementById('confirmPassword');
const msg = document.getElementById('resetMessage');

const setMessage = (text, isError) => {
  msg.textContent = text;
  msg.style.display = 'block';
  msg.style.color = isError ? '#ff6b6b' : '#7CFC90';
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.style.display = 'none';
  msg.textContent = '';

  const p1 = (newPassword.value || '').trim();
  const p2 = (confirmPassword.value || '').trim();

  if (!p1 || !p2) {
    setMessage('Please enter and confirm your new password.', true);
    return;
  }
  if (p1 !== p2) {
    setMessage('Passwords do not match.', true);
    return;
  }

  const { error } = await supabase.auth.updateUser({ password: p1 });
  if (error) {
    setMessage(error.message || 'Failed to update password.', true);
    return;
  }

  setMessage('Password updated. You can now sign in.', false);
  form.reset();
});
