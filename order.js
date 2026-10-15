/* Order page: menu, item slide-over, bag + checkout. */
(function () {
  const cfg = SN.load();
  let bag = SN.getBag();
  let mode = null;            // null | 'custom' | 'mini' | 'large' | 'bag' | 'done'
  let draft = null;
  let draftTried = false;
  let tried = false;
  let lastOrder = null;
  let opener = null;
  let toastTimer = null;
  const checkout = {
    eventType: '', eventOther: '', date: '', fulfillment: 'pickup',
    address: '', city: '', zip: '', name: '', email: '', phone: ''
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const panel = $('#panel');
  const scrim = $('#scrim');
  const money = SN.money;
  const esc = SN.esc;

  /* ---------------- Page setup ---------------- */
  $('#lead-days').textContent = cfg.leadDays;
  if (SN.specialActive(cfg)) {
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
  const lowestCustom = Math.min.apply(null, cfg.customTiers.map((t) => t.price));
  const menuItems = [
    { kind: 'custom', title: 'Custom Cookies', desc: 'Hand-decorated to your theme, with up to ' + cfg.maxDesigns + ' different designs per set. Tell us your vision and share an inspiration photo.', price: 'From ' + money(lowestCustom) + ' / cookie', small: '1 dozen min.', cta: 'Customize & add' },
    { kind: 'mini', title: 'Mini Artisan', desc: 'Bite-size classics. Mix up to ' + cfg.flavorsPerDozen + ' flavors per dozen, then add extras one at a time.', price: money(cfg.miniPerDozen) + ' / dozen', small: money(SN.perCookie(cfg, 'mini')) + ' each', cta: 'Choose flavors' },
    { kind: 'large', title: 'Large Artisan', desc: 'Big, bakery-style cookies. Mix up to ' + cfg.flavorsPerDozen + ' flavors per dozen, then add extras one at a time.', price: money(cfg.largePerDozen) + ' / dozen', small: money(SN.perCookie(cfg, 'large')) + ' each', cta: 'Choose flavors' }
  ];
  $('#menu').innerHTML = menuItems.map((m) => {
    const img = cfg.images && cfg.images[m.kind];
    return '<article class="card">' +
      '<div class="card-media" style="background:' + bg[m.kind] + '">' +
        (img ? '<img src="' + esc(img) + '" alt="' + esc(m.title) + '">' : art[m.kind] + '<span class="tag">Photo coming soon</span>') +
      '</div>' +
      '<div class="card-body">' +
        '<h3>' + esc(m.title) + '</h3>' +
        '<p class="desc">' + esc(m.desc) + '</p>' +
        '<p class="price">' + esc(m.price) + ' <span>· ' + esc(m.small) + '</span></p>' +
        '<button type="button" class="btn" data-open="' + m.kind + '"' + (cfg.acceptingOrders ? '' : ' aria-disabled="true"') + '>' + esc(m.cta) + '</button>' +
      '</div></article>';
  }).join('');
  if (!cfg.acceptingOrders) $('#closed-note').hidden = false;

  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (!b || !cfg.acceptingOrders) return;
    openItem(b.dataset.open, b);
  });
  const bagBtn = $('#bag-btn');
  if (bagBtn) bagBtn.addEventListener('click', (e) => openBag(e.currentTarget));
  $('#toast-view').addEventListener('click', () => openBag(bagBtn));
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
    panel.classList.remove('open');
    scrim.classList.remove('open');
    document.body.classList.remove('locked');
    if (opener && document.body.contains(opener)) opener.focus();
  }
  function openItem(kind, el) {
    mode = kind;
    draftTried = false;
    draft = kind === 'custom'
      ? { kind, qty: cfg.minQty, designs: 1, desc: '', photoName: '', photoUrl: '' }
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

  function tierHint() {
    return cfg.customTiers.slice().sort((a, b) => a.from - b.from).map((t) =>
      (t.from === t.to ? t.from + ' design' + (t.from > 1 ? 's' : '') : t.from + '–' + t.to + ' designs') + ' ' + money(t.price)
    ).join(' · ') + ' per cookie';
  }

  function renderPanel() {
    if (mode === 'custom') panel.innerHTML = renderCustom();
    else if (mode === 'mini' || mode === 'large') panel.innerHTML = renderArtisan();
    else if (mode === 'bag') panel.innerHTML = renderBag();
    else if (mode === 'done') panel.innerHTML = renderDone();
    if (mode === 'custom' || mode === 'mini' || mode === 'large') updateDraftUI();
    if (mode === 'bag') updateCheckoutUI();
  }

  function renderCustom() {
    let pills = '';
    for (let n = 1; n <= cfg.maxDesigns; n++) pills += '<button type="button" class="pill" data-act="design" data-n="' + n + '" aria-pressed="false">' + n + '</button>';
    return head('Custom Cookies', 'From ' + money(lowestCustom) + ' per cookie · 1 dozen minimum') +
      '<div class="panel-body"><div class="stack" style="gap:22px">' +
        '<div class="field"><span class="label" id="designs-label">How many different designs?</span>' +
          '<div class="row-gap" role="group" aria-labelledby="designs-label">' + pills + '</div>' +
          '<p class="hint">' + esc(tierHint()) + '</p></div>' +
        '<div class="field"><span class="label" id="qty-label">Quantity</span>' +
          '<div class="qty" role="group" aria-labelledby="qty-label">' +
            '<button type="button" class="step" data-act="qty-dec" aria-label="One fewer cookie">' + SN_ICONS.minus + '</button>' +
            '<output id="d-qty" style="font-size:24px;min-width:44px" aria-live="polite"></output>' +
            '<button type="button" class="step" data-act="qty-inc" aria-label="One more cookie">' + SN_ICONS.plus + '</button>' +
            '<span class="muted" style="font-size:14px">× <span id="d-each"></span> each</span>' +
          '</div><p class="hint">Minimum ' + cfg.minQty + '. Add more one at a time.</p></div>' +
        '<div class="field"><label class="label" for="d-desc">Describe your cookies</label>' +
          '<textarea class="input" id="d-desc" rows="5" data-draft="desc" placeholder="Theme, colors, names or wording, and how many of each design…"></textarea></div>' +
        '<div class="field"><span class="label">Inspiration photo (optional)</span>' +
          '<label class="upload" for="d-photo"><span id="d-photo-thumb">' + SN_ICONS.upload + '</span>' +
          '<span><strong id="d-photo-label">Upload an inspiration photo</strong><br><span class="hint">JPG or PNG, up to 10 MB</span></span>' +
          '<input type="file" id="d-photo" accept="image/*" class="sr-only"></label></div>' +
      '</div></div>' +
      '<div class="panel-foot"><p class="err" id="draft-err" hidden style="margin-bottom:10px"></p>' +
        '<button type="button" class="btn block" data-act="add" id="add-btn"></button></div>';
  }

  function renderArtisan() {
    const per = SN.perCookie(cfg, mode);
    const flavors = cfg.flavors.filter((f) => f.on);
    const rows = flavors.map((f) =>
      '<div class="flavor-row"><div><div style="font-weight:600">' + esc(f.name) + '</div>' +
        (f.special ? '<div class="badge">SPECIAL</div>' : '') + '</div>' +
      '<div class="qty">' +
        '<button type="button" class="step" data-act="f-dec" data-id="' + esc(f.id) + '" aria-label="One less ' + esc(f.name) + '">' + SN_ICONS.minus + '</button>' +
        '<output data-fq="' + esc(f.id) + '">0</output>' +
        '<button type="button" class="step" data-act="f-inc" data-id="' + esc(f.id) + '" aria-label="One more ' + esc(f.name) + '">' + SN_ICONS.plus + '</button>' +
      '</div></div>').join('');
    const title = mode === 'mini' ? 'Mini Artisan' : 'Large Artisan';
    const dozen = mode === 'mini' ? cfg.miniPerDozen : cfg.largePerDozen;
    return head(title, money(dozen) + ' per dozen · ' + money(per) + ' each') +
      '<div class="panel-body">' +
        '<p style="margin:0 0 6px">Pick your flavors. Mix up to ' + cfg.flavorsPerDozen + ' per dozen.</p>' +
        '<div style="border-top:1px solid var(--line);margin-top:10px">' + (rows || '<p class="hint" style="padding:14px 0">No flavors are available right now.</p>') + '</div>' +
        '<div class="row-gap" style="margin-top:16px"><button type="button" class="btn ghost small" data-act="f-clear">Clear</button></div>' +
        '<p class="hint" id="art-msg" style="margin-top:14px;font-size:14px" aria-live="polite"></p>' +
      '</div>' +
      '<div class="panel-foot"><button type="button" class="btn block" data-act="add" id="add-btn"></button></div>';
  }

  function draftState() {
    if (draft.kind === 'custom') {
      const each = SN.tierPrice(cfg, draft.designs);
      const err = draft.desc.trim() ? '' : 'Please describe your cookies.';
      return { total: draft.qty * each, each, err };
    }
    const c = SN.artisanCheck(cfg, draft.fq);
    return { total: c.qty * SN.perCookie(cfg, draft.kind), err: c.err, check: c };
  }

  function updateDraftUI() {
    const st = draftState();
    if (draft.kind === 'custom') {
      $('#d-qty').textContent = draft.qty;
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
      $$('[data-fq]', panel).forEach((o) => { o.textContent = draft.fq[o.dataset.fq] || 0; });
      $$('[data-act="f-dec"]', panel).forEach((b) => { b.disabled = !(draft.fq[b.dataset.id] > 0); });
      const c = st.check;
      const msg = $('#art-msg');
      if (c.err) {
        msg.textContent = c.err;
        msg.style.color = draftTried || c.used > c.max ? 'var(--error)' : 'var(--muted)';
      } else {
        msg.textContent = c.qty + ' cookies · ' + c.used + ' of ' + c.max + ' flavors used';
        msg.style.color = 'var(--muted)';
      }
    }
    const add = $('#add-btn');
    add.textContent = 'Add to bag · ' + money(st.total);
    add.setAttribute('aria-disabled', String(!!st.err));
  }

  function renderBag() {
    if (!bag.length) {
      return head('Your bag') +
        '<div class="panel-body"><div class="done"><p style="font-size:17px;margin:0">Your bag is empty.</p>' +
        '<button type="button" class="btn" data-act="close" style="margin-top:18px">Browse the menu</button></div></div>';
    }
    const items = bag.map((it) =>
      '<div class="bag-item"><div class="top"><strong>' + it.qty + ' ' + esc(SN.itemLabel(it.kind)) + '</strong><strong>' + money(SN.itemTotal(cfg, it)) + '</strong></div>' +
      '<div class="detail">' + esc(SN.describeItem(cfg, it)) + '</div>' +
      (it.desc ? '<div class="note">“' + esc(it.desc) + '”</div>' : '') +
      '<button type="button" class="link-btn" data-act="remove" data-id="' + it.id + '">Remove</button></div>').join('');
    const minISO = SN.isoDate(SN.minDate(cfg));
    const events = ['Birthday', 'Baby Shower', 'Wedding Shower', 'Anniversary', 'Party', 'Other'];
    const isDel = checkout.fulfillment === 'delivery';
    return head('Your bag') +
      '<div class="panel-body">' +
        items +
        '<button type="button" class="btn dashed" data-act="close" style="margin-top:14px">+ Add more cookies</button>' +

        '<div class="sec"><h3>Your event</h3><div class="stack">' +
          '<div class="field"><label class="label" for="c-event">What are the cookies for?</label>' +
            '<select class="input" id="c-event" data-co="eventType"><option value="">Choose one…</option>' +
            events.map((e) => '<option' + (checkout.eventType === e ? ' selected' : '') + '>' + e + '</option>').join('') + '</select></div>' +
          '<div class="field" id="other-wrap"' + (checkout.eventType === 'Other' ? '' : ' hidden') + '><label class="label" for="c-other">Tell us the occasion</label>' +
            '<input class="input" id="c-other" type="text" data-co="eventOther" placeholder="e.g. Graduation, corporate gift" value="' + esc(checkout.eventOther) + '"></div>' +
          '<div class="field"><label class="label" for="c-date">Date you need them</label>' +
            '<input class="input" id="c-date" type="date" data-co="date" min="' + minISO + '" value="' + esc(checkout.date) + '">' +
            '<p class="hint" id="date-msg">Earliest available: ' + esc(SN.prettyDate(minISO)) + '</p></div>' +
        '</div></div>' +

        '<div class="sec"><h3>Pickup or drop-off</h3>' +
          '<div class="grid-2" role="group" aria-label="Pickup or drop-off">' +
            '<button type="button" class="choice" data-act="pickup" aria-pressed="' + !isDel + '"><strong>Pickup · Free</strong><span>' + esc(cfg.pickupCity) + '</span></button>' +
            '<button type="button" class="choice" data-act="delivery" aria-pressed="' + isDel + '"><strong>Drop-off · ' + esc(feeRange()) + '</strong><span>Based on ZIP code</span></button>' +
          '</div>' +
          '<div class="grid-2" id="delivery-fields" style="margin-top:14px"' + (isDel ? '' : ' hidden') + '>' +
            '<div class="field full"><label class="label" for="c-address">Street address</label><input class="input" id="c-address" type="text" autocomplete="street-address" data-co="address" value="' + esc(checkout.address) + '"></div>' +
            '<div class="field"><label class="label" for="c-city">City</label><input class="input" id="c-city" type="text" autocomplete="address-level2" data-co="city" value="' + esc(checkout.city) + '"></div>' +
            '<div class="field"><label class="label" for="c-zip">ZIP code</label><input class="input" id="c-zip" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="5" data-co="zip" value="' + esc(checkout.zip) + '"></div>' +
            '<p class="hint full" id="zip-msg" aria-live="polite"></p>' +
          '</div>' +
        '</div>' +

        '<div class="sec"><h3>Your details</h3><div class="stack">' +
          '<div class="field"><label class="label" for="c-name">Full name</label><input class="input" id="c-name" type="text" autocomplete="name" data-co="name" value="' + esc(checkout.name) + '"></div>' +
          '<div class="grid-2">' +
            '<div class="field"><label class="label" for="c-email">Email</label><input class="input" id="c-email" type="email" autocomplete="email" data-co="email" value="' + esc(checkout.email) + '"></div>' +
            '<div class="field"><label class="label" for="c-phone">Phone</label><input class="input" id="c-phone" type="tel" autocomplete="tel" data-co="phone" value="' + esc(checkout.phone) + '"></div>' +
          '</div>' +
        '</div></div>' +

        '<div class="sec totals">' +
          '<div><span class="muted">Subtotal</span><span id="t-sub"></span></div>' +
          '<div><span class="muted">Grocery tax (' + cfg.taxRate + '%)</span><span id="t-tax"></span></div>' +
          '<div><span class="muted" id="t-fee-label"></span><span id="t-fee"></span></div>' +
        '</div>' +
      '</div>' +
      '<div class="panel-foot">' +
        '<div class="grand"><strong>Total</strong><strong id="t-total"></strong></div>' +
        '<div class="missing" id="missing" hidden></div>' +
        '<button type="button" class="btn block" data-act="submit">Place order</button>' +
        '<p class="hint" style="text-align:center;margin-top:10px">No payment today. You’ll get a QuickBooks invoice once M confirms your order.</p>' +
      '</div>';
  }

  function feeRange() {
    const fees = cfg.zones.map((z) => Number(z.fee));
    if (!fees.length) return 'not available';
    const lo = Math.min.apply(null, fees), hi = Math.max.apply(null, fees);
    return lo === hi ? money(lo) : '$' + lo + '–$' + hi;
  }

  function quote() {
    const subtotal = bag.reduce((a, it) => a + SN.itemTotal(cfg, it), 0);
    const tax = Math.round(subtotal * cfg.taxRate) / 100;
    const isDel = checkout.fulfillment === 'delivery';
    const zone = cfg.zones.find((z) => z.zip === checkout.zip);
    const fee = isDel && zone ? Number(zone.fee) : 0;
    return { subtotal, tax, fee, zone, isDel, total: subtotal + tax + fee };
  }

  function missingList() {
    const m = [];
    const minISO = SN.isoDate(SN.minDate(cfg));
    if (!checkout.eventType) m.push('event type');
    else if (checkout.eventType === 'Other' && !checkout.eventOther.trim()) m.push('the occasion');
    if (!checkout.date) m.push('date needed');
    else if (checkout.date < minISO) m.push('a date at least ' + cfg.leadDays + ' days out');
    else if (cfg.blockedDates.includes(checkout.date)) m.push('a different date (that day is booked)');
    const q = quote();
    if (q.isDel) {
      if (!checkout.address.trim() || !checkout.city.trim()) m.push('drop-off address');
      if (!q.zone) m.push('a ZIP in our drop-off area');
    }
    if (!checkout.name.trim()) m.push('name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checkout.email.trim())) m.push('a valid email');
    if (checkout.phone.replace(/\D/g, '').length < 10) m.push('a phone number');
    return m;
  }

  function updateCheckoutUI() {
    if (!bag.length) return;
    const q = quote();
    $('#t-sub').textContent = money(q.subtotal);
    $('#t-tax').textContent = money(q.tax);
    $('#t-fee-label').textContent = q.isDel ? 'Drop-off' : 'Pickup (' + cfg.pickupCity + ')';
    $('#t-fee').textContent = q.isDel ? (q.zone ? money(q.fee) : '—') : 'Free';
    $('#t-total').textContent = money(q.total);

    const zipMsg = $('#zip-msg');
    if (zipMsg) {
      if (checkout.zip.length < 5) { zipMsg.textContent = 'Enter your ZIP to see the drop-off fee.'; zipMsg.style.color = ''; }
      else if (q.zone) { zipMsg.textContent = 'Drop-off to ' + checkout.zip + ' (' + q.zone.area + '): ' + money(q.fee); zipMsg.style.color = ''; }
      else { zipMsg.textContent = 'Sorry, ' + checkout.zip + ' is outside our drop-off area. Pickup in ' + cfg.pickupCity + ' is free.'; zipMsg.style.color = 'var(--error)'; }
    }
    const dateMsg = $('#date-msg');
    if (dateMsg) {
      const minISO = SN.isoDate(SN.minDate(cfg));
      if (checkout.date && checkout.date < minISO) { dateMsg.textContent = 'Please choose ' + SN.prettyDate(minISO) + ' or later.'; dateMsg.style.color = 'var(--error)'; }
      else if (checkout.date && cfg.blockedDates.includes(checkout.date)) { dateMsg.textContent = 'Sorry, ' + SN.prettyDate(checkout.date) + ' is fully booked. Please pick another day.'; dateMsg.style.color = 'var(--error)'; }
      else if (checkout.date) { dateMsg.textContent = SN.prettyDate(checkout.date); dateMsg.style.color = ''; }
      else { dateMsg.textContent = 'Earliest available: ' + SN.prettyDate(minISO); dateMsg.style.color = ''; }
    }
    const miss = missingList();
    const box = $('#missing');
    box.hidden = !(tried && miss.length);
    box.innerHTML = '<strong>Still needed:</strong> ' + esc(miss.join(', '));
  }

  function renderDone() {
    const o = lastOrder;
    return head('Order placed') +
      '<div class="panel-body"><div class="done">' +
        '<div class="check">' + SN_ICONS.check + '</div>' +
        '<h3>Your order is in!</h3>' +
        '<p style="margin:10px 0 0;font-size:17px">Order number <strong>' + esc(o.number) + '</strong></p>' +
        '<p class="muted" style="margin:12px 0 0">A confirmation is on its way to ' + esc(o.customer.email) + '. M will review your order and send a QuickBooks invoice so you can pay by card or bank transfer.</p>' +
        '<p style="margin:20px 0 0;font-family:var(--serif);font-size:30px;font-weight:600">Total ' + money(o.total) + '</p>' +
        '<div class="stack" style="margin-top:24px;align-items:center">' +
          '<a class="btn ghost" href="email.html?o=' + encodeURIComponent(o.number) + '" target="_blank" rel="noopener">Preview the confirmation email</a>' +
          '<button type="button" class="btn" data-act="close">Back to the menu</button>' +
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
    if (act === 'pickup' || act === 'delivery') {
      checkout.fulfillment = act;
      $$('[data-act="pickup"],[data-act="delivery"]', panel).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.act === act)));
      $('#delivery-fields').hidden = act !== 'delivery';
      updateCheckoutUI();
      return;
    }
    if (act === 'submit') { submitOrder(); }
  });

  panel.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.draft) { draft[t.dataset.draft] = t.value; updateDraftUI(); return; }
    if (t.dataset.co) {
      let v = t.value;
      if (t.dataset.co === 'zip') { v = v.replace(/\D/g, '').slice(0, 5); if (t.value !== v) t.value = v; }
      checkout[t.dataset.co] = v;
      if (t.dataset.co === 'eventType') $('#other-wrap').hidden = v !== 'Other';
      updateCheckoutUI();
    }
  });
  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'd-photo') {
      const f = t.files && t.files[0];
      if (draft.photoUrl) URL.revokeObjectURL(draft.photoUrl);
      draft.photoName = f ? f.name : '';
      draft.photoUrl = f ? URL.createObjectURL(f) : '';
      $('#d-photo-label').textContent = f ? 'Attached: ' + f.name : 'Upload an inspiration photo';
      $('#d-photo-thumb').innerHTML = f ? '<img src="' + draft.photoUrl + '" alt="">' : SN_ICONS.upload;
      return;
    }
    if (t.dataset.co) { checkout[t.dataset.co] = t.value; if (t.dataset.co === 'eventType') $('#other-wrap').hidden = t.value !== 'Other'; updateCheckoutUI(); }
  });

  /* ---------------- Actions ---------------- */
  function saveBag() {
    SN.setBag(bag);
    const n = bag.reduce((a, it) => a + it.qty, 0);
    const c = $('#bag-count');
    if (c) c.textContent = n;
    if (bagBtn) bagBtn.setAttribute('aria-label', 'Open bag, ' + n + ' cookies');
  }

  function addToBag() {
    const st = draftState();
    if (st.err) { draftTried = true; updateDraftUI(); return; }
    const item = { id: Date.now(), kind: draft.kind };
    if (draft.kind === 'custom') {
      Object.assign(item, { qty: draft.qty, designs: draft.designs, desc: draft.desc.trim(), photoName: draft.photoName });
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
    const miss = missingList();
    if (miss.length) { tried = true; updateCheckoutUI(); $('#missing').scrollIntoView({ block: 'nearest' }); return; }
    const q = quote();
    const order = {
      number: SN.nextOrderNumber(),
      createdAt: new Date().toISOString(),
      status: 'New',
      items: bag.map((it) => Object.assign({}, it, { lineTotal: SN.itemTotal(cfg, it), summary: SN.describeItem(cfg, it) })),
      eventType: checkout.eventType === 'Other' ? 'Other: ' + checkout.eventOther.trim() : checkout.eventType,
      dateNeeded: checkout.date,
      fulfillment: checkout.fulfillment,
      address: q.isDel ? { street: checkout.address.trim(), city: checkout.city.trim(), zip: checkout.zip } : null,
      customer: { name: checkout.name.trim(), email: checkout.email.trim(), phone: checkout.phone.trim() },
      subtotal: q.subtotal, tax: q.tax, deliveryFee: q.fee, total: q.total, taxRate: cfg.taxRate
    };
    const orders = SN.getOrders();
    orders.unshift(order);
    SN.setOrders(orders);
    lastOrder = order;
    bag = [];
    saveBag();
    tried = false;
    checkout.date = '';
    mode = 'done';
    renderPanel();
    const c = $('[data-act="close"]', panel);
    if (c) c.focus();
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

  // Opened from another page's Bag link (index.html?bag=1)
  if (new URLSearchParams(location.search).get('bag')) {
    history.replaceState(null, '', location.pathname);
    openBag(bagBtn);
  }
})();
