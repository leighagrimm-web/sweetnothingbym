/* Shared header and footer for the public pages. */
(function () {
  const page = document.body.dataset.page || '';
  const links = [
    ['order', 'order.html', 'Order'],
    ['about', 'about.html', 'About'],
    ['events', 'events.html', 'Special Events'],
    ['gallery', 'gallery.html', 'Gallery'],
    ['faq', 'faq.html', 'FAQ'],
    ['contact', 'contact.html', 'Contact']
  ];
  const onOrder = page === 'order';
  // Pages Melissa can hide from the menu (Settings: showAbout, showEvents, showGallery, showFaq).
  const SHOW_KEY = { about: 'showAbout', events: 'showEvents', gallery: 'showGallery', faq: 'showFaq' };
  const shown = (cfg, key) => !SHOW_KEY[key] || cfg[SHOW_KEY[key]] !== false;

  // Drawn right away from saved/default settings so the page doesn't flash, then redrawn once if the Sheet's settings differ.
  let drawn = '';
  function render() {
    const cfg = SN.load();
    const preview = SN.isPreview();
    const testing = cfg.maintenanceMode === true && !!SN.bypassKey();   // maintenance is on, and this browser has the password
    const sig = JSON.stringify([preview, testing, cfg.instagram, cfg.instagramHandle, cfg.pickupCity, Object.keys(SHOW_KEY).map((k) => shown(cfg, k))]);
    if (sig === drawn) return;
    drawn = sig;
    const count = SN.getBag().reduce((a, it) => a + it.qty, 0);
    const header = document.getElementById('site-header');
    if (header) {
      header.innerHTML =
        (preview
          ? '<div class="preview-banner" role="status"><span><strong>Preview mode:</strong> you’re seeing your unsaved changes. Customers can’t see this yet.</span><button type="button" id="exit-preview">Exit preview</button></div>'
          : testing ? '<div class="preview-banner" role="status"><span><strong>Maintenance mode is on.</strong> Visitors see the “back soon” page; you’re in with the password.</span><button type="button" id="lock-again">Lock this browser</button></div>'
          : SN_ENV.name === 'uat' ? '<div class="proto-banner">Test site: orders and messages here are for testing only.</div>' : '') +
        '<header class="site-header"><div class="wrap">' +
          '<a class="brand" href="index.html"><img src="logo.png" alt="Sweet Nothings by M"><span>Sweet Nothings <em>by M</em></span></a>' +
          '<div class="header-right">' +
            '<nav class="main-nav" aria-label="Main">' +
              links.filter(([key]) => shown(cfg, key)).map(([key, href, label]) => '<a href="' + href + '"' + (key === page ? ' aria-current="page"' : '') + '>' + label + '</a>').join('') +
            '</nav>' +
            '<a class="icon-btn" href="' + SN.esc(cfg.instagram) + '" target="_blank" rel="noopener" aria-label="Instagram ' + SN.esc(cfg.instagramHandle) + '">' + SN_ICONS.insta + '</a>' +
            (onOrder
              ? '<button type="button" class="bag-btn" id="bag-btn" aria-label="Open bag">' + SN_ICONS.bag + ' Bag <span class="bag-count" id="bag-count">' + count + '</span></button>'
              : '<a class="bag-btn" href="order.html?bag=1" aria-label="Open bag">' + SN_ICONS.bag + ' Bag <span class="bag-count">' + count + '</span></a>') +
          '</div>' +
        '</div></header>';
    }

    const exitBtn = document.getElementById('exit-preview');
    if (exitBtn) exitBtn.addEventListener('click', () => { SN.exitPreview(); location.href = location.pathname; });
    const lockBtn = document.getElementById('lock-again');
    if (lockBtn) lockBtn.addEventListener('click', () => { SN.setBypassKey(''); location.reload(); });

    const footer = document.getElementById('site-footer');
    if (footer) {
      footer.innerHTML =
        '<footer class="site-footer"><div class="wrap">' +
          '<span>© Sweet Nothings by M · Pickup in ' + SN.esc(cfg.pickupCity) + '</span>' +
          '<nav aria-label="Footer">' +
            '<a href="' + SN.esc(cfg.instagram) + '" target="_blank" rel="noopener">Instagram ' + SN.esc(cfg.instagramHandle) + '</a>' +
            (shown(cfg, 'faq') ? '<a href="faq.html">FAQ</a>' : '') +
            '<a href="contact.html">Contact</a>' +
            '<a href="admin.html">Owner admin</a>' +
          '</nav>' +
        '</div></footer>';
    }
  }
  // Maintenance mode: visitors get the "back soon" page instead of the site (preview mode and people with the
  // password still see everything). This browser remembers it was on, so a returning visitor doesn't glimpse the
  // site while settings load. It's a curtain, not a lock: the server is what turns away orders and messages.
  const closed = (cfg) => cfg.maintenanceMode === true && !SN.isPreview() && !SN.bypassKey();
  try { if (localStorage.getItem('sn_maint') === '1' && !SN.bypassKey()) document.documentElement.classList.add('sn-maint-wait'); } catch (e) { /* ignore */ }
  function showMaintenance(cfg) {
    const box = document.createElement('div');
    box.id = 'maint';
    box.className = 'maint';
    box.innerHTML =
      '<main class="maint-card">' +
        '<img class="maint-logo" src="logo.png" alt="Sweet Nothings by M">' +
        '<p class="eyebrow">Back soon</p>' +
        '<h1>' + SN.esc(cfg.maintenanceTitle || SN_DEFAULTS.maintenanceTitle) + '</h1>' +
        SN.paras(cfg.maintenanceMessage || SN_DEFAULTS.maintenanceMessage, ' class="lead"') +
        (cfg.instagram ? '<a class="btn" href="' + SN.esc(cfg.instagram) + '" target="_blank" rel="noopener">' + SN_ICONS.insta + ' Follow along on Instagram</a>' : '') +
        '<details class="maint-pw"><summary>Have a password?</summary>' +
          '<form id="maint-form" novalidate><label class="sr-only" for="maint-pass">Password</label>' +
            '<div class="row-gap" style="gap:8px;justify-content:center"><input class="input" id="maint-pass" type="password" autocomplete="current-password" placeholder="Password">' +
            '<button type="submit" class="btn ghost">Enter</button></div>' +
            '<p class="err" id="maint-err" role="alert" hidden></p></form></details>' +
      '</main>';
    document.body.appendChild(box);
    document.title = (cfg.maintenanceTitle || 'Back soon') + ' · Sweet Nothings by M';
    document.documentElement.classList.add('sn-maint');
    document.getElementById('maint-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const pw = document.getElementById('maint-pass').value.trim();
      const err = document.getElementById('maint-err');
      if (!pw) return;
      err.hidden = true;
      SN.post('checkBypass', { password: pw }).then((r) => {
        if (!r || !r.ok) throw r;
        SN.setBypassKey(pw);
        location.reload();
      }).catch((r) => { err.textContent = (r && r.error) || 'Couldn’t check that just now. Try again in a minute.'; err.hidden = false; });
    });
  }

  render();
  SN.ready.then(() => {
    const cfg = SN.load();
    try { localStorage.setItem('sn_maint', cfg.maintenanceMode === true ? '1' : '0'); } catch (e) { /* ignore */ }
    if (closed(cfg)) { showMaintenance(cfg); document.documentElement.classList.remove('sn-maint-wait'); return; }
    document.documentElement.classList.remove('sn-maint-wait');
    render();
    // A hidden page sends visitors to the home page (except while previewing changes).
    if (!shown(cfg, page) && !SN.isPreview()) { location.replace('index.html'); return; }
    // Links to hidden pages elsewhere on the page disappear (with their card, if marked data-page-link).
    Object.keys(SHOW_KEY).filter((k) => !shown(cfg, k)).forEach((k) => {
      document.querySelectorAll('main a[href="' + k + '.html"]').forEach((a) => { (a.closest('[data-page-link]') || a).hidden = true; });
    });
  });
})();

