/*
 * Sweet Nothings by M — shop settings and shared helpers.
 *
 * PROTOTYPE NOTE: settings, the bag and orders are kept in this browser's
 * storage (localStorage / sessionStorage). In the real build these move to the
 * Google Sheet (Settings tab + Orders tab) via Google Apps Script.
 */

const SN_DEFAULTS = {
  leadDays: 8,                // minimum days between ordering and the date needed
  maxOrdersPerDay: 3,         // shown in admin; enforced in the real build
  acceptingOrders: true,
  minQty: 12,                 // 1 dozen minimum for every item
  maxDesigns: 6,              // most custom designs a customer can pick (info for M's quote)
  customBasePrice: 5.0,       // custom cookies "starting at" price per cookie (used for the estimate)
  customNote: 'Pricing may vary based on the complexity of the design and the number of different designs.',
  miniPerDozen: 24,
  largePerDozen: 36,
  flavorsPerDozen: 4,
  flavors: [
    { id: 'cc', name: 'Chocolate Chip', on: true, special: false },
    { id: 'ff', name: 'Funfetti', on: true, special: false },
    { id: 'sd', name: 'Snickerdoodle', on: true, special: false },
    { id: 'dc', name: 'Double Chocolate', on: true, special: false },
    { id: 'ps', name: 'Pumpkin Spice', on: true, special: true },
    { id: 'ls', name: 'Lemon Sugar', on: false, special: false }
  ],
  specialText: 'Pumpkin Spice is back in the artisan lineup through the end of the month.',
  specialUntil: '2026-10-31',
  taxRate: 2.25,              // grocery tax, percent, applied to cookies (not drop-off)
  zones: [                    // drop-off ZIP codes and fees
    { zip: '60018', area: 'Rosemont / Des Plaines', fee: 5 },
    { zip: '60016', area: 'Des Plaines', fee: 5 },
    { zip: '60068', area: 'Park Ridge', fee: 5 },
    { zip: '60656', area: 'Chicago (O’Hare)', fee: 5 },
    { zip: '60007', area: 'Elk Grove Village', fee: 10 },
    { zip: '60056', area: 'Mount Prospect', fee: 10 },
    { zip: '60004', area: 'Arlington Heights', fee: 10 }
  ],
  blockedDates: ['2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2026-12-26'],
  // FAQ shown on faq.html, editable from the admin page. Bracketed text is for M to fill in.
  faqs: [
    { q: 'What ingredients do you use?', a: 'I bake everything from scratch with [real butter, pure vanilla, unbleached flour, cane sugar, farm eggs]. Custom cookies are a [vanilla sugar cookie] decorated with [royal icing]. [Add any brands or sourcing you want to mention.]' },
    { q: 'Can you make allergen-friendly cookies?', a: 'Yes! I\u2019ve made [gluten-free, dairy-free and nut-free] cookies before. Just mention any allergies or dietary needs when you order (there\u2019s a spot for it at checkout), or send me a message first. Please note my kitchen is not allergen-free, so I can\u2019t guarantee against cross-contact for severe allergies.' },
    { q: 'How far ahead should I order?', a: 'Please order at least 8 days before you need your cookies. Larger custom orders and busy seasons (holidays, graduation, wedding season) book up fast, so earlier is better.' },
    { q: 'How does ordering work?', a: 'Choose your cookies and send your order request. You\u2019ll get an email right away, but it\u2019s not a final order yet. I\u2019ll review the details and send a second email with your confirmation, final price and a QuickBooks invoice. Your date is reserved once the invoice is paid.' },
    { q: 'How much do custom cookies cost?', a: 'Custom cookies start at $5 per cookie with a 1 dozen minimum. Pricing may vary based on the complexity of the design and the number of different designs. You\u2019ll see an estimate when you order, and I\u2019ll confirm the final price before you pay.' },
    { q: 'Do you deliver?', a: 'Pickup is free in Rosemont, IL (exact address is in your confirmation). Local drop-off is available to nearby ZIP codes for $5\u2013$10. You\u2019ll see the fee for your ZIP at checkout.' },
    { q: 'How do I pay?', a: 'Once I approve your order, you\u2019ll get a QuickBooks invoice by email. You can pay securely by card or bank transfer.' },
    { q: 'How should I store my cookies?', a: '[Cookies stay fresh for about X days at room temperature in an airtight container. Decorated cookies can be frozen for up to X months. Keep them out of direct sunlight and away from heat.]' }
  ],
  ownerEmail: '',
  pickupAddress: '[Street address], Rosemont, IL',
  pickupCity: 'Rosemont, IL',
  instagram: 'https://www.instagram.com/sweet_nothings_by_m/',
  instagramHandle: '@sweet_nothings_by_m',
  // Swap in real photos by uploading them to the repo and setting the paths here.
  images: { custom: '', mini: '', large: '' }
};

