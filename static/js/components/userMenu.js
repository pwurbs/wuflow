import { logout, updateCurrentUser } from '../api.js';
import { showNotification, getUserInitials } from '../utils.js';
import { validatePasswordPolicy } from './setup.js';

export function setupUserMenu(user) {
  const userMenuBtn = document.getElementById('user-menu-btn');
  const userMenuDropdown = document.getElementById('user-menu-dropdown');
  const userEmailSpan = document.getElementById('current-user-email');
  const logoutBtn = document.getElementById('user-menu-logout');
  const passwordBtn = document.getElementById('user-menu-password');

  if (userEmailSpan) {
    const initials = getUserInitials(user);
    // Create badge element
    const badge = document.createElement('div');
    badge.className = 'user-badge header';
    badge.textContent = initials;

    // Clear previous content and append badge + email
    userEmailSpan.innerHTML = '';
    userEmailSpan.style.display = 'flex';
    userEmailSpan.style.alignItems = 'center';
    userEmailSpan.style.gap = '8px';
    userEmailSpan.appendChild(badge);
    userEmailSpan.appendChild(document.createTextNode(`${user.email} (${user.role})`));
  }

  if (userMenuBtn && userMenuDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenuDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!userMenuBtn.contains(e.target) && !userMenuDropdown.contains(e.target)) {
        userMenuDropdown.classList.add('hidden');
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      logout();
    });
  }

  if (passwordBtn) {
    passwordBtn.addEventListener('click', () => {
      userMenuDropdown.classList.add('hidden');
      openPasswordModal();
    });
  }

  setupPasswordModal(user);
}

function setupPasswordModal(user) {
  const modal = document.getElementById('password-modal');
  const form = document.getElementById('password-form');
  const cancelBtn = document.getElementById('password-cancel-btn');

  if (!modal || !form || !cancelBtn) return;

  cancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    form.reset();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('new-password').value;

    try {
      // Use shared validation logic
      const pwError = validatePasswordPolicy(newPassword, user ? user.email : '');
      if (pwError) {
        throw new Error(pwError);
      }

      await updateCurrentUser({ password: newPassword });
      showNotification('Password updated successfully. Logging out...');
      modal.classList.add('hidden');
      form.reset();

      // Force logout after password change
      setTimeout(() => {
        logout();
      }, 1500);
    } catch (err) {
      const errorDisplay = document.getElementById('password-modal-error');
      if (errorDisplay) {
        errorDisplay.textContent = err.message;
        errorDisplay.classList.remove('hidden');
      } else {
        showNotification(err.message, 'error');
      }
    }
  });
}

function openPasswordModal() {
  const modal = document.getElementById('password-modal');
  const errorDisplay = document.getElementById('password-modal-error');

  if (modal) {
    // Clear previous errors
    if (errorDisplay) {
      errorDisplay.textContent = '';
      errorDisplay.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    document.getElementById('new-password').focus();
  }
}