/* ---------- Quick "Message me" form (email + message), opened by any [data-quick-message] button ---------- */
(function () {
  const esc = SN.esc;
  const wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="scrim" id="qm-scrim"></div>' +
    '<aside class="panel qm-panel" id="qm-panel" role="dialog" aria-modal="true" aria-labelledby="qm-title" tabindex="-1">' +
      '<div class="panel-head"><div><h2 id="qm-title">Message me</h2><p>I’ll reply by email, usually within 1–2 days.</p></div>' +
        '<button type="button" class="x-btn" data-qm="close" aria-label="Close">' + SN_ICONS.close + '</button></div>' +
      '<div class="panel-body" id="qm-body"></div>' +
    '</aside>';
  document.body.appendChild(wrap);
  const panel = document.getElementById('qm-panel');
  const scrim = document.getElementById('qm-scrim');
  const body = document.getElementById('qm-body');
  let opener = null;
  let topic = 'Quick message';

  function form() {
    body.innerHTML =
      '<form id="qm-form" novalidate><div class="stack" style="gap:16px">' +
        '<div class="field"><label class="label" for="qm-email">Your email</label>' +
          '<input class="input" id="qm-email" type="email" autocomplete="email" required aria-describedby="qm-email-err">' +
          '<p class="err" id="qm-email-err" hidden>Please enter a valid email so I can reply.</p></div>' +
        '<div class="field"><label class="label" for="qm-msg">Your message</label>' +
          '<textarea class="input" id="qm-msg" rows="6" required aria-describedby="qm-msg-err" placeholder="Ask me anything: flavors, allergies, a design idea, an event…"></textarea>' +
          '<p class="err" id="qm-msg-err" hidden>Please add a message.</p></div>' +
        '<div class="hp" aria-hidden="true"><label>Website <input type="text" id="qm-website" tabindex="-1" autocomplete="off"></label></div>' +
        '<button type="submit" class="btn block" id="qm-send">Send message</button>' +
        '<p class="err" id="qm-send-err" role="alert" hidden></p>' +
        '<p class="hint" style="text-align:center">Want to add a photo or phone number? Use the <a href="contact.html">full contact form</a>.</p>' +
      '</div></form>';
  }
  function open(el) {
    opener = el || document.activeElement;
    topic = (el && el.dataset.quickMessage) || 'Quick message';
    form();
    panel.classList.add('open');
    scrim.classList.add('open');
    document.body.classList.add('locked');
    setTimeout(() => { const f = document.getElementById('qm-email'); (f || panel).focus(); }, 80);
  }
  function close() {
    panel.classList.remove('open');
    scrim.classList.remove('open');
    document.body.classList.remove('locked');
    if (opener && document.body.contains(opener)) opener.focus();
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-quick-message]');
    if (t) { e.preventDefault(); open(t); return; }
    if (e.target.closest('[data-qm="close"]')) close();
  });
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) close(); });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = Array.from(panel.querySelectorAll('button, [href], input, textarea')).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  // Clear an error as soon as the field is fixed.
  body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'qm-email' && SN.validEmail(t.value)) { document.getElementById('qm-email-err').hidden = true; t.setAttribute('aria-invalid', 'false'); }
    if (t.id === 'qm-msg' && t.value.trim()) { document.getElementById('qm-msg-err').hidden = true; t.setAttribute('aria-invalid', 'false'); }
  });

  body.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('qm-email');
    const msg = document.getElementById('qm-msg');
    const eBad = !SN.validEmail(email.value);
    const mBad = !msg.value.trim();
    document.getElementById('qm-email-err').hidden = !eBad;
    document.getElementById('qm-msg-err').hidden = !mBad;
    email.setAttribute('aria-invalid', String(eBad));
    msg.setAttribute('aria-invalid', String(mBad));
    if (eBad || mBad) { (eBad ? email : msg).focus(); return; }
    const btn = document.getElementById('qm-send');
    const sendErr = document.getElementById('qm-send-err');
    if (btn.getAttribute('aria-disabled') === 'true') return;
    btn.setAttribute('aria-disabled', 'true');
    btn.textContent = 'Sending…';
    sendErr.hidden = true;
    SN.post('sendMessage', { email: email.value.trim(), message: msg.value.trim(), topic, source: 'quick', website: document.getElementById('qm-website').value })
      .then((r) => { if (!r || !r.ok) throw r; sent(email.value.trim()); })
      .catch((r) => {
        btn.removeAttribute('aria-disabled');
        btn.textContent = 'Send message';
        sendErr.textContent = SN.sendErrorText(r);
        sendErr.hidden = false;
      });
  });

  function sent(address) {
    body.innerHTML =
      '<div class="done" role="status"><div class="check">' + SN_ICONS.check + '</div>' +
        '<h3 tabindex="-1" id="qm-done">Message sent!</h3>' +
        '<p class="muted" style="margin:12px auto 0;max-width:360px">I’ll reply to <strong style="color:var(--navy)">' + esc(address) + '</strong>, usually within 1–2 days.</p>' +
        '<button type="button" class="btn" data-qm="close" style="margin-top:22px">Done</button></div>';
    document.getElementById('qm-done').focus();
  }
})();