const SN = {
  clone(o) { return JSON.parse(JSON.stringify(o)); },

  // opts.ignorePreview: the admin page always edits the saved settings, never a preview draft.
  load(opts) {
    let cfg = SN.clone(SN_DEFAULTS);
    try {
      const draft = !(opts && opts.ignorePreview) && SN.isPreview() ? localStorage.getItem('sn_config_draft') : null;
      const raw = draft || localStorage.getItem('sn_config');
      if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
    } catch (e) { /* storage unavailable: use defaults */ }
    return SN.dropPastDates(cfg);
  },
  // Blocked dates in the past are removed automatically so the list doesn't get cluttered.
  dropPastDates(cfg) {
    const today = SN.isoDate(new Date());
    cfg.blockedDates = (cfg.blockedDates || []).filter((d) => d >= today).sort();
    return cfg;
  },

  /* ---------- Preview mode (admin "Preview changes") ---------- */
  // A tab opened with ?preview=1 shows the admin's unsaved draft until the visitor exits preview.
  isPreview() {
    try {
      if (new URLSearchParams(location.search).get('preview') === '1') sessionStorage.setItem('sn_preview', '1');
      return sessionStorage.getItem('sn_preview') === '1' && !!localStorage.getItem('sn_config_draft');
    } catch (e) { return false; }
  },
  exitPreview() { try { sessionStorage.removeItem('sn_preview'); } catch (e) { /* ignore */ } },
  saveDraft(cfg) { try { localStorage.setItem('sn_config_draft', JSON.stringify(cfg)); return true; } catch (e) { return false; } },
  clearDraft() { try { localStorage.removeItem('sn_config_draft'); } catch (e) { /* ignore */ } },
  save(cfg) {
    try { localStorage.setItem('sn_config', JSON.stringify(cfg)); return true; } catch (e) { return false; }
  },
  reset() { try { localStorage.removeItem('sn_config'); } catch (e) { /* ignore */ } },

  // Bag lives in sessionStorage so it survives moving between pages.
  getBag() { try { return JSON.parse(sessionStorage.getItem('sn_bag') || '[]'); } catch (e) { return []; } },
  setBag(bag) { try { sessionStorage.setItem('sn_bag', JSON.stringify(bag)); } catch (e) { /* ignore */ } },

  getMessages() { try { return JSON.parse(localStorage.getItem('sn_messages') || '[]'); } catch (e) { return []; } },
  setMessages(m) { try { localStorage.setItem('sn_messages', JSON.stringify(m)); } catch (e) { /* ignore */ } },

  getOrders() { try { return JSON.parse(localStorage.getItem('sn_orders') || '[]'); } catch (e) { return []; } },
  setOrders(o) { try { localStorage.setItem('sn_orders', JSON.stringify(o)); } catch (e) { /* ignore */ } },
  nextOrderNumber() {
    let n = 1042;
    try { n = parseInt(localStorage.getItem('sn_next') || '1042', 10) || 1042; localStorage.setItem('sn_next', String(n + 1)); } catch (e) { /* ignore */ }
    return 'SN-' + n;
  },
  peekOrderNumber() {
    try { return 'SN-' + (parseInt(localStorage.getItem('sn_next') || '1042', 10) || 1042); } catch (e) { return 'SN-1042'; }
  },

  money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); },
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  customPrice(cfg) { return Number(cfg.customBasePrice) || 0; },
  perCookie(cfg, kind) { return (kind === 'mini' ? cfg.miniPerDozen : cfg.largePerDozen) / 12; },

  artisanCheck(cfg, fq) {
    const qty = Object.values(fq || {}).reduce((a, b) => a + b, 0);
    const used = Object.values(fq || {}).filter((v) => v > 0).length;
    const max = cfg.flavorsPerDozen * Math.max(1, Math.floor(qty / 12));
    let err = '';
    if (qty < cfg.minQty) err = qty === 0 ? 'Add at least ' + cfg.minQty + ' cookies.' : (cfg.minQty - qty) + ' more to reach the 1 dozen minimum.';
    else if (used > max) err = 'Up to ' + max + ' flavors for ' + qty + ' cookies. Remove a flavor or add another dozen.';
    return { qty, used, max, err };
  },

  itemTotal(cfg, it) {
    if (it.kind === 'custom') return it.qty * SN.customPrice(cfg);
    return SN.artisanCheck(cfg, it.fq).qty * SN.perCookie(cfg, it.kind);
  },

  isoDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },
  minDate(cfg) { const d = new Date(); d.setDate(d.getDate() + Number(cfg.leadDays || 0)); return d; },
  prettyDate(iso, opts) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', opts || { weekday: 'long', month: 'long', day: 'numeric' });
  },

  specialActive(cfg) {
    if (!cfg.specialText) return false;
    if (!cfg.specialUntil) return true;
    return SN.isoDate(new Date()) <= cfg.specialUntil;
  },

  itemLabel(kind) { return kind === 'custom' ? 'Custom Cookies' : kind === 'mini' ? 'Mini Artisan' : 'Large Artisan'; },

  describeItem(cfg, it) {
    if (it.kind === 'custom') {
      return it.designs + ' design' + (it.designs > 1 ? 's' : '') + ' · estimated at ' + SN.money(SN.customPrice(cfg)) + ' each' + (it.photoName ? ' · photo attached' : '');
    }
    const names = {};
    cfg.flavors.forEach((f) => { names[f.id] = f.name; });
    Object.assign(names, it.flavorNames || {});
    return Object.keys(it.fq).filter((k) => it.fq[k] > 0).map((k) => it.fq[k] + ' ' + (names[k] || k)).join(', ');
  },

  /* ---------- Approval + invoice helpers ---------- */
  STATUSES: ['Pending review', 'Invoice sent', 'Paid', 'Baking', 'Ready', 'Completed', 'Declined'],
  normStatus(s) { return s === 'New' || !s ? 'Pending review' : s; },

  // Starting invoice lines built from the customer's request.
  linesFromOrder(cfg, o) {
    return o.items.map((it) => {
      const unit = it.kind === 'custom' ? SN.customPrice(cfg) : SN.perCookie(cfg, it.kind);
      return { desc: it.qty + ' ' + SN.itemLabel(it.kind) + (it.summary ? ' (' + it.summary.replace(/ · estimated at .*?each/, '') + ')' : ''), qty: it.qty, unit: Math.round(unit * 100) / 100 };
    });
  },
  // Totals for a set of invoice lines. Tax applies to cookie lines, not the drop-off fee.
  invoiceTotals(lines, fee, taxRate) {
    const subtotal = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0);
    const tax = Math.round(Math.max(0, subtotal) * Number(taxRate)) / 100;
    const f = Number(fee) || 0;
    return { subtotal, tax, fee: f, total: subtotal + tax + f };
  }
};

// Shared inline icons (stroke SVG, decorative).
const SN_ICONS = {
  minus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#C65A4B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  checkSmall: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F7E3DD" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg>',
  insta: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F2A44" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6" fill="#1F2A44"/></svg>',
  star: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C65A4B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>',
  upload: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#C65A4B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>'
};
