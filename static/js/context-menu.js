let menuEl = null;
let currentCleanup = null;

function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.className = 'card-context-menu hidden';
  document.body.appendChild(menuEl);
  return menuEl;
}

export function showCardContextMenu(x, y, items) {
  const menu = ensureMenu();
  menu.innerHTML = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'card-context-menu-item';
    btn.textContent = item.label;
    if (item.disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => { hideCardContextMenu(); item.action(); });
    }
    menu.appendChild(btn);
  }

  // Reveal off-screen to measure, then position with edge detection
  menu.classList.remove('hidden');
  menu.style.left = '0px';
  menu.style.top = '0px';
  const { offsetWidth: w, offsetHeight: h } = menu;
  menu.style.left = `${x + w > window.innerWidth  ? x - w : x}px`;
  menu.style.top  = `${y + h > window.innerHeight ? y - h : y}px`;

  if (currentCleanup) currentCleanup();
  const onOut    = (e) => { if (!menu.contains(e.target)) hideCardContextMenu(); };
  const onScroll = () => hideCardContextMenu();
  const onKey    = (e) => { if (e.key === 'Escape') hideCardContextMenu(); };
  document.addEventListener('click',   onOut,    true);
  document.addEventListener('scroll',  onScroll, true);
  document.addEventListener('keydown', onKey);
  currentCleanup = () => {
    document.removeEventListener('click',   onOut,    true);
    document.removeEventListener('scroll',  onScroll, true);
    document.removeEventListener('keydown', onKey);
    currentCleanup = null;
  };
}

export function hideCardContextMenu() {
  if (!menuEl) return;
  menuEl.classList.add('hidden');
  if (currentCleanup) currentCleanup();
}
