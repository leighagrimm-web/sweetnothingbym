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
  maxDesigns: 6,              // most custom designs a customer can pick
  customTiers: [              // custom cookie price per cookie, by number of designs
    { from: 1, to: 1, price: 5.0 },
    { from: 2, to: 3, price: 6.5 },
    { from: 4, to: 6, price: 8.0 }
  ],
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
  ownerEmail: '',
  pickupAddress: '[Street address], Rosemont, IL',
  pickupCity: 'Rosemont, IL',
  instagram: 'https://www.instagram.com/sweet_nothings_by_m/',
  instagramHandle: '@sweet_nothings_by_m',
  // Swap in real photos by putting files in /assets and setting the paths here.
  images: { custom: '', mini: '', large: '' }
};

const SN = {
  clone(o) { return JSON.parse(JSON.stringify(o)); },

  load() {
    const base = SN.clone(SN_DEFAULTS);
    try {
      const raw = localStorage.getItem('sn_config');
      if (raw) return Object.assign(base, JSON.parse(raw));
    } catch (e) { /* storage unavailable: use defaults */ }
    return base;
  },
  save(cfg) {
    try { localStorage.setItem('sn_config', JSON.stringify(cfg)); return true; } catch (e) { return false; }
  },
  reset() { try { localStorage.removeItem('sn_config'); } catch (e) { /* ignore */ } },

  // Bag lives in sessionStorage so it survives moving between pages.
  getBag() { try { return JSON.parse(sessionStorage.getItem('sn_bag') || '[]'); } catch (e) { return []; } },
  setBag(bag) { try { sessionStorage.setItem('sn_bag', JSON.stringify(bag)); } catch (e) { /* ignore */ } },

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

  tierPrice(cfg, designs) {
    const tiers = cfg.customTiers.slice().sort((a, b) => a.from - b.from);
    const hit = tiers.find((t) => designs >= t.from && designs <= t.to);
    if (hit) return hit.price;
    return tiers.length ? tiers[tiers.length - 1].price : 0;
  },
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
    if (it.kind === 'custom') return it.qty * SN.tierPrice(cfg, it.designs);
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
      return it.designs + ' design' + (it.designs > 1 ? 's' : '') + ' × ' + SN.money(SN.tierPrice(cfg, it.designs)) + ' each' + (it.photoName ? ' · photo attached' : '');
    }
    const names = {};
    cfg.flavors.forEach((f) => { names[f.id] = f.name; });
    Object.assign(names, it.flavorNames || {});
    return Object.keys(it.fq).filter((k) => it.fq[k] > 0).map((k) => it.fq[k] + ' ' + (names[k] || k)).join(', ');
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
