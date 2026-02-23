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
        // fallback
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
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const el = $(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.pushState(null, '', id);
    });
  });
})();
