(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // Copy buttons
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.getAttribute('data-copy');
      const el = target ? $(target) : null;
      const text = el ? el.innerText.trim() : '';
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const old = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = old), 900);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        const old = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = old), 900);
      }
    });
  });

  // Smooth scroll for in-page links
  const onNavClick = a => e => {
    const id = a.getAttribute('href');
    if (!id || id === '#') return;
    const el = $(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.pushState(null, '', id);

    // close mobile nav if open
    closeMobileNav();
  };

  document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', onNavClick(a)));

  // Mobile nav
  const toggle = $('.navToggle');
  const mobile = $('#mobileNav');
  const closeBtn = $('.mobileNav__close');

  const openMobileNav = () => {
    if (!mobile || !toggle) return;
    mobile.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.documentElement.style.overflow = 'hidden';
  };

  const closeMobileNav = () => {
    if (!mobile || !toggle) return;
    mobile.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
  };

  if (toggle && mobile) {
    toggle.addEventListener('click', () => {
      if (mobile.hidden) openMobileNav();
      else closeMobileNav();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeMobileNav);
  if (mobile) {
    mobile.addEventListener('click', e => {
      if (e.target === mobile) closeMobileNav();
    });
  }
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMobileNav();
  });
})();
