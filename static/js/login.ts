// Login form handler
// Submits credentials to POST /api/auth/login, redirects to / on success.

document.addEventListener('DOMContentLoaded', () => {
  // Casts instead of byId: importing utils.ts would add it and state.ts to the login bundle.
  const form = document.getElementById('login-form') as HTMLFormElement;
  const emailInput = document.getElementById('login-email') as HTMLInputElement;
  const passwordInput = document.getElementById('login-password') as HTMLInputElement;
  const errorDisplay = document.getElementById('login-error') as HTMLElement;
  const submitBtn = document.getElementById('login-btn') as HTMLButtonElement;

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

  function showError(message: string) {
    errorDisplay.textContent = message;
    errorDisplay.classList.remove('hidden');
  }
});
