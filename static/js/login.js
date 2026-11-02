// Login form handler
// Submits credentials to POST /api/auth/login, redirects to / on success.

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  // Casts instead of byId: importing utils.js would add it and state.js to the login bundle.
  const emailInput = /** @type {HTMLInputElement} */ (document.getElementById('login-email'));
  const passwordInput = /** @type {HTMLInputElement} */ (document.getElementById('login-password'));
  const errorDisplay = document.getElementById('login-error');
  const submitBtn = /** @type {HTMLButtonElement} */ (document.getElementById('login-btn'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous errors
    errorDisplay.textContent = '';
    errorDisplay.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passwordInput.value,
        }),
      });

      if (response.ok) {
        // Login successful — redirect to main app
        globalThis.location.href = '/';
        return;
      }

      // Handle error responses
      const errorText = await response.text();
      showError(errorText || 'Login failed. Please try again.');
    } catch {
      showError('Unable to connect to the server. Please try again later.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });

  function showError(message) {
    errorDisplay.textContent = message;
    errorDisplay.classList.remove('hidden');
  }
});
