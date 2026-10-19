/* Owner admin page (prototype: saves to this browser). */
(function () {
  let cfg = SN.load({ ignorePreview: true });
  let dirty = false;
  let toastTimer = null;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = SN.esc;
  const money = SN.money;

  function markDirty() { dirty = true; $('#save-bar').classList.add('show'); }
  function toast(msg) {
    $('#toast-text').textContent = msg;
    $('#toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2600);
  }

  /* ---------- Simple fields (data-path) ---------- */
  function fillFields() {
    $$('[data-path]').forEach((el) => {
      const v = cfg[el.dataset.path];
      el.value = v == null ? '' : v;
    });
    const sw = $('#accepting');
    sw.setAttribute('aria-checked', String(!!cfg.acceptingOrders));
    $('#accepting-text').textContent = cfg.acceptingOrders ? 'Open' : 'Paused';
  }
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.path) {
      let v = el.value;
      if (el.dataset.type === 'int') v = v === '' ? 0 : parseInt(v, 10);
      if (el.dataset.type === 'num') v = v === '' ? 0 : parseFloat(v);
      cfg[el.dataset.path] = v;
      markDirty();
      return;
    }
    if (el.dataset.list) {
      const list = cfg[el.dataset.list];
      const i = Number(el.dataset.i);
      let v = el.value;
      if (el.dataset.type === 'num') v = v === '' ? 0 : parseFloat(v);
      if (el.dataset.type === 'int') v = v === '' ? 0 : parseInt(v, 10);
      if (el.dataset.key === 'zip') { v = v.replace(/\D/g, '').slice(0, 5); if (el.value !== v) el.value = v; }
      list[i][el.dataset.key] = v;
      markDirty();
    }
  });
  $('#accepting').addEventListener('click', () => {
    cfg.acceptingOrders = !cfg.acceptingOrders;
    fillFields();
    markDirty();
  });

  /* ---------- Orders ---------- */
  const STATUS_STYLE = {
    'Pending review': 'background:#FDF0D5;color:#7A4B00',
    'Invoice sent': 'background:#E4E9F3;color:#1F2A44',
    'Paid': 'background:#DDEFE3;color:#1E5A35',
    'Baking': 'background:#F7E3DD;color:#8E3A2E',
    'Ready': 'background:#DDEFE3;color:#1E5A35',
    'Completed': 'background:#EDEDED;color:#3D4250',
    'Declined': 'background:#EDEDED;color:#3D4250'
  };
  const AFTER_INVOICE = ['Invoice sent', 'Paid', 'Baking', 'Ready', 'Completed'];
  const badge = (st) => '<span class="status-badge" style="' + (STATUS_STYLE[st] || '') + '">' + esc(st) + '</span>';

  function renderOrders() {
    const orders = SN.getOrders();
    const body = $('#orders-body');
    const pending = orders.filter((o) => SN.normStatus(o.status) === 'Pending review').length;
    $('#orders-h').innerHTML = 'Orders' + (pending ? ' <span class="count-pill">' + pending + ' to review</span>' : '');
    if (!orders.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="9">No orders yet. Place a test order on the <a href="order.html">order page</a>, or <button type="button" class="link-btn" data-rv="sample" style="font-size:inherit">add a sample order</button> to try the approval flow.</td></tr>';
      return;
    }
    body.innerHTML = orders.map((o, i) => {
      const st = SN.normStatus(o.status);
      const items = o.items.map((it) => esc(it.qty + ' ' + SN.itemLabel(it.kind))).join('<br>');
      const ful = o.fulfillment === 'delivery' && o.address ? 'Drop-off · ' + esc(o.address.zip) : 'Pickup';
      const total = o.invoice
        ? '<strong>' + money(o.invoice.total) + '</strong>' + (o.invoice.changed ? '<br><span class="muted" style="font-size:12px">was est. ' + money(o.total) + '</span>' : '')
        : money(o.total) + '<br><span class="muted" style="font-size:12px">estimate</span>';
      const status = AFTER_INVOICE.includes(st)
        ? '<label class="sr-only" for="st-' + i + '">Status for ' + esc(o.number) + '</label><select class="status" id="st-' + i + '" data-order="' + i + '">' +
            AFTER_INVOICE.map((s) => '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>'
        : badge(st);
      const action = st === 'Pending review'
        ? '<button type="button" class="btn small" data-rv="open" data-i="' + i + '">Review</button>'
        : '<button type="button" class="btn ghost small" data-rv="open" data-i="' + i + '">View</button>';
      return '<tr' + (st === 'Pending review' ? ' class="row-pending"' : '') + '>' +
        '<td class="nowrap"><strong>' + esc(o.number) + '</strong></td>' +
        '<td>' + esc(o.customer.name) + '<br><span class="muted" style="font-size:13px">' + esc(o.customer.email) + '</span></td>' +
        '<td class="nowrap">' + esc(SN.prettyDate(o.dateNeeded, { month: 'short', day: 'numeric', year: 'numeric' })) + '</td>' +
        '<td>' + esc(o.eventType) + '</td>' +
        '<td class="nowrap">' + items + '</td>' +
        '<td class="nowrap">' + ful + '</td>' +
        '<td class="nowrap">' + total + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + action + '</td>' +
        '</tr>';
    }).join('');
  }
  $('#orders-body').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-order]');
    if (!sel) return;
    const orders = SN.getOrders();
    orders[Number(sel.dataset.order)].status = sel.value;
    SN.setOrders(orders);
    toast(orders[Number(sel.dataset.order)].number + ' marked ' + sel.value);
  });
  $('#clear-orders').addEventListener('click', () => {
    if (!confirm('Clear all demo orders from this browser?')) return;
    SN.setOrders([]);
    renderOrders();
    toast('Demo orders cleared');
  });

  /* ---------- Review / approve panel ---------- */
  const review = $('#review');
  const scrim = $('#scrim');
  let rv = null;        // { i, lines, fee, note, original, declining, declineNote }
  let rvOpener = null;

  function addSampleOrder() {
    const d = SN.minDate(cfg); d.setDate(d.getDate() + 4);
    const items = [
      { id: 1, kind: 'custom', qty: 24, designs: 3, desc: 'Soft pink and gold, "Oh Baby" plaques, onesies and baby blocks, 8 of each.', photoName: 'inspo.jpg' },
      { id: 2, kind: 'mini', qty: 12, fq: { cc: 6, ff: 6 }, flavorNames: { cc: 'Chocolate Chip', ff: 'Funfetti' } }
    ];
    items.forEach((it) => { it.lineTotal = SN.itemTotal(cfg, it); it.summary = SN.describeItem(cfg, it); });
    const subtotal = items.reduce((a, it) => a + it.lineTotal, 0);
    const tax = Math.round(subtotal * cfg.taxRate) / 100;
    const o = {
      number: SN.nextOrderNumber(), createdAt: new Date().toISOString(), status: 'Pending review',
      items, eventType: 'Baby Shower', dateNeeded: SN.isoDate(d), fulfillment: 'delivery',
      address: { street: '123 Main St', city: 'Des Plaines', zip: '60016' },
      customer: { name: 'Sample Customer', email: 'customer@example.com', phone: '(847) 555-0100' },
      subtotal, tax, deliveryFee: 5, total: subtotal + tax + 5, taxRate: cfg.taxRate
    };
    const orders = SN.getOrders(); orders.unshift(o); SN.setOrders(orders);
    renderOrders();
    toast('Sample order ' + o.number + ' added. Click Review to try it.');
  }

  function openReview(i, el) {
    const o = SN.getOrders()[i];
    const lines = o.invoice ? SN.clone(o.invoice.lines) : SN.linesFromOrder(cfg, o);
    const fee = o.invoice ? o.invoice.fee : (o.fulfillment === 'delivery' ? Number(o.deliveryFee) || 0 : 0);
    rv = { i, lines, fee, note: o.invoice ? o.invoice.note || '' : '', declining: false, declineNote: '' };
    rv.original = JSON.stringify({ lines: SN.linesFromOrder(cfg, o), fee: o.fulfillment === 'delivery' ? Number(o.deliveryFee) || 0 : 0 });
    rvOpener = el || document.activeElement;
    renderReview();
    review.classList.add('open');
    scrim.classList.add('open');
    document.body.classList.add('locked');
    setTimeout(() => { const c = $('[data-rv="close"]', review); (c || review).focus(); }, 60);
  }
  function closeReview() {
    review.classList.remove('open');
    scrim.classList.remove('open');
    document.body.classList.remove('locked');
    rv = null;
    if (rvOpener && document.body.contains(rvOpener)) rvOpener.focus();
  }
  scrim.addEventListener('click', closeReview);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && rv) closeReview(); });

  function isChanged() {
    const clean = rv.lines.map((l) => ({ desc: l.desc, qty: Number(l.qty), unit: Math.round(Number(l.unit) * 100) / 100 }));
    const orig = JSON.parse(rv.original);
    const origClean = orig.lines.map((l) => ({ desc: l.desc, qty: Number(l.qty), unit: Math.round(Number(l.unit) * 100) / 100 }));
    return JSON.stringify(clean) !== JSON.stringify(origClean) || Number(rv.fee) !== Number(orig.fee);
  }

  function requestHtml(o) {
    const it = o.items.map((x) =>
      '<div class="rv-item"><div style="display:flex;justify-content:space-between;gap:12px"><strong>' + x.qty + ' ' + esc(SN.itemLabel(x.kind)) + '</strong><span class="muted">est. ' + money(x.lineTotal) + '</span></div>' +
      '<div class="hint">' + esc(x.summary || SN.describeItem(cfg, x)) + '</div>' +
      (x.desc ? '<div class="rv-quote">“' + esc(x.desc) + '”</div>' : '') +
      (x.photoName ? '<div class="hint" style="margin-top:4px">Inspiration photo: <strong>' + esc(x.photoName) + '</strong> <span class="muted">(saved to Google Drive in the real site)</span></div>' : '') +
      '</div>').join('');
    const where = o.fulfillment === 'delivery' && o.address
      ? 'Drop-off · ' + esc(o.address.street) + ', ' + esc(o.address.city) + ' ' + esc(o.address.zip)
      : 'Pickup in ' + esc(cfg.pickupCity);
    return '<div class="rv-facts">' +
        '<div><div class="k">Customer</div><div class="v">' + esc(o.customer.name) + '</div><div class="hint">' + esc(o.customer.email) + '<br>' + esc(o.customer.phone) + '</div></div>' +
        '<div><div class="k">Needed by</div><div class="v">' + esc(SN.prettyDate(o.dateNeeded)) + '</div><div class="hint">' + esc(o.eventType) + '</div></div>' +
        '<div style="grid-column:1 / -1"><div class="k">Pickup / drop-off</div><div class="v">' + where + '</div></div>' +
        (o.allergies ? '<div style="grid-column:1 / -1"><div class="k" style="color:var(--error)">Allergies / dietary needs</div><div class="v">' + esc(o.allergies) + '</div></div>' : '') +
      '</div>' +
      '<h3 class="rv-h">What they asked for</h3>' + it +
      '<div class="hint" style="margin-top:8px">Estimate shown to customer: <strong>' + money(o.total) + '</strong></div>';
  }

  function renderReview() {
    const o = SN.getOrders()[rv.i];
    const st = SN.normStatus(o.status);
    const head = '<div class="panel-head"><div><h2 id="review-title">' + (st === 'Pending review' ? 'Review ' : '') + esc(o.number) + '</h2><p>' + badge(st) + '</p></div>' +
      '<button type="button" class="x-btn" data-rv="close" aria-label="Close">' + SN_ICONS.close + '</button></div>';

    if (st !== 'Pending review') {
      let bodyHtml = requestHtml(o);
      let foot = '';
      if (o.invoice) {
        bodyHtml += '<h3 class="rv-h">Invoice sent</h3>' +
          o.invoice.lines.map((l) => '<div class="rv-line"><span>' + esc(l.desc) + ' <span class="muted">(' + l.qty + ' × ' + money(Number(l.unit)) + ')</span></span><span>' + money(l.qty * l.unit) + '</span></div>').join('') +
          '<div class="totals" style="margin-top:10px">' +
            '<div><span class="muted">Grocery tax (' + o.taxRate + '%)</span><span>' + money(o.invoice.tax) + '</span></div>' +
            (o.fulfillment === 'delivery' ? '<div><span class="muted">Drop-off</span><span>' + money(o.invoice.fee) + '</span></div>' : '') +
            '<div><strong>Invoice total</strong><strong>' + money(o.invoice.total) + '</strong></div>' +
          '</div>' +
          (o.invoice.note ? '<div class="rv-quote" style="margin-top:12px">Your note: “' + esc(o.invoice.note) + '”</div>' : '') +
          '<p class="hint" style="margin-top:12px">Sent ' + esc(new Date(o.invoice.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + ' to ' + esc(o.customer.email) + (o.invoice.changed ? ' · approved with changes' : ' · approved as requested') + '</p>';
        foot = '<div class="stack"><a class="btn ghost block" href="email.html?o=' + encodeURIComponent(o.number) + '&type=invoice" target="_blank" rel="noopener">Preview the email the customer got</a>' +
          '<button type="button" class="btn block" data-rv="resend">Resend invoice</button></div>';
      } else if (st === 'Declined') {
        bodyHtml += '<h3 class="rv-h">Declined</h3>' + (o.declineNote ? '<div class="rv-quote">“' + esc(o.declineNote) + '”</div>' : '<p class="hint">No note was included.</p>');
        foot = '<a class="btn ghost block" href="email.html?o=' + encodeURIComponent(o.number) + '&type=declined" target="_blank" rel="noopener">Preview the email the customer got</a>';
      }
      review.innerHTML = head + '<div class="panel-body">' + bodyHtml + '</div>' + (foot ? '<div class="panel-foot">' + foot + '</div>' : '');
      return;
    }

    const rows = rv.lines.map((l, j) =>
      '<div class="inv-row">' +
        '<div class="field inv-desc"><label class="sr-only" for="ld-' + j + '">Line ' + (j + 1) + ' description</label><input class="input" id="ld-' + j + '" type="text" data-inv="desc" data-j="' + j + '" value="' + esc(l.desc) + '"></div>' +
        '<div class="field inv-qty"><label class="label" for="lq-' + j + '">Qty</label><input class="input" id="lq-' + j + '" type="number" min="0" data-inv="qty" data-j="' + j + '" value="' + l.qty + '"></div>' +
        '<div class="field inv-unit"><label class="label" for="lu-' + j + '">Each</label><div class="input-wrap"><span>$</span><input id="lu-' + j + '" type="number" step="0.25" data-inv="unit" data-j="' + j + '" value="' + l.unit + '"></div></div>' +
        '<div class="inv-amt" data-amt="' + j + '"></div>' +
        '<button type="button" class="icon-del" data-rv="del-line" data-j="' + j + '" aria-label="Remove line ' + (j + 1) + '">' + SN_ICONS.trash + '</button>' +
      '</div>').join('');

    const body =
      requestHtml(o) +
      '<h3 class="rv-h">Invoice</h3>' +
      '<p class="hint" style="margin:-6px 0 10px">Starts from what they ordered. Change prices or quantities, or add a line for extras or a discount (use a negative price).</p>' +
      rows +
      '<button type="button" class="btn dashed small" data-rv="add-line" style="margin-top:6px">+ Add a line</button>' +
      (o.fulfillment === 'delivery'
        ? '<div class="field" style="margin-top:16px;max-width:200px"><label class="label" for="inv-fee">Drop-off fee</label><div class="input-wrap"><span>$</span><input id="inv-fee" type="number" min="0" step="1" data-inv="fee" value="' + rv.fee + '"></div></div>'
        : '') +
      '<div class="totals" style="margin-top:16px">' +
        '<div><span class="muted">Subtotal</span><span id="inv-sub"></span></div>' +
        '<div><span class="muted">Grocery tax (' + o.taxRate + '%)</span><span id="inv-tax"></span></div>' +
        (o.fulfillment === 'delivery' ? '<div><span class="muted">Drop-off</span><span id="inv-feeval"></span></div>' : '') +
      '</div>' +
      '<div class="field" style="margin-top:18px"><label class="label" for="inv-note">Note to the customer <span class="muted" style="font-weight:400" id="note-hint">(optional)</span></label>' +
        '<textarea class="input" id="inv-note" rows="3" data-inv="note" placeholder="e.g. Can’t wait to make these! I added $1 per cookie for the hand-painted details.">' + esc(rv.note) + '</textarea></div>';

    const foot = rv.declining
      ? '<div class="stack">' +
          '<div class="field"><label class="label" for="decline-note">Message to the customer</label><textarea class="input" id="decline-note" rows="3" data-inv="declineNote" placeholder="e.g. I’m fully booked that weekend, but I’d love to help with another date!">' + esc(rv.declineNote) + '</textarea></div>' +
          '<div class="row-gap"><button type="button" class="btn ghost small" data-rv="decline-cancel">Back</button><button type="button" class="btn navy small" data-rv="decline-send">Decline &amp; email customer</button></div>' +
        '</div>'
      : '<div class="grand"><strong>Invoice total</strong><strong id="inv-total"></strong></div>' +
        '<p class="hint" id="inv-diff" style="margin:-4px 0 12px"></p>' +
        '<p class="err" id="inv-err" hidden style="margin-bottom:10px"></p>' +
        '<button type="button" class="btn block" data-rv="approve" id="approve-btn"></button>' +
        '<div style="text-align:center;margin-top:8px"><button type="button" class="link-btn" data-rv="decline">Can’t take this order? Decline it</button></div>';

    review.innerHTML = head + '<div class="panel-body">' + body + '</div><div class="panel-foot">' + foot + '</div>';
    updateReviewTotals();
  }

  function updateReviewTotals() {
    if (!rv || rv.declining) return;
    const o = SN.getOrders()[rv.i];
    if (SN.normStatus(o.status) !== 'Pending review') return;
    const t = SN.invoiceTotals(rv.lines, rv.fee, o.taxRate);
    rv.lines.forEach((l, j) => { const el = $('[data-amt="' + j + '"]', review); if (el) el.textContent = money((Number(l.qty) || 0) * (Number(l.unit) || 0)); });
    $('#inv-sub').textContent = money(t.subtotal);
    $('#inv-tax').textContent = money(t.tax);
    if ($('#inv-feeval')) $('#inv-feeval').textContent = money(t.fee);
    $('#inv-total').textContent = money(t.total);
    const changed = isChanged();
    const diff = Math.round((t.total - o.total) * 100) / 100;
    $('#inv-diff').textContent = changed
      ? 'Changed from the ' + money(o.total) + ' estimate (' + (diff >= 0 ? '+' : '−') + money(Math.abs(diff)) + '). Add a note so they know why.'
      : 'Same as the estimate the customer saw.';
    $('#note-hint').textContent = changed ? '(recommended since the price changed)' : '(optional)';
    $('#approve-btn').textContent = (changed ? 'Approve with changes' : 'Approve') + ' & send invoice · ' + money(t.total);
  }

  review.addEventListener('input', (e) => {
    const t = e.target;
    if (!rv || !t.dataset.inv) return;
    const k = t.dataset.inv;
    if (k === 'note') { rv.note = t.value; return; }
    if (k === 'declineNote') { rv.declineNote = t.value; return; }
    if (k === 'fee') { rv.fee = t.value === '' ? 0 : parseFloat(t.value); updateReviewTotals(); return; }
    const j = Number(t.dataset.j);
    rv.lines[j][k] = k === 'desc' ? t.value : (t.value === '' ? 0 : parseFloat(t.value));
    updateReviewTotals();
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rv]');
    if (!b) return;
    const act = b.dataset.rv;
    if (act === 'sample') { addSampleOrder(); return; }
    if (act === 'open') { openReview(Number(b.dataset.i), b); return; }
    if (!rv) return;
    const orders = SN.getOrders();
    const o = orders[rv.i];
    switch (act) {
      case 'close': closeReview(); break;
      case 'add-line':
        rv.lines.push({ desc: '', qty: 1, unit: 0 });
        renderReview();
        $('#ld-' + (rv.lines.length - 1)).focus();
        break;
      case 'del-line':
        rv.lines.splice(Number(b.dataset.j), 1);
        renderReview();
        break;
      case 'decline': rv.declining = true; renderReview(); $('#decline-note').focus(); break;
      case 'decline-cancel': rv.declining = false; renderReview(); break;
      case 'decline-send':
        o.status = 'Declined';
        o.declineNote = rv.declineNote.trim();
        o.declinedAt = new Date().toISOString();
        SN.setOrders(orders);
        renderOrders();
        renderReview();
        toast(o.number + ' declined. The customer was emailed.');
        break;
      case 'approve': {
        const err = $('#inv-err');
        const bad = rv.lines.find((l) => !String(l.desc).trim() || !(Number(l.qty) > 0));
        if (!rv.lines.length || bad) { err.hidden = false; err.textContent = 'Every invoice line needs a description and a quantity.'; return; }
        const t = SN.invoiceTotals(rv.lines, rv.fee, o.taxRate);
        if (t.total <= 0) { err.hidden = false; err.textContent = 'The invoice total has to be more than $0.'; return; }
        o.invoice = {
          lines: rv.lines.map((l) => ({ desc: String(l.desc).trim(), qty: Number(l.qty), unit: Math.round(Number(l.unit) * 100) / 100 })),
          fee: Number(rv.fee) || 0, subtotal: t.subtotal, tax: t.tax, total: t.total,
          note: rv.note.trim(), changed: isChanged(), sentAt: new Date().toISOString()
        };
        o.status = 'Invoice sent';
        SN.setOrders(orders);
        renderOrders();
        renderReview();
        toast('Approved! Invoice for ' + money(t.total) + ' sent to ' + o.customer.email);
        break;
      }
      case 'resend':
        o.invoice.sentAt = new Date().toISOString();
        SN.setOrders(orders);
        renderReview();
        toast('Invoice re-sent to ' + o.customer.email);
        break;
      default:
    }
  });

  // Keep keyboard focus inside the open review panel.
  review.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('button:not([disabled]), [href], input, select, textarea', review).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });


  /* ---------- Flavors ---------- */
  function renderFlavors() {
    $('#flavor-list').innerHTML = cfg.flavors.map((f, i) =>
      '<div class="flavor-row" style="flex-wrap:wrap">' +
        '<div style="flex:1 1 200px;min-width:0"><label class="sr-only" for="fn-' + i + '">Flavor name</label>' +
          '<input class="input" id="fn-' + i + '" type="text" data-list="flavors" data-i="' + i + '" data-key="name" value="' + esc(f.name) + '" style="max-width:320px' + (f.on ? '' : ';color:var(--muted)') + '">' +
          (f.special ? ' <span class="badge" style="margin-left:6px">SPECIAL</span>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:4px">' +
          '<button type="button" class="link-btn" data-act="special" data-i="' + i + '" style="padding:10px">' + (f.special ? 'Unmark special' : 'Make special') + '</button>' +
          '<button type="button" class="switch" role="switch" aria-checked="' + !!f.on + '" data-act="toggle-flavor" data-i="' + i + '" aria-label="Show ' + esc(f.name) + ' on the menu"><span class="track" aria-hidden="true"></span>' + (f.on ? 'Showing' : 'Hidden') + '</button>' +
          '<button type="button" class="icon-del" data-act="del-flavor" data-i="' + i + '" aria-label="Delete ' + esc(f.name) + '">' + SN_ICONS.trash + '</button>' +
        '</div>' +
      '</div>').join('') || '<p class="hint" style="padding:14px 0">No flavors yet. Add one below.</p>';
  }
  $('#add-flavor').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#new-flavor');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (cfg.flavors.some((f) => f.name.toLowerCase() === name.toLowerCase())) { toast(name + ' is already on the list'); return; }
    cfg.flavors.push({ id: 'f' + Date.now().toString(36), name, on: true, special: false });
    input.value = '';
    renderFlavors();
    markDirty();
    toast(name + ' added. Save to put it on the menu.');
  });

  /* ---------- Blocked dates ---------- */
  function renderBlocked() {
    const list = cfg.blockedDates.slice().sort();
    $('#blocked').innerHTML = list.length ? list.map((d) =>
      '<span class="chip">' + esc(SN.prettyDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) +
      '<button type="button" data-act="del-block" data-d="' + esc(d) + '" aria-label="Unblock ' + esc(d) + '">' + SN_ICONS.close + '</button></span>').join('')
      : '<span class="hint">No blocked dates.</span>';
  }
  $('#add-block').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#new-block').value;
    if (!v) return;
    if (!cfg.blockedDates.includes(v)) cfg.blockedDates.push(v);
    $('#new-block').value = '';
    renderBlocked();
    markDirty();
  });

  /* ---------- Zones ---------- */
  function renderZones() {
    $('#zones-body').innerHTML = cfg.zones.map((z, i) =>
      '<tr>' +
        '<td><label class="sr-only" for="zz-' + i + '">ZIP</label><input class="input" id="zz-' + i + '" type="text" inputmode="numeric" maxlength="5" style="max-width:110px" data-list="zones" data-i="' + i + '" data-key="zip" value="' + esc(z.zip) + '"></td>' +
        '<td><label class="sr-only" for="za-' + i + '">Area name</label><input class="input" id="za-' + i + '" type="text" data-list="zones" data-i="' + i + '" data-key="area" value="' + esc(z.area) + '"></td>' +
        '<td><div class="input-wrap" style="max-width:130px"><span>$</span><label class="sr-only" for="zf-' + i + '">Fee</label><input id="zf-' + i + '" type="number" min="0" step="1" data-list="zones" data-i="' + i + '" data-key="fee" data-type="num" value="' + z.fee + '"></div></td>' +
        '<td><button type="button" class="icon-del" data-act="del-zone" data-i="' + i + '" aria-label="Delete ZIP ' + esc(z.zip) + '">' + SN_ICONS.trash + '</button></td>' +
      '</tr>').join('') || '<tr class="empty-row"><td colspan="4">No drop-off zones. Customers will only see pickup.</td></tr>';
  }

  /* ---------- Clicks for list actions ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = Number(b.dataset.i);
    switch (b.dataset.act) {
      case 'special': cfg.flavors[i].special = !cfg.flavors[i].special; renderFlavors(); break;
      case 'toggle-flavor': cfg.flavors[i].on = !cfg.flavors[i].on; renderFlavors(); break;
      case 'del-flavor':
        if (!confirm('Delete ' + cfg.flavors[i].name + '? To take it off the menu for now, use Hidden instead.')) return;
        cfg.flavors.splice(i, 1); renderFlavors(); break;
      case 'del-block': cfg.blockedDates = cfg.blockedDates.filter((d) => d !== b.dataset.d); renderBlocked(); break;
      case 'add-zone': cfg.zones.push({ zip: '', area: '', fee: 5 }); renderZones(); $('#zz-' + (cfg.zones.length - 1)).focus(); break;
      case 'del-zone': cfg.zones.splice(i, 1); renderZones(); break;
      case 'add-faq': cfg.faqs.push({ q: '', a: '' }); renderFaqs(); $('#fq-' + (cfg.faqs.length - 1)).focus(); break;
      case 'del-faq':
        if ((cfg.faqs[i].q || cfg.faqs[i].a) && !confirm('Delete this question?')) return;
        cfg.faqs.splice(i, 1); renderFaqs(); break;
      case 'faq-up': if (i > 0) { cfg.faqs.splice(i - 1, 0, cfg.faqs.splice(i, 1)[0]); renderFaqs(); $('[data-act="faq-up"][data-i="' + (i - 1) + '"]').focus(); } break;
      case 'faq-down': if (i < cfg.faqs.length - 1) { cfg.faqs.splice(i + 1, 0, cfg.faqs.splice(i, 1)[0]); renderFaqs(); $('[data-act="faq-down"][data-i="' + (i + 1) + '"]').focus(); } break;
      default: return;
    }
    markDirty();
  });

  /* ---------- Save / discard ---------- */
  function cleaned() {
    const c = SN.clone(cfg);
    c.zones = c.zones.filter((z) => /^\d{5}$/.test(z.zip));
    c.faqs = (c.faqs || []).filter((f) => (f.q || '').trim() || (f.a || '').trim());
    return c;
  }
  function save() {
    cfg = cleaned();
    if (SN.save(cfg)) {
      SN.clearDraft();
      dirty = false;
      $('#save-bar').classList.remove('show');
      renderAll();
      toast('Saved. The order page now uses these settings.');
    } else {
      toast('Could not save in this browser.');
    }
  }
  // Preview changes: put the unsaved settings in a draft and open the site in a new tab showing that draft.
  document.querySelectorAll('[data-preview]').forEach((a) => a.addEventListener('click', () => {
    SN.saveDraft(cleaned());
    toast('Opening a preview with your unsaved changes…');
  }));
  $('#save-top').addEventListener('click', save);
  $('#save-bottom').addEventListener('click', save);
  $('#discard').addEventListener('click', () => {
    SN.clearDraft();
    cfg = SN.load({ ignorePreview: true });
    dirty = false;
    $('#save-bar').classList.remove('show');
    renderAll();
    toast('Changes discarded');
  });
  $('#reset-defaults').addEventListener('click', () => {
    if (!confirm('Reset every setting back to the starting defaults?')) return;
    SN.reset();
    cfg = SN.load({ ignorePreview: true });
    dirty = false;
    $('#save-bar').classList.remove('show');
    renderAll();
    toast('Settings reset to defaults');
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  function renderAll() {
    fillFields();
    renderOrders();
    renderFlavors();
    renderBlocked();
    renderZones();
    renderFaqs();
    renderMessages();
  }

  /* ---------- FAQ editor ---------- */
  function renderFaqs() {
    const up = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
    const down = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    const n = cfg.faqs.length;
    $('#faq-editor').innerHTML = n ? cfg.faqs.map((f, i) =>
      '<div class="faq-edit">' +
        '<div class="faq-edit-top"><span class="num">Question ' + (i + 1) + '</span><span class="row-gap" style="gap:6px">' +
          '<button type="button" class="mini-btn" data-act="faq-up" data-i="' + i + '" aria-label="Move question ' + (i + 1) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + up + '</button>' +
          '<button type="button" class="mini-btn" data-act="faq-down" data-i="' + i + '" aria-label="Move question ' + (i + 1) + ' down"' + (i === n - 1 ? ' disabled' : '') + '>' + down + '</button>' +
          '<button type="button" class="icon-del" data-act="del-faq" data-i="' + i + '" aria-label="Delete question ' + (i + 1) + '">' + SN_ICONS.trash + '</button>' +
        '</span></div>' +
        '<label class="sr-only" for="fq-' + i + '">Question ' + (i + 1) + '</label>' +
        '<input class="input" id="fq-' + i + '" type="text" placeholder="Question" data-list="faqs" data-i="' + i + '" data-key="q" value="' + esc(f.q) + '" style="font-weight:600">' +
        '<label class="sr-only" for="fa-' + i + '">Answer ' + (i + 1) + '</label>' +
        '<textarea class="input" id="fa-' + i + '" rows="3" placeholder="Answer" data-list="faqs" data-i="' + i + '" data-key="a">' + esc(f.a) + '</textarea>' +
      '</div>').join('') : '<p class="hint">No questions yet. Add one below.</p>';
  }

  /* ---------- Messages ---------- */
  function renderMessages() {
    const msgs = SN.getMessages();
    const unread = msgs.filter((m) => m.status === 'New').length;
    $('#messages-h').innerHTML = 'Messages' + (unread ? ' <span class="count-pill">' + unread + ' new</span>' : '');
    $('#msg-list').innerHTML = msgs.length ? msgs.map((m, i) => {
      const subject = encodeURIComponent('Re: your question for Sweet Nothings by M');
      const when = new Date(m.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return '<div class="msg' + (m.status === 'New' ? ' unread' : '') + '">' +
        '<div class="msg-top"><strong>' + esc(m.name || m.email) + ' <span class="muted" style="font-weight:400">· ' + esc(m.topic) + (m.orderNumber ? ' · ' + esc(m.orderNumber) : '') + '</span></strong>' +
          '<span class="muted" style="font-size:13px">' + esc(when) + (m.status === 'New' ? ' · <strong style="color:var(--coral-dark)">New</strong>' : ' · Replied') + '</span></div>' +
        '<div class="hint">' + esc(m.email) + (m.phone ? ' · ' + esc(m.phone) : '') + '</div>' +
        '<div class="msg-body">' + esc(m.message) + '</div>' +
        (m.photoName ? '<div class="hint">Photo attached: <strong>' + esc(m.photoName) + '</strong> <span class="muted">(saved to Google Drive in the real site)</span></div>' : '') +
        '<div class="row-gap" style="margin-top:6px;gap:8px">' +
          '<a class="btn small" href="mailto:' + esc(m.email) + '?subject=' + subject + '" data-msg="reply" data-i="' + i + '">Reply by email</a>' +
          '<button type="button" class="btn ghost small" data-msg="toggle" data-i="' + i + '">' + (m.status === 'New' ? 'Mark replied' : 'Mark as new') + '</button>' +
          '<button type="button" class="icon-del" data-msg="delete" data-i="' + i + '" aria-label="Delete message from ' + esc(m.name || m.email) + '">' + SN_ICONS.trash + '</button>' +
        '</div>' +
      '</div>';
    }).join('') : '<p class="hint">No messages yet. Try the <a href="contact.html">Contact page</a> to send a test message.</p>';
  }
  $('#msg-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-msg]');
    if (!b) return;
    const msgs = SN.getMessages();
    const i = Number(b.dataset.i);
    if (b.dataset.msg === 'reply') { msgs[i].status = 'Replied'; SN.setMessages(msgs); setTimeout(renderMessages, 300); return; }
    if (b.dataset.msg === 'toggle') { msgs[i].status = msgs[i].status === 'New' ? 'Replied' : 'New'; }
    if (b.dataset.msg === 'delete') { if (!confirm('Delete this message?')) return; msgs.splice(i, 1); }
    SN.setMessages(msgs);
    renderMessages();
  });
  renderAll();

  // Coming back from a preview? Restore the unsaved draft so no edits are lost.
  try {
    const draft = localStorage.getItem('sn_config_draft');
    if (draft && draft !== JSON.stringify(SN.dropPastDates(SN.load({ ignorePreview: true })))) {
      cfg = SN.dropPastDates(Object.assign(SN.load({ ignorePreview: true }), JSON.parse(draft)));
      renderAll();
      markDirty();
      toast('Your unsaved changes are still here. Save or discard them when you’re ready.');
    }
  } catch (e) { /* ignore */ }
})();
