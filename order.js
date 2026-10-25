/* The bag + checkout, on every page (opens on top of whatever page you're on), and on the Order page also the menu
   and item slide-overs. Waits for the Sheet's settings so prices are current. */
SN.ready.then(function () {
  const cfg = SN.load();
  let bag = SN.getBag();
  let mode = null;            // null | 'custom' | 'mini' | 'large' | 'bag' | 'done'
  let draft = null;
  let draftTried = false;
  let tried = false;
  let lastOrders = [];        // what the server sent back: a cookie request and/or a class booking
  let sending = false;
  let submissionId = '';      // one per checkout, so a retry can't place the order twice (see SN.newSubmissionId)
  let appliedCode = null;     // { code, type: 'percent' | 'gift', amount } once "Apply" accepts it
  let codeChecking = false;
  const touched = {};         // checkout boxes the customer has typed in and left
  let opener = null;
  let toastTimer = null;
  const checkout = {
    eventType: '', eventOther: '', date: '', fulfillment: 'pickup',
    address: '', city: '', zip: '', name: '', email: '', phone: '', allergies: '', code: '', eventTime: '', winFrom: '', winTo: '', winNote: ''
  };
  // The Sheet couldn't be reached: built-in prices and flavors may be out of date, so ordering pauses.
  const paused = SN.configFailed;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const onOrderPage = !!$('#menu');
  // Pages other than Order get the bag panel and the "added to bag" toast here (order.html has them in its HTML).
  if (!$('#panel')) {
    document.body.insertAdjacentHTML('beforeend', '<div class="scrim" id="scrim"></div>' +
      '<aside class="panel" id="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" tabindex="-1"></aside>' +
      '<div class="toast" id="toast" role="status" aria-live="polite"><span id="toast-icon"></span><span id="toast-text"></span>' +
      '<button type="button" id="toast-view">View bag</button></div>');
  }
  const panel = $('#panel');
  const scrim = $('#scrim');
  const money = SN.money;
  const esc = SN.esc;

  /* ---------------- Page setup ---------------- */
  if (onOrderPage) $('#lead-days').textContent = cfg.leadDays;
  if (onOrderPage && SN.specialActive(cfg)) {
    $('#special-wrap').hidden = false;
    $('#special-icon').innerHTML = SN_ICONS.star;
    $('#special-text').textContent = cfg.specialText;
  }
  $('#toast-icon').innerHTML = SN_ICONS.checkSmall;

  const art = {
    custom: '<svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true"><circle cx="60" cy="60" r="46" fill="#FFFFFF" stroke="#1F2A44" stroke-width="2.5"/><circle cx="60" cy="60" r="36" stroke="#E8B4A8" stroke-width="2" stroke-dasharray="4 5"/><path d="M60 76s-16-9.5-16-20a8.5 8.5 0 0116-4 8.5 8.5 0 0116 4c0 10.5-16 20-16 20z" fill="#C65A4B"/></svg>',
    mini: '<svg width="140" height="110" viewBox="0 0 140 110" fill="none" aria-hidden="true"><circle cx="42" cy="58" r="26" fill="#FFFFFF" stroke="#1F2A44" stroke-width="2.5"/><circle cx="96" cy="44" r="26" fill="#FFFFFF" stroke="#1F2A44" stroke-width="2.5"/><circle cx="80" cy="82" r="20" fill="#FFFFFF" stroke="#1F2A44" stroke-width="2.5"/><circle cx="36" cy="52" r="3" fill="#1F2A44"/><circle cx="49" cy="63" r="3" fill="#1F2A44"/><circle cx="90" cy="40" r="3" fill="#C65A4B"/><circle cx="102" cy="50" r="3" fill="#E8B4A8"/><circle cx="78" cy="80" r="3" fill="#1F2A44"/></svg>',
    large: '<svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true"><circle cx="60" cy="60" r="44" fill="#FFFFFF" stroke="#1F2A44" stroke-width="2.5"/><circle cx="46" cy="48" r="5" fill="#1F2A44"/><circle cx="70" cy="44" r="4" fill="#1F2A44"/><circle cx="74" cy="70" r="5" fill="#1F2A44"/><circle cx="50" cy="74" r="4" fill="#1F2A44"/><circle cx="60" cy="60" r="3" fill="#C65A4B"/></svg>'
  };
  const bg = { custom: '#F7E3DD', mini: '#EDE3DA', large: '#E4E7EE' };
  const customEach = SN.customPrice(cfg);
  const menuItems = [
    { kind: 'custom', title: 'Custom Cookies', desc: 'Hand-decorated to your theme. Tell us your vision and share an inspiration photo. ' + (cfg.customNote || ''), price: 'Starting at ' + money(customEach) + ' / cookie', small: '1 dozen min.', cta: 'Customize & add' },
    { kind: 'mini', title: 'Mini Artisan', desc: 'Bite-size classics. ' + flavorRule() + ' Add extras one at a time.', price: money(cfg.miniPerDozen) + ' / dozen', small: money(SN.perCookie(cfg, 'mini')) + ' each', cta: 'Choose flavors' },
    { kind: 'large', title: 'Large Artisan', desc: 'Big, bakery-style cookies. ' + flavorRule() + ' Add extras one at a time.', price: money(cfg.largePerDozen) + ' / dozen', small: money(SN.perCookie(cfg, 'large')) + ' each', cta: 'Choose flavors' }
  ];
  // "Mix up to 4 flavors, or up to 6 with 2 dozen or more."
  function flavorRule() {
    const at = Number(cfg.flavorsMaxAt) || 24;
    return 'Mix up to ' + cfg.flavorsPerDozen + ' flavors, or up to ' + cfg.flavorsMax + ' with ' + (at % 12 === 0 ? at / 12 + ' dozen' : at + ' cookies') + ' or more.';
  }
  if (onOrderPage) $('#menu').innerHTML = menuItems.map((m) => {
    const img = SN.photoUrl(cfg.images && cfg.images[m.kind]);   // photo links from the Sheet's Pages tab
    return '<article class="card">' +
      '<div class="card-media" style="background:' + bg[m.kind] + '">' +
        (img ? '<img src="' + esc(img) + '" alt="' + esc(m.title) + '">' : art[m.kind] + '<span class="tag">Photo coming soon</span>') +
      '</div>' +
      '<div class="card-body">' +
        '<h3>' + esc(m.title) + '</h3>' +
        '<p class="desc">' + esc(m.desc) + '</p>' +
        '<p class="price">' + esc(m.price) + ' <span>· ' + esc(m.small) + '</span></p>' +
        '<button type="button" class="btn" data-open="' + m.kind + '"' + (cfg.acceptingOrders && !paused ? '' : ' aria-disabled="true"') + '>' + esc(m.cta) + '</button>' +
      '</div></article>';
  }).join('');
  if (onOrderPage && paused) {
    $('#closed-note').textContent = 'We’re having trouble loading the menu right now. Please try again in a few minutes.';
    $('#closed-note').hidden = false;
  } else if (onOrderPage && !cfg.acceptingOrders) $('#closed-note').hidden = false;

  if (onOrderPage) $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (!b || !cfg.acceptingOrders || paused) return;
    openItem(b.dataset.open, b);
  });
  // The header's Bag button, and any "View bag" link marked data-open-bag, open the bag right here. Delegated, because
  // layout.js redraws the header once settings arrive.
  const bagBtn = () => $('#bag-btn');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#bag-btn, [data-open-bag]');
    if (b) { e.preventDefault(); openBag(b); }
  });
  $('#toast-view').addEventListener('click', () => openBag(bagBtn()));
  // Another part of this page changed the bag (e.g. the Events page's "Add to bag").
  document.addEventListener('sn:bag', () => { bag = SN.getBag(); saveBag(); if (mode === 'bag') renderPanel(); });
  scrim.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mode) closePanel(); });

  /* ---------------- Panel open / close ---------------- */
  function showPanel(focusEl) {
    opener = focusEl || document.activeElement;
    panel.classList.add('open');
    scrim.classList.add('open');
    document.body.classList.add('locked');
    hideToast();
    setTimeout(() => { const c = $('[data-act="close"]', panel); (c || panel).focus(); }, 60);
  }
  function closePanel() {
    mode = null;
    if (history.state && history.state.snCheckout) history.back();   // drop the checkout history entry
    panel.classList.remove('open');
    scrim.classList.remove('open');
    document.body.classList.remove('locked');
    if (opener && document.body.contains(opener)) opener.focus();
  }
  function openItem(kind, el) {
    mode = kind;
    draftTried = false;
    draft = kind === 'custom'
      ? { kind, qty: cfg.minQty, designs: 1, desc: '', picker: null }
      : { kind, fq: {} };
    renderPanel();
    showPanel(el);
  }
  function openBag(el) {
    mode = 'bag';
    renderPanel();
    showPanel(el);
  }

  /* ---------------- Rendering ---------------- */
  function head(title, sub) {
    return '<div class="panel-head"><div><h2 id="panel-title">' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' +
      '<button type="button" class="x-btn" data-act="close" aria-label="Close">' + SN_ICONS.close + '</button></div>';
  }

  function renderPanel() {
    if (mode === 'custom') panel.innerHTML = renderCustom();
    else if (mode === 'mini' || mode === 'large') panel.innerHTML = renderArtisan();
    else if (mode === 'bag') panel.innerHTML = renderBag();
    else if (mode === 'checkout') panel.innerHTML = renderCheckout();
    else if (mode === 'done') panel.innerHTML = renderDone();
    else if (mode === 'paid') panel.innerHTML = renderPaid();
    panel.classList.toggle('full', mode === 'checkout' || mode === 'done' || mode === 'paid');
    if (mode === 'custom') draft.picker = SN.photoPicker($('#d-photos'), { id: 'd-photo', label: 'Upload inspiration photos', photos: draft.picker ? draft.picker.photos() : [] });
    if (mode === 'custom' || mode === 'mini' || mode === 'large') updateDraftUI();
    if (mode === 'checkout') updateCheckoutUI();
  }

  // Bag -> checkout and back. Checkout adds a browser history entry so the phone's Back button returns to the bag.
  function goCheckout() {
    mode = 'checkout';
    history.pushState({ snCheckout: true }, '');
    renderPanel();
    focusTop();
  }
  function backToBag() {
    if (history.state && history.state.snCheckout) { history.back(); return; }   // popstate below re-renders
    mode = 'bag';
    renderPanel();
    focusTop();
  }
  window.addEventListener('popstate', () => {
    if (mode !== 'checkout') return;
    mode = 'bag';
    renderPanel();
    focusTop();
  });
  function focusTop() {
    const body = $('.panel-body', panel);
    if (body) body.scrollTop = 0;
    const t = $('#panel-title', panel);
    if (t) { t.setAttribute('tabindex', '-1'); t.focus(); }
  }

  // Dropdown options for quantities. Dozens are labeled so they're easy to spot.
  const QTY_MAX = 240;
  function qtyOptions(from, to, current, dozenLabels) {
    let html = '';
    const top = Math.max(to, current || 0);
    for (let n = from; n <= top; n++) {
      const label = dozenLabels && n > 0 && n % 12 === 0 ? n + ' (' + (n / 12) + ' dozen)' : String(n);
      html += '<option value="' + n + '"' + (n === current ? ' selected' : '') + '>' + label + '</option>';
    }
    return html;
  }

  function renderCustom() {
    let pills = '';
    for (let n = 1; n <= cfg.maxDesigns; n++) pills += '<button type="button" class="pill" data-act="design" data-n="' + n + '" aria-pressed="false">' + n + '</button>';
    return head('Custom Cookies', 'Starting at ' + money(customEach) + ' per cookie · 1 dozen minimum') +
      '<div class="panel-body"><div class="stack" style="gap:22px">' +
        '<div class="field"><span class="label" id="designs-label">How many different designs?</span>' +
          '<div class="row-gap" role="group" aria-labelledby="designs-label">' + pills + '</div>' +
          '<p class="hint">Helps Sweet Nothings plan and price your set.</p></div>' +
        '<div class="field"><span class="label" id="qty-label">Quantity</span>' +
          '<div class="qty" role="group" aria-labelledby="qty-label">' +
            '<button type="button" class="step" data-act="qty-dec" aria-label="One fewer cookie">' + SN_ICONS.minus + '</button>' +
            '<select class="input qty-select" id="d-qty" aria-label="Number of custom cookies">' + qtyOptions(cfg.minQty, QTY_MAX, draft.qty, true) + '</select>' +
            '<button type="button" class="step" data-act="qty-inc" aria-label="One more cookie">' + SN_ICONS.plus + '</button>' +
            '<span class="muted" style="font-size:14px">× <span id="d-each"></span> each (starting price)</span>' +
          '</div><p class="hint">Minimum ' + cfg.minQty + '. Pick a number or use the + and − buttons.</p></div>' +
        '<div class="field"><label class="label" for="d-desc">Describe your cookies</label>' +
          '<textarea class="input" id="d-desc" rows="5" data-draft="desc" placeholder="Theme, colors, names or wording, and how many of each design…"></textarea></div>' +
        '<div class="field"><span class="label">Inspiration photos (optional)</span><div id="d-photos"></div></div>' +
        // Fine print, folded so it doesn't crowd the form.
        '<div class="note-box fold-box">' +
          SN.aiPhotoNote +
          '<details><summary>How pricing works</summary><p>' + esc(cfg.customNote || '') + ' Sweet Nothings will confirm your final price before you pay.</p></details>' +
          (cfg.allergyNote ? '<details><summary>Allergy-friendly swaps</summary><p>' + esc(cfg.allergyNote) + '</p></details>' : '') +
        '</div>' +
      '</div></div>' +
      '<div class="panel-foot"><p class="err" id="draft-err" hidden style="margin-bottom:10px"></p>' +
        '<button type="button" class="btn block" data-act="add" id="add-btn"></button></div>';
  }

  function renderArtisan() {
    const per = SN.perCookie(cfg, mode);
    const flavors = cfg.flavors.filter((f) => f.on);
    const rows = flavors.map((f) =>
      '<div class="flavor-row" data-row="' + esc(f.id) + '"><div><div class="flavor-name">' + esc(f.name) + '</div>' +
        (f.special ? '<div class="badge">SPECIAL</div>' : '') +
        '<div class="lock-note" hidden>Flavor limit reached</div></div>' +
      '<div class="qty">' +
        '<button type="button" class="step" data-act="f-dec" data-id="' + esc(f.id) + '" aria-label="One less ' + esc(f.name) + '">' + SN_ICONS.minus + '</button>' +
        '<select class="input qty-select qty-select-sm" data-fq="' + esc(f.id) + '" aria-label="Number of ' + esc(f.name) + '">' + qtyOptions(0, 96, draft.fq[f.id] || 0) + '</select>' +
        '<button type="button" class="step" data-act="f-inc" data-id="' + esc(f.id) + '" aria-label="One more ' + esc(f.name) + '">' + SN_ICONS.plus + '</button>' +
      '</div></div>').join('');
    const title = mode === 'mini' ? 'Mini Artisan' : 'Large Artisan';
    const dozen = mode === 'mini' ? cfg.miniPerDozen : cfg.largePerDozen;
    return head(title, money(dozen) + ' per dozen · ' + money(per) + ' each') +
      '<div class="panel-body">' +
        '<p style="margin:0 0 6px">Pick your flavors. ' + esc(flavorRule()) + '</p>' +
        '<div style="border-top:1px solid var(--line);margin-top:10px">' + (rows || '<p class="hint" style="padding:14px 0">No flavors are available right now.</p>') + '</div>' +
        '<div class="row-gap" style="margin-top:16px"><button type="button" class="btn ghost small" data-act="f-clear">Clear</button></div>' +
        '<p class="hint" id="art-msg" style="margin-top:14px;font-size:14px" aria-live="polite"></p>' +
      '</div>' +
      '<div class="panel-foot"><button type="button" class="btn block" data-act="add" id="add-btn"></button></div>';
  }

  function draftState() {
    if (draft.kind === 'custom') {
      const each = customEach;
      const err = draft.desc.trim() ? '' : 'Please describe your cookies.';
      return { total: draft.qty * each, each, err };
    }
    const c = SN.artisanCheck(cfg, draft.fq);
    return { total: c.qty * SN.perCookie(cfg, draft.kind), err: c.err, check: c };
  }

  function updateDraftUI() {
    const st = draftState();
    if (draft.kind === 'custom') {
      const qs = $('#d-qty');
      if (draft.qty > QTY_MAX && !qs.querySelector('option[value="' + draft.qty + '"]')) qs.insertAdjacentHTML('beforeend', '<option value="' + draft.qty + '">' + draft.qty + '</option>');
      qs.value = String(draft.qty);
      $('#d-each').textContent = money(st.each);
      $('[data-act="qty-dec"]', panel).disabled = draft.qty <= cfg.minQty;
      $$('[data-act="design"]', panel).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === draft.designs)));
      const desc = $('#d-desc');
      if (desc.value !== draft.desc) desc.value = draft.desc;
      const errEl = $('#draft-err');
      errEl.hidden = !(draftTried && st.err);
      errEl.textContent = st.err;
      $('#d-desc').setAttribute('aria-invalid', String(!!(draftTried && st.err)));
    } else {
      $$('select[data-fq]', panel).forEach((o) => {
        const v = draft.fq[o.dataset.fq] || 0;
        if (!o.querySelector('option[value="' + v + '"]')) o.insertAdjacentHTML('beforeend', '<option value="' + v + '">' + v + '</option>');
        o.value = String(v);
      });
      $$('[data-act="f-dec"]', panel).forEach((b) => { b.disabled = !(draft.fq[b.dataset.id] > 0); });
      const c = st.check;
      // Flavor limit: once they've used every allowed flavor, lock the flavors they haven't picked.
      const atLimit = c.used >= c.max;
      $$('.flavor-row[data-row]', panel).forEach((row) => {
        const id = row.dataset.row;
        const locked = atLimit && !(draft.fq[id] > 0);
        row.classList.toggle('locked', locked);
        $('[data-act="f-inc"]', row).disabled = locked;
        $('select[data-fq]', row).disabled = locked;
        $('.lock-note', row).hidden = !locked;
      });
      const unlockAt = Number(cfg.flavorsMaxAt) || 24;
      const msg = $('#art-msg');
      if (c.err) {
        msg.textContent = c.err;
        msg.style.color = draftTried || c.used > c.max ? 'var(--error)' : 'var(--muted)';
      } else if (atLimit) {
        msg.textContent = c.qty + ' cookies · ' + c.used + ' of ' + c.max + ' flavors used.' +
          (c.qty < unlockAt && cfg.flavorsMax > c.max ? ' Reach ' + unlockAt + ' cookies to pick up to ' + cfg.flavorsMax + ' flavors.' : '');
        msg.style.color = 'var(--muted)';
      } else {
        msg.textContent = c.qty + ' cookies · ' + c.used + ' of ' + c.max + ' flavors used';
        msg.style.color = 'var(--muted)';
      }
    }
    const add = $('#add-btn');
    add.textContent = 'Add to bag · ' + (draft.kind === 'custom' ? 'from ' : '') + money(st.total);
    add.setAttribute('aria-disabled', String(!!st.err));
  }

  // A bag can hold cookies (sent to Sweet Nothings for review) and classes (booked right away).
  const hasCookies = () => bag.some((it) => it.kind !== 'class');
  const hasClasses = () => bag.some((it) => it.kind === 'class');
  const round2 = (n) => Math.round(n * 100) / 100;

  function renderBag() {
    if (!bag.length) {
      return head('Your bag') +
        '<div class="panel-body"><div class="done"><p style="font-size:17px;margin:0">Your bag is empty.</p>' +
        (onOrderPage ? '<button type="button" class="btn" data-act="close" style="margin-top:18px">Browse the menu</button>'
          : '<a class="btn" href="order.html" style="margin-top:18px">Browse the menu</a>') + '</div></div>';
    }
    const subtotal = bag.reduce((a, it) => a + SN.itemTotal(cfg, it), 0);
    return head('Your bag') +
      '<div class="panel-body">' +
        bagItems(true) +
        (onOrderPage ? '<button type="button" class="btn dashed" data-act="close" style="margin-top:14px">+ Add more cookies</button>'
          : '<a class="btn dashed" href="order.html" style="margin-top:14px">+ Add cookies</a>') +
      '</div>' +
      '<div class="panel-foot">' +
        '<div class="grand"><strong>Subtotal</strong><strong>' + (bag.some((it) => it.kind === 'custom') ? 'from ' : '') + money(subtotal) + '</strong></div>' +
        '<p class="hint" style="margin:-4px 0 12px">' + (hasCookies()
          ? 'Next: your date, pickup or drop-off, and contact details. Any drop-off fee is added at checkout; sales tax is added to your invoice.'
          : 'Next: your contact details.') + '</p>' +
        (paused
          ? '<div class="missing">We’re having trouble reaching our order system right now. Please try again in a few minutes.</div>'
          : '<button type="button" class="btn block" data-act="checkout">Begin checkout</button>') +
      '</div>';
  }

  function bagItems(removable) {
    return bag.map((it) =>
      '<div class="bag-item"><div class="top"><strong>' + esc(SN.itemHeading(it)) + '</strong><strong>' + (it.kind === 'custom' ? 'from ' : '') + money(SN.itemTotal(cfg, it)) + '</strong></div>' +
      '<div class="detail">' + esc(SN.describeItem(cfg, it)) + '</div>' +
      (it.desc ? '<div class="note">“' + esc(it.desc) + '”</div>' : '') +
      (removable ? '<button type="button" class="link-btn" data-act="remove" data-id="' + it.id + '">Remove</button>' : '') + '</div>').join('');
  }

  // Full-page header for checkout and the "request sent" screen: content sits in a centered column.
  function fullHead(title, back) {
    return '<div class="panel-head"><div class="checkout-col checkout-head-row"><div>' +
        (back ? '<button type="button" class="link-btn" data-act="to-bag">← Back to bag</button>' : '') +
        '<h2 id="panel-title" tabindex="-1">' + esc(title) + '</h2></div>' +
      '<button type="button" class="x-btn" data-act="close" aria-label="Close">' + SN_ICONS.close + '</button></div></div>';
  }

  function submitLabel() {
    if (sending) return 'Sending…';
    const pay = cfg.classesPayOnline !== false;
    return hasCookies() && hasClasses() ? (pay ? 'Send order, book & pay for class' : 'Send order & book class')
      : hasCookies() ? 'Send order request' : pay ? 'Book class & pay' : 'Book class';
  }

  // Checkout takes the whole screen; the send button comes after every section, so it's reached by scrolling through them.
  // A classes-only bag skips the cookie sections (occasion, date, allergies, pickup or drop-off).
  function renderCheckout() {
    if (!bag.length) return renderBag();
    const minISO = SN.isoDate(SN.minDate(cfg));
    const events = ['Birthday', 'Baby Shower', 'Wedding Shower', 'Anniversary', 'Party', 'Other'];
    const isDel = checkout.fulfillment === 'delivery';
    const cookieSections =
        '<div class="sec"><h3>Your event</h3><div class="stack">' +
          '<div class="field"><label class="label" for="c-event">What are the cookies for?' + (needsOccasion() ? '' : ' <span class="muted" style="font-weight:400">(optional)</span>') + '</label>' +
            '<select class="input" id="c-event" data-co="eventType"><option value="">Choose one…</option>' +
            events.map((e) => '<option' + (checkout.eventType === e ? ' selected' : '') + '>' + e + '</option>').join('') + '</select></div>' +
          '<div class="field" id="other-wrap"' + (checkout.eventType === 'Other' ? '' : ' hidden') + '><label class="label" for="c-other">Tell us the occasion</label>' +
            '<input class="input" id="c-other" type="text" data-co="eventOther" placeholder="e.g. Graduation, corporate gift" value="' + esc(checkout.eventOther) + '"></div>' +
          '<div class="field"><label class="label" for="c-date">Date you need them</label>' +
            '<div class="date-wrap' + (checkout.date ? ' has-value' : '') + '"><input class="input" id="c-date" type="date" data-co="date" min="' + minISO + '" value="' + esc(checkout.date) + '"><span class="date-ph" aria-hidden="true">Tap to choose a date</span></div>' +
            '<p class="hint" id="date-msg">Earliest available: ' + esc(SN.prettyDate(minISO)) + '</p>' +
            '<div class="note-box fold-box" style="margin-top:10px"><details><summary>Need them sooner? Rush orders</summary>' +
              '<p>If you need your cookies sooner than ' + cfg.leadDays + ' days, <a href="contact.html?topic=rush">send me a message</a> before ordering to see if I can fit you in. Rush orders have an extra rush fee, added to your final price.</p>' +
            '</details></div></div>' +
          '<div class="field"><label class="label" for="c-time">Time of your event <span class="muted" style="font-weight:400">(optional)</span></label>' +
            '<div class="date-wrap' + (checkout.eventTime ? ' has-value' : '') + '"><input class="input time-input" id="c-time" type="time" data-co="eventTime" value="' + esc(checkout.eventTime) + '"><span class="date-ph" aria-hidden="true">Tap to pick</span></div></div>' +
          '<div class="field"><label class="label" for="c-allergies">Allergies or dietary needs <span class="muted" style="font-weight:400">(optional)</span></label>' +
            '<textarea class="input" id="c-allergies" rows="2" data-co="allergies" placeholder="e.g. one guest has a nut allergy, need 6 gluten-free">' + esc(checkout.allergies) + '</textarea>' +
            (cfg.allergyNote ? '<div class="note-box fold-box" style="margin-top:10px"><details><summary>Allergy-friendly swaps</summary><p>' + esc(cfg.allergyNote) + '</p></details></div>' : '') + '</div>' +
        '</div></div>' +
        '<div class="sec"><h3>Pickup or drop-off</h3>' +
          '<div class="grid-2" role="group" aria-label="Pickup or drop-off">' +
            '<button type="button" class="choice" data-act="pickup" aria-pressed="' + !isDel + '"><strong>Pickup · Free</strong><span>' + esc(cfg.pickupCity) + '</span></button>' +
            '<button type="button" class="choice" data-act="delivery" aria-pressed="' + isDel + '"><strong>Drop-off · ' + esc(feeRange()) + '</strong><span>Based on ZIP code</span></button>' +
          '</div>' +
          '<p class="hint" id="pickup-note" style="margin-top:12px"' + (isDel ? ' hidden' : '') + '>Pickup is in ' + esc(cfg.pickupCity) + '. The exact address is shared before pickup, in your order confirmation email.</p>' +
          '<div class="grid-2" id="delivery-fields" style="margin-top:14px"' + (isDel ? '' : ' hidden') + '>' +
            '<div class="field full"><label class="label" for="c-address">Street address</label><input class="input" id="c-address" type="text" autocomplete="street-address" data-co="address" value="' + esc(checkout.address) + '"></div>' +
            '<div class="field"><label class="label" for="c-city">City</label><input class="input" id="c-city" type="text" autocomplete="address-level2" data-co="city" value="' + esc(checkout.city) + '"></div>' +
            '<div class="field"><label class="label" for="c-zip">ZIP code</label><input class="input" id="c-zip" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="5" data-co="zip" value="' + esc(checkout.zip) + '"></div>' +
            '<p class="hint full" id="zip-msg" aria-live="polite"></p>' +
          '</div>' +
          // Melissa bakes from home, so pickup and drop-off happen at a time she confirms with the customer.
          '<div class="field" style="margin-top:14px"><span class="label" id="window-label">' + (isDel ? 'Best drop-off window' : 'Best pickup window') + '</span>' +
            '<div class="row-gap time-range" role="group" aria-labelledby="window-label">' +
              '<label class="time-part"><span class="muted">From</span><div class="date-wrap' + (checkout.winFrom ? ' has-value' : '') + '"><input class="input time-input" id="c-win-from" type="time" data-co="winFrom" value="' + esc(checkout.winFrom) + '"><span class="date-ph" aria-hidden="true">Tap to pick</span></div></label>' +
              '<label class="time-part"><span class="muted">To</span><div class="date-wrap' + (checkout.winTo ? ' has-value' : '') + '"><input class="input time-input" id="c-win-to" type="time" data-co="winTo" value="' + esc(checkout.winTo) + '"><span class="date-ph" aria-hidden="true">Tap to pick</span></div></label>' +
            '</div>' +
            '<label class="sr-only" for="c-win-note">Note about timing</label>' +
            '<input class="input" id="c-win-note" type="text" data-co="winNote" style="margin-top:8px" placeholder="Note (optional), e.g. Friday after 5 also works" value="' + esc(checkout.winNote) + '">' +
            '<div class="note-box fold-box" style="margin-top:10px"><details><summary>How pickup &amp; drop-off times work</summary>' +
              '<p>I bake from home and have little ones, so pickup and drop-off are by appointment. Share the days and times that work best for you, and I’ll confirm an exact time by email before your order date.</p>' +
            '</details></div></div>' +
        '</div>';
    const notes = [];
    if (hasCookies()) notes.push('No payment for cookies today. Sweet Nothings will review your request, confirm the final price, and email you an invoice to pay.');
    if (hasClasses()) {
      notes.push(cfg.classesPayOnline !== false
        ? 'Next you’ll pay for your class securely through Square. Your spot is held for ' +
          (Number(cfg.classHoldMinutes) || 30) + ' minutes while you pay, and your confirmation email comes as soon as payment goes through.'
        : 'Classes are booked as soon as you send this. Sweet Nothings will be in touch about payment.');
    }
    return fullHead('Checkout', true) +
      '<div class="panel-body"><div class="checkout-col">' +
        '<div class="sec first"><h3>Your order</h3>' + bagItems(false) +
          '<button type="button" class="link-btn" data-act="to-bag" style="margin-top:6px">Edit bag</button></div>' +
        (hasCookies() ? cookieSections : '') +
        '<div class="sec"><h3>Your details</h3><div class="stack">' +
          '<div class="field"><label class="label" for="c-name">Full name</label><input class="input" id="c-name" type="text" autocomplete="name" data-co="name" value="' + esc(checkout.name) + '"></div>' +
          '<div class="grid-2">' +
            '<div class="field"><label class="label" for="c-email">Email</label><input class="input" id="c-email" type="email" autocomplete="email" data-co="email" aria-describedby="c-email-err" value="' + esc(checkout.email) + '">' +
              '<p class="err" id="c-email-err" hidden>Please enter a valid email, like name@example.com.</p></div>' +
            '<div class="field"><label class="label" for="c-phone">Phone</label><input class="input" id="c-phone" type="tel" inputmode="numeric" autocomplete="tel" data-co="phone" aria-describedby="c-phone-err" placeholder="847-555-0100" value="' + esc(checkout.phone) + '">' +
              '<p class="err" id="c-phone-err" hidden>Please enter a 10-digit phone number.</p></div>' +
          '</div>' +
          '<div class="hp" aria-hidden="true"><label>Website <input type="text" id="c-website" tabindex="-1" autocomplete="off"></label></div>' +
        '</div></div>' +
        '<div class="sec"><h3>Promo or gift code</h3>' +
          '<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">' +
            '<div class="field" style="flex:1 1 200px"><label class="sr-only" for="c-code">Promo or gift code</label>' +
              '<input class="input" id="c-code" type="text" autocomplete="off" autocapitalize="characters" data-co="code" placeholder="Enter a code" value="' + esc(checkout.code) + '"></div>' +
            '<button type="button" class="btn ghost" data-act="apply-code">' + (appliedCode ? 'Remove' : 'Apply') + '</button>' +
          '</div>' +
          '<p class="hint" id="code-msg" aria-live="polite"></p>' +
        '</div>' +
        '<div class="sec totals">' +
          '<div><span class="muted">Subtotal</span><span id="t-sub"></span></div>' +
          '<div id="t-disc-row" hidden><span class="muted" id="t-disc-label"></span><span id="t-disc"></span></div>' +
          (hasCookies() ? '<div><span class="muted">Sales tax' + (hasClasses() ? ' (cookies)' : '') + '</span><span id="t-tax" class="muted">Added to your invoice</span></div>' +
            '<div><span class="muted" id="t-fee-label"></span><span id="t-fee"></span></div>' : '') +
          '<div id="t-gift-row" hidden><span class="muted">Gift card</span><span id="t-gift"></span></div>' +
        '</div>' +
        '<div class="grand checkout-grand"><strong>' + (hasCookies() ? 'Estimated total (before tax)' : 'Total') + '</strong><strong id="t-total"></strong></div>' +
        '<div class="missing" id="missing" hidden></div>' +
        '<button type="button" class="btn block" data-act="submit"' + (sending ? ' aria-disabled="true"' : '') + '>' + submitLabel() + '</button>' +
        notes.map((n) => '<p class="hint" style="text-align:center;margin-top:10px">' + esc(n) + '</p>').join('') +
      '</div></div>';
  }

  function feeRange() {
    const fees = cfg.zones.map((z) => Number(z.fee));
    if (!fees.length) return 'not available';
    const lo = Math.min.apply(null, fees), hi = Math.max.apply(null, fees);
    return lo === hi ? money(lo) : '$' + lo + '–$' + hi;
  }

  // Same math as validateOrder_ in Code.gs: a percent code comes off first, and a gift card comes off last
  // (classes first, since they're paid now). Sales tax isn't included: QuickBooks adds it to the invoice.
  function quote() {
    const cookieSub = round2(bag.filter((it) => it.kind !== 'class').reduce((a, it) => a + SN.itemTotal(cfg, it), 0));
    const classSub = round2(bag.filter((it) => it.kind === 'class').reduce((a, it) => a + SN.itemTotal(cfg, it), 0));
    const pct = appliedCode && appliedCode.type === 'percent' ? appliedCode.amount : 0;
    const cookieDisc = round2(cookieSub * pct / 100), classDisc = round2(classSub * pct / 100);
    const tax = 0;
    const isDel = hasCookies() && checkout.fulfillment === 'delivery';
    const zone = cfg.zones.find((z) => z.zip === checkout.zip);
    const fee = isDel && zone ? Number(zone.fee) : 0;
    let gift = appliedCode && appliedCode.type === 'gift' ? appliedCode.amount : 0;
    const classCredit = round2(Math.min(gift, classSub - classDisc));
    gift -= classCredit;
    const cookieCredit = hasCookies() ? round2(Math.min(gift, cookieSub - cookieDisc + tax + fee)) : 0;
    const credit = round2(classCredit + cookieCredit);
    const subtotal = round2(cookieSub + classSub), discount = round2(cookieDisc + classDisc);
    return { subtotal, discount, tax, fee, zone, isDel, credit, total: round2(subtotal - discount + tax + fee - credit) };
  }

  // The occasion is required when the bag has custom cookies (it shapes the design), optional otherwise.
  function needsOccasion() { return bag.some((it) => it.kind === 'custom'); }

  // Cookies in the bag would push the chosen week past its cap: "that week only has room for 10 more custom cookies".
  function weekProblem(date) {
    const room = SN.weekRoom(cfg, date);
    const qty = (custom) => bag.filter((it) => it.kind !== 'class' && (it.kind === 'custom') === custom).reduce((a, it) => a + it.qty, 0);
    const msgs = [];
    [['custom', true], ['artisan', false]].forEach(([type, custom]) => {
      const n = qty(custom);
      if (room[type] === null || !n || n <= room[type]) return;
      msgs.push(room[type] ? 'that week only has room for ' + room[type] + ' more ' + type + ' cookies' : type + ' cookies are fully booked that week');
    });
    return msgs.join(' and ');
  }

  // Classes in the bag that have since filled up or been removed.
  function classProblems() {
    return bag.filter((it) => it.kind === 'class').map((it) => {
      const ev = SN.classEvent(cfg, it);
      if (!ev || ev.button !== 'Add to bag') return it.title + ' is no longer available (please remove it)';
      if (ev.spotsLeft !== undefined && it.qty > ev.spotsLeft) return ev.spotsLeft ? 'only ' + ev.spotsLeft + ' spots left in ' + ev.title : ev.title + ' is sold out (please remove it)';
      return '';
    }).filter(Boolean);
  }

  function missingList() {
    const m = classProblems();
    if (hasCookies()) {
      const minISO = SN.isoDate(SN.minDate(cfg));
      if (!cfg.acceptingOrders) m.push('cookie orders are paused right now (remove the cookies to book a class)');
      if (!checkout.eventType) { if (needsOccasion()) m.push('event type'); }
      else if (checkout.eventType === 'Other' && !checkout.eventOther.trim()) m.push('the occasion');
      if (!checkout.date) m.push('date needed');
      else if (checkout.date < minISO) m.push('a date at least ' + cfg.leadDays + ' days out');
      else if (cfg.blockedDates.includes(checkout.date)) m.push('a different date (that day is booked)');
      else if (weekProblem(checkout.date)) m.push('a different week (' + weekProblem(checkout.date) + ')');
      const q = quote();
      if (q.isDel) {
        if (!checkout.address.trim() || !checkout.city.trim()) m.push('drop-off address');
        if (!q.zone) m.push('a ZIP in our drop-off area');
      }
      if (!checkout.winFrom || !checkout.winTo) m.push(q.isDel ? 'a drop-off window (from and to)' : 'a pickup window (from and to)');
      else if (checkout.winTo <= checkout.winFrom) m.push('a window that ends after it starts');
    }
    if (!checkout.name.trim()) m.push('name');
    if (!SN.validEmail(checkout.email)) m.push('a valid email');
    if (!SN.validPhone(checkout.phone)) m.push('a 10-digit phone number');
    if (checkout.code.trim() && !appliedCode) m.push('apply your promo code (or clear it)');
    return m;
  }

  function updateCheckoutUI() {
    if (!bag.length || mode !== 'checkout') return;
    const q = quote();
    $('#t-sub').textContent = money(q.subtotal);
    $('#t-disc-row').hidden = !q.discount;
    $('#t-disc-label').textContent = appliedCode ? 'Promo code ' + appliedCode.code + ' (' + appliedCode.amount + '% off)' : '';
    $('#t-disc').textContent = '−' + money(q.discount);
    if ($('#t-tax')) {
      $('#t-fee-label').textContent = q.isDel ? 'Drop-off' : 'Pickup (' + cfg.pickupCity + ')';
      $('#t-fee').textContent = q.isDel ? (q.zone ? money(q.fee) : '—') : 'Free';
    }
    $('#t-gift-row').hidden = !q.credit;
    $('#t-gift').textContent = '−' + money(q.credit);
    $('#t-total').textContent = money(q.total);

    const zipMsg = $('#zip-msg');
    if (zipMsg) {
      if (checkout.zip.length < 5) { zipMsg.textContent = 'Enter your ZIP to see the drop-off fee.'; zipMsg.style.color = ''; }
      else if (q.zone) { zipMsg.textContent = 'Drop-off to ' + checkout.zip + ' (' + q.zone.area + '): ' + money(q.fee); zipMsg.style.color = ''; }
      else {
        // Outside the zones: offer a meet-up spot inside them (entered as the drop-off address), or free pickup.
        zipMsg.textContent = 'Sorry, ' + checkout.zip + ' is outside my drop-off area. We can meet at a spot inside it instead: just enter that spot’s address above. Or pick up for free in ' + cfg.pickupCity + '.';
        zipMsg.style.color = 'var(--error)';
      }
    }
    const dateWrap = $('.date-wrap', panel);
    if (dateWrap) dateWrap.classList.toggle('has-value', !!checkout.date);   // hides the iPhone "Tap to choose a date" hint
    const dateMsg = $('#date-msg');
    if (dateMsg) {
      const minISO = SN.isoDate(SN.minDate(cfg));
      const week = checkout.date ? weekProblem(checkout.date) : '';
      if (checkout.date && checkout.date < minISO) { dateMsg.textContent = 'Please choose ' + SN.prettyDate(minISO) + ' or later.'; dateMsg.style.color = 'var(--error)'; }
      else if (checkout.date && cfg.blockedDates.includes(checkout.date)) { dateMsg.textContent = 'Sorry, ' + SN.prettyDate(checkout.date) + ' is fully booked. Please pick another day.'; dateMsg.style.color = 'var(--error)'; }
      else if (week) { dateMsg.textContent = 'Sorry, ' + week + ' (the week of ' + SN.prettyDate(SN.mondayOf(checkout.date), { month: 'long', day: 'numeric' }) + '). Please choose another week.'; dateMsg.style.color = 'var(--error)'; }
      else if (checkout.date) { dateMsg.textContent = SN.prettyDate(checkout.date); dateMsg.style.color = ''; }
      else { dateMsg.textContent = 'Earliest available: ' + SN.prettyDate(minISO); dateMsg.style.color = ''; }
    }
    const codeMsg = $('#code-msg');
    if (codeMsg && !codeChecking) {
      codeMsg.style.color = '';
      codeMsg.textContent = !appliedCode ? '' : appliedCode.type === 'percent'
        ? appliedCode.code + ' applied: ' + appliedCode.amount + '% off.'
        : 'Gift card ' + appliedCode.code + ' applied (balance ' + money(appliedCode.amount) + ').';
    }
    const miss = missingList();
    const box = $('#missing');
    box.hidden = !(tried && miss.length);
    box.innerHTML = '<strong>Still needed:</strong> ' + esc(miss.join(', '));
    // Email / phone errors show under the box once they've left it (or tried to send), and clear as soon as it's fixed.
    [['email', SN.validEmail], ['phone', SN.validPhone]].forEach(([k, ok]) => {
      const input = $('#c-' + k), err = $('#c-' + k + '-err');
      if (!input || !err) return;
      const bad = (tried || touched[k]) && !ok(checkout[k]);
      err.hidden = !bad;
      input.setAttribute('aria-invalid', String(bad));
    });
    // Grayed out until every detail is filled in (still clickable, to show what's missing), like "Add to bag".
    const send = $('[data-act="submit"]', panel);
    if (send && !sending) send.setAttribute('aria-disabled', String(miss.length > 0));
  }

  // "Apply" checks the code with the server; "Remove" takes it off.
  // Applying or removing a code redraws the checkout; keep the page where it was and focus on the code box.
  function rerenderAtCode() {
    const scrollers = [panel].concat($$('.panel-body', panel));
    const tops = scrollers.map((el) => el.scrollTop);
    const winTop = window.scrollY;
    renderPanel();
    [panel].concat($$('.panel-body', panel)).forEach((el, i) => { if (tops[i] != null) el.scrollTop = tops[i]; });
    window.scrollTo(0, winTop);
    const f = $('[data-act="apply-code"]', panel);
    if (f) f.focus({ preventScroll: true });
  }

  function applyCode() {
    if (appliedCode) { appliedCode = null; checkout.code = ''; rerenderAtCode(); return; }
    const code = checkout.code.trim();
    const msg = $('#code-msg');
    if (!code) { msg.textContent = 'Enter a code first.'; return; }
    codeChecking = true;
    msg.style.color = '';
    msg.textContent = 'Checking…';
    SN.post('checkCode', { code }).then((r) => {
      codeChecking = false;
      if (!r || !r.ok) { msg.textContent = (r && r.error) || 'That code isn’t valid.'; msg.style.color = 'var(--error)'; return; }
      appliedCode = { code: r.code, type: r.type, amount: Number(r.amount) };
      checkout.code = r.code;
      rerenderAtCode();
    }).catch((r) => { codeChecking = false; msg.textContent = SN.sendErrorText(r); msg.style.color = 'var(--error)'; });
  }

  function renderDone() {
    const cookieOrder = lastOrders.find((o) => o.type === 'Cookies');
    const classOrder = lastOrders.find((o) => o.type === 'Class');
    const email = (cookieOrder || classOrder).customer.email;
    const toPay = classOrder && classOrder.payUrl;
    const classHtml = !classOrder ? '' : toPay
      // Square checkout: class-only bookings go straight there (see orderSent); a mixed bag gets this button.
      ? '<h3>' + (cookieOrder ? 'One more step: pay for your class' : 'Taking you to secure checkout…') + '</h3>' +
        '<p style="margin:10px 0 0;font-size:17px">Order number <strong>' + esc(classOrder.number) + '</strong></p>' +
        '<p class="muted" style="margin:12px 0 0">Your spot is held for ' + (Number(cfg.classHoldMinutes) || 30) + ' minutes while you pay. We’ll email ' + esc(email) + ' as soon as your payment goes through.</p>' +
        '<div class="stack" style="margin-top:16px;align-items:center"><a class="btn" href="' + esc(classOrder.payUrl) + '">Pay ' + money(classOrder.total) + ' for your class</a></div>'
      : '<h3>' + (cookieOrder ? 'Your class is booked!' : 'You’re booked!') + '</h3>' +
        '<p style="margin:10px 0 0;font-size:17px">Order number <strong>' + esc(classOrder.number) + '</strong></p>' +
        '<p class="muted" style="margin:12px 0 0">Your spot is saved. We sent the details to ' + esc(email) + '.' + (classOrder.total > 0 ? ' Sweet Nothings will be in touch about payment.' : '') + '</p>' +
        '<p style="margin:16px 0 0;font-family:var(--serif);font-size:26px;font-weight:600">Total ' + money(classOrder.total) + '</p>';
    return fullHead(cookieOrder ? 'Request sent' : toPay ? 'Almost booked' : 'You’re booked', false) +
      '<div class="panel-body"><div class="checkout-col done">' +
        '<div class="check">' + SN_ICONS.check + '</div>' +
        classHtml +
        (cookieOrder ? '<h3' + (classOrder ? ' style="margin-top:28px"' : '') + '>Thanks, we got your cookie request!</h3>' +
          '<p style="margin:10px 0 0;font-size:17px">Order number <strong>' + esc(cookieOrder.number) + '</strong></p>' +
          '<p class="muted" style="margin:12px 0 0"><strong>This is not a final order yet.</strong> We sent a copy of your request to ' + esc(email) + '. Sweet Nothings will review it and send a second email with your confirmation, final price and invoice. Your date is reserved once the invoice is paid.</p>' +
          '<p style="margin:20px 0 0;font-family:var(--serif);font-size:30px;font-weight:600">Estimated total ' + money(cookieOrder.total) + '</p><p class="muted" style="margin:4px 0 0">before tax; sales tax is added to your invoice</p>' : '') +
        '<div class="stack" style="margin-top:24px;align-items:center">' +
          (SN_ENV.name === 'uat' && cookieOrder ? '<a class="btn ghost" href="email.html?o=' + encodeURIComponent(cookieOrder.number) + '" target="_blank" rel="noopener">Preview the request email</a>' : '') +
          '<button type="button" class="btn" data-act="close">' + (onOrderPage ? 'Back to the menu' : 'Done') + '</button>' +
        '</div>' +
      '</div></div>';
  }

  /* ---------------- Panel events ---------------- */
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') { closePanel(); return; }

    // item drafts
    if (act === 'design') { draft.designs = Number(b.dataset.n); updateDraftUI(); return; }
    if (act === 'qty-inc') { draft.qty += 1; updateDraftUI(); return; }
    if (act === 'qty-dec') { draft.qty = Math.max(cfg.minQty, draft.qty - 1); updateDraftUI(); return; }
    if (act === 'f-inc') { draft.fq[b.dataset.id] = (draft.fq[b.dataset.id] || 0) + 1; updateDraftUI(); return; }
    if (act === 'f-dec') { draft.fq[b.dataset.id] = Math.max(0, (draft.fq[b.dataset.id] || 0) - 1); if (!draft.fq[b.dataset.id]) delete draft.fq[b.dataset.id]; updateDraftUI(); return; }
    if (act === 'f-clear') { draft.fq = {}; updateDraftUI(); return; }
    if (act === 'add') { addToBag(); return; }

    // bag
    if (act === 'remove') { bag = bag.filter((it) => String(it.id) !== b.dataset.id); saveBag(); renderPanel(); return; }
    if (act === 'checkout') { goCheckout(); return; }
    if (act === 'to-bag') { backToBag(); return; }
    if (act === 'pickup' || act === 'delivery') {
      checkout.fulfillment = act;
      $$('[data-act="pickup"],[data-act="delivery"]', panel).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.act === act)));
      $('#delivery-fields').hidden = act !== 'delivery';
      $('#pickup-note').hidden = act === 'delivery';
      $('#window-label').textContent = act === 'delivery' ? 'Best drop-off window' : 'Best pickup window';
      updateCheckoutUI();
      return;
    }
    if (act === 'apply-code') { applyCode(); return; }
    if (act === 'submit') { submitOrder(); }
  });

  panel.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.draft) { draft[t.dataset.draft] = t.value; updateDraftUI(); return; }
    if (t.dataset.co) {
      let v = t.value;
      if (t.dataset.co === 'zip') { v = v.replace(/\D/g, '').slice(0, 5); if (t.value !== v) t.value = v; }
      if (t.dataset.co === 'phone') { v = SN.formatPhone(v); if (t.value !== v) t.value = v; }
      if (t.dataset.co === 'code' && appliedCode && v.trim().toUpperCase() !== appliedCode.code.toUpperCase()) {
        appliedCode = null;   // editing an applied code un-applies it
        $('[data-act="apply-code"]', panel).textContent = 'Apply';
      }
      checkout[t.dataset.co] = v;
      const tw = t.type === 'time' && t.closest('.date-wrap');
      if (tw) tw.classList.toggle('has-value', !!v);   // hides the iPhone "Tap to pick" hint
      if (t.dataset.co === 'eventType') $('#other-wrap').hidden = v !== 'Other';
      updateCheckoutUI();
    }
  });
  panel.addEventListener('focusout', (e) => {
    const k = e.target.dataset && e.target.dataset.co;
    if ((k === 'email' || k === 'phone') && checkout[k] && !touched[k]) { touched[k] = true; updateCheckoutUI(); }
  });
  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'd-qty') { draft.qty = Math.max(cfg.minQty, parseInt(t.value, 10) || cfg.minQty); updateDraftUI(); return; }
    if (t.matches('select[data-fq]')) {
      const v = parseInt(t.value, 10) || 0;
      if (v) draft.fq[t.dataset.fq] = v; else delete draft.fq[t.dataset.fq];
      updateDraftUI();
      return;
    }
    if (t.id === 'd-photo') return;   // the photo picker handles it (SN.photoPicker)
    if (t.dataset.co) { checkout[t.dataset.co] = t.value; if (t.dataset.co === 'eventType') $('#other-wrap').hidden = t.value !== 'Other'; updateCheckoutUI(); }
  });

  /* ---------------- Actions ---------------- */
  function saveBag() {
    SN.setBag(bag);
    submissionId = '';   // a different bag is a different checkout
    const n = bag.reduce((a, it) => a + it.qty, 0);
    const c = $('#bag-count');
    if (c) c.textContent = n;
    if (bagBtn()) bagBtn().setAttribute('aria-label', 'Open bag, ' + n + ' items');
    document.dispatchEvent(new CustomEvent('sn:bag-changed'));   // e.g. the Events page's "1 in your bag" notes
  }

  function addToBag() {
    const st = draftState();
    if (st.err) { draftTried = true; updateDraftUI(); return; }
    if (draft.picker && draft.picker.busy()) {
      const e = $('#draft-err');
      e.hidden = false;
      e.textContent = 'One moment: your photos are still being prepared.';
      return;
    }
    const item = { id: Date.now(), kind: draft.kind };
    if (draft.kind === 'custom') {
      Object.assign(item, { qty: draft.qty, designs: draft.designs, desc: draft.desc.trim(), photos: draft.picker ? draft.picker.photos() : [] });
    } else {
      const names = {};
      cfg.flavors.forEach((f) => { if (draft.fq[f.id]) names[f.id] = f.name; });
      Object.assign(item, { qty: st.check.qty, fq: Object.assign({}, draft.fq), flavorNames: names });
    }
    bag.push(item);
    saveBag();
    closePanel();
    showToast(item.qty + ' ' + SN.itemLabel(item.kind) + ' added to your bag');
  }

  function submitOrder() {
    if (SN.isPreview()) {
      const box = $('#missing');
      box.hidden = false;
      box.innerHTML = '<strong>Preview mode:</strong> ordering is turned off while you preview changes.';
      return;
    }
    const miss = missingList();
    if (miss.length) { tried = true; updateCheckoutUI(); $('#missing').scrollIntoView({ block: 'nearest' }); return; }
    const btn = $('[data-act="submit"]', panel);
    const box = $('#missing');
    if (sending) return;
    if (navigator.onLine === false) {
      box.hidden = false;
      box.textContent = 'You appear to be offline. Check your internet connection and try again. Your bag is saved.';
      box.scrollIntoView({ block: 'nearest' });
      return;
    }
    sending = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.textContent = 'Sending…';
    box.hidden = true;
    // Kept across retries: if the first try actually went through, the server returns that same order.
    if (!submissionId) submissionId = SN.newSubmissionId();
    // Prices aren't sent: the Sheet re-prices every line and re-checks every rule.
    SN.post('submitOrder', {
      items: bag.map((it) => (it.kind === 'class'
        ? { kind: 'class', eventId: it.eventId, qty: it.qty }
        : { kind: it.kind, qty: it.qty, designs: it.designs, desc: it.desc, photos: it.photos || [], fq: it.fq })),
      eventType: checkout.eventType,
      eventOther: checkout.eventOther.trim(),
      dateNeeded: checkout.date,
      allergies: checkout.allergies.trim(),
      eventTime: SN.time12(checkout.eventTime),
      // One line for admin and the emails: "5:00 PM – 7:00 PM · Friday after 5 also works"
      pickupWindow: [SN.time12(checkout.winFrom) + ' – ' + SN.time12(checkout.winTo), checkout.winNote.trim()].filter(Boolean).join(' · '),
      fulfillment: checkout.fulfillment,
      address: { street: checkout.address.trim(), city: checkout.city.trim(), zip: checkout.zip },
      customer: { name: checkout.name.trim(), email: checkout.email.trim(), phone: checkout.phone.trim() },
      code: appliedCode ? appliedCode.code : '',
      submissionId,
      website: $('#c-website').value
    })
      .then((r) => { if (!r || !r.ok || !(r.orders || r.order)) throw r; orderSent(r.orders || [r.order]); })
      .catch((r) => {
        if (mode !== 'checkout') return;
        sending = false;
        const b = $('[data-act="submit"]', panel);
        b.removeAttribute('aria-disabled');
        b.textContent = submitLabel();
        const box2 = $('#missing');
        box2.hidden = false;
        box2.innerHTML = r && r.code === 'invalid' && r.errors
          ? '<strong>Still needed:</strong> ' + esc(r.errors.join(', '))
          : esc(SN.sendErrorText(r));
        box2.scrollIntoView({ block: 'nearest' });
      })
      .finally(() => { sending = false; });
  }

  function orderSent(orders) {
    // Test site only: keep a copy in this browser so the email preview link still works.
    if (SN_ENV.name === 'uat') { const saved = SN.getOrders(); orders.forEach((o) => saved.unshift(o)); SN.setOrders(saved); }
    lastOrders = orders;
    appliedCode = null;
    checkout.code = '';
    SN.dropCachedConfig();   // class spots changed
    bag = [];
    saveBag();
    tried = false;
    checkout.date = '';
    const wasOpen = panel.classList.contains('open');
    mode = 'done';
    renderPanel();
    if (!wasOpen) showPanel(bagBtn());   // they closed the bag while it was sending
    const c = $('[data-act="close"]', panel);
    if (c) c.focus();
    // Class only: straight on to Square's checkout. Square sends them back to order.html?paid=SN-x.
    const cls = orders.find((o) => o.type === 'Class');
    if (cls && cls.payUrl && orders.length === 1) setTimeout(() => { location.href = cls.payUrl; }, 1200);
  }

  /* ---------------- Back from Square (order.html?paid=SN-x) ---------------- */
  let paidInfo = null;        // { number, status, total, classes, payUrl } from checkClassPayment, or { error }
  let paidTries = 0;
  function renderPaid() {
    const p = paidInfo;
    let body;
    if (!p) body = '<h3>Checking your payment…</h3><p class="muted" style="margin:12px 0 0">This only takes a moment.</p>';
    else if (p.error) body = '<h3>We couldn’t check your booking</h3><p class="muted" style="margin:12px 0 0">' + esc(p.error) + ' If you paid, you’ll get a confirmation email shortly.</p>';
    else if (p.status === 'Paid' || p.status === 'Booked' || p.status === 'Completed') {
      body = '<div class="check">' + SN_ICONS.check + '</div><h3>You’re booked!</h3>' +
        '<p style="margin:10px 0 0;font-size:17px">Order number <strong>' + esc(p.number) + '</strong></p>' +
        p.classes.map((c) => '<p style="margin:12px 0 0"><strong>' + esc(c.title) + '</strong><br><span class="muted">' + esc(c.summary || '') + ' · ' + c.qty + ' spot' + (c.qty > 1 ? 's' : '') + '</span></p>').join('') +
        '<p class="muted" style="margin:12px 0 0">' + (p.status === 'Paid' ? 'Your payment went through. ' : '') + 'A confirmation email is on its way.</p>';
    } else if (p.status === 'Awaiting payment') {
      body = paidTries < 6
        ? '<h3>Checking your payment…</h3><p class="muted" style="margin:12px 0 0">Square can take a few seconds to let us know.</p>'
        : '<h3>We haven’t seen your payment yet</h3><p class="muted" style="margin:12px 0 0">If you finished paying, you’ll get a confirmation email within a few minutes. If not, your spot is held for ' + p.holdMinutes + ' minutes from when you booked.</p>' +
          (p.payUrl ? '<div class="stack" style="margin-top:16px;align-items:center"><a class="btn" href="' + esc(p.payUrl) + '">Finish paying ' + money(p.total) + '</a></div>' : '');
    } else {
      body = '<h3>This booking has ' + (p.status === 'Expired' ? 'expired' : 'been cancelled') + '</h3><p class="muted" style="margin:12px 0 0">' +
        (p.status === 'Expired' ? 'The ' + p.holdMinutes + '-minute hold ran out before the payment came through, so the spot was released. If you were charged, reply to any of our emails and we’ll sort it out, or book again from the Classes page.' : 'Questions? Send us a message.') + '</p>';
    }
    return fullHead('Your class booking', false) + '<div class="panel-body"><div class="checkout-col done">' + body +
      '<div class="stack" style="margin-top:24px;align-items:center"><button type="button" class="btn ghost" data-act="close">Back to the menu</button></div></div></div>';
  }
  function checkPaid(number) {
    SN.post('checkClassPayment', { number })
      .then((r) => { paidInfo = r && r.ok ? r : { error: (r && r.error) || 'Something went wrong.' }; })
      .catch((r) => { paidInfo = { error: SN.sendErrorText(r) }; })
      .then(() => {
        paidTries += 1;
        if (mode !== 'paid') return;
        renderPanel();
        if (paidInfo.status === 'Awaiting payment' && paidTries < 6) setTimeout(() => checkPaid(number), 4000);
      });
  }

  function showToast(text) {
    $('#toast-text').textContent = text;
    const t = $('#toast');
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4000);
  }
  function hideToast() { $('#toast').classList.remove('show'); }

  // Trap focus inside the open panel.
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('button:not([disabled]), [href], input, select, textarea', panel).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Opened from a home page card (order.html?add=custom|mini|large): straight to that item's options.
  const addKind = new URLSearchParams(location.search).get('add');
  if (['custom', 'mini', 'large'].indexOf(addKind) !== -1) {
    history.replaceState(null, '', location.pathname);
    if (cfg.acceptingOrders && !paused) openItem(addKind, $('[data-open="' + addKind + '"]'));
  }
  // Opened from another page's Bag link (order.html?bag=1)
  if (new URLSearchParams(location.search).get('bag')) {
    history.replaceState(null, '', location.pathname);
    openBag(bagBtn());
  }
  const paidNumber = new URLSearchParams(location.search).get('paid');
  if (paidNumber) {
    history.replaceState(null, '', location.pathname);
    mode = 'paid';
    renderPanel();
    showPanel(bagBtn());
    checkPaid(paidNumber);
  }
});
