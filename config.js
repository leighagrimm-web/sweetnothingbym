/*
 * Sweet Nothings by M — shop settings and shared helpers.
 *
 * Live settings come from the Google Sheet through the Apps Script web app (see apps-script/).
 * SN_DEFAULTS below is the fallback the site shows if the Sheet can't be reached.
 * Orders and messages are sent to the Sheet. The bag stays in this browser (sessionStorage).
 * admin.html is still the prototype (this browser's storage only) until it moves to Apps Script in phase 2.
 */

/* ---------- Which Google Sheet this copy of the site talks to ---------- */
// Each environment has its own Sheet + Apps Script web app:
//   uat  = the GitHub Pages test site, in Leigha's Google account
//   prod = Melissa's own domain, in her Google account (fill in at launch)
// Paste each web app URL (ends in /exec) below. Any address not listed in PROD_HOSTS uses UAT.
// iPhone / iPad (including iPads that report themselves as a Mac): styles.css uses html.ios to show a hint in
// Safari's otherwise blank date box.
if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  document.documentElement.classList.add('ios');
}

// This copy of the site's code. Bumped on every publish together with the ?v= on the pages and version.json, so a
// tab left open can tell a newer version is out (see layout.js).
const SN_BUILD = '20261027m';

const SN_ENV = (function () {
  const API = {
    uat: 'https://script.google.com/macros/s/AKfycbxevgGnDBQn2XUOqY3J9Ou873czPs7xWOH3sj7nPriq3K_vPAxeNw1acPVDgPCJhalw/exec',
    prod: 'https://script.google.com/macros/s/AKfycbzqgowHt3FceXrzwWhDqSrAdAcazOru_uqEVz14YPvw5hX2krA2PPR0Z-7TL8Nut0kVVA/exec'
  };
  // The owner's admin page: the admin deployment's web app URL (only the Sheet's owner can open it).
  const ADMIN = {
    uat: 'https://script.google.com/macros/s/AKfycbxIlsPvvCXdZEUW72DQ_Qh7UkpTSrBSYm--QMPMPvolX2ofes9MoHmu9Zt0B-s1JxPo/exec',
    prod: 'https://script.google.com/macros/s/AKfycbzDsNc1WNYo2J1CCd3CpvtG5NmIhxxwuiZ75r8MkzKEN-aHipAXDf-Mv6jkNd7DPc2ldA/exec'
  };
  // The live site: the real domain, and Cloudflare Pages' own address for it (*.pages.dev). Everything else
  // (GitHub Pages, localhost) is the test site, talking to the test Sheet.
  const PROD_HOSTS = ['www.sweetnothingsbym.com', 'sweetnothingsbym.com'];
  const name = PROD_HOSTS.indexOf(location.hostname) !== -1 || /\.pages\.dev$/.test(location.hostname) ? 'prod' : 'uat';
  return { name, api: API[name], admin: ADMIN[name] };
})();

const SN_DEFAULTS = {
  leadDays: 8,                // minimum days between ordering and the date needed
  capCustomPerWeek: 50,       // most custom cookies per Mon-Sun week (approved orders); 0 = no limit
  capArtisanPerWeek: 75,      // most artisan cookies per week
  acceptingOrders: true,
  minQty: 12,                 // 1 dozen minimum for every item
  maxDesigns: 6,              // most custom designs a customer can pick (info for M's quote)
  customBasePrice: 5.0,       // custom cookies "starting at" price per cookie (used for the estimate)
  customNote: 'Pricing may vary based on the complexity of the design and the number of different designs.',
  miniPerDozen: 24,
  largePerDozen: 36,
  flavorsPerDozen: 4,         // most artisan flavors below flavorsMaxAt cookies...
  flavorsMax: 6,              // ...and from flavorsMaxAt cookies on
  flavorsMaxAt: 24,
  // Home page "What I make" short list, beside the Custom cookies feature (edited on the admin's Website pages tab).
  // link: custom | mini | large (opens that item on the Order page), order, events, contact, or message ("Message me").
  // A blank line shows the live price for mini/large; a blank photo uses that item's menu photo.
  homeItems: [{"name":"Mini artisan","line":"","photo":"","link":"mini"},{"name":"Large artisan","line":"","photo":"","link":"large"},{"name":"Cookie kits","line":"At pop-ups and events","photo":"","link":"events"}],
  homeSlides: [],   // Home page Custom cookies slideshow: [{ photo }] in order; empty = the Custom Cookies menu photo
  classHoldMinutes: 30,       // a class spot is held this long while the customer pays in Square
  classesPayOnline: true,     // from the server: class checkout goes on to Square
  // Maintenance mode (admin → Website pages): visitors see a "back soon" page; the password lets you in to test.
  maintenanceMode: false,
  maintenanceTitle: 'Something sweet is in the oven',
  maintenanceMessage: 'We’re mixing up a fresh batch of updates to the site. Check back soon, or follow along on Instagram in the meantime!',
  allergyNote: 'Need allergy-friendly swaps, like gluten-free or dairy-free? Happy to help! Ingredient changes for allergies or dietary needs add an extra cost, which I’ll include in your final price.',
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
  showAbout: true, showEvents: true, showGallery: true, showFaq: true,   // pages in the menu
  zones: [                    // drop-off ZIP codes and fees
    { zip: '60018', area: 'Rosemont / Des Plaines', fee: 5 },
    { zip: '60016', area: 'Des Plaines', fee: 5 },
    { zip: '60068', area: 'Park Ridge', fee: 5 },
    { zip: '60656', area: 'Chicago (O’Hare)', fee: 5 },
    { zip: '60007', area: 'Elk Grove Village', fee: 10 },
    { zip: '60056', area: 'Mount Prospect', fee: 10 },
    { zip: '60004', area: 'Arlington Heights', fee: 10 }
  ],
  blockedDates: ['2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2026-12-26'],   // every blocked day (the Sheet stores ranges)
  weekLoads: {},              // { monday 'yyyy-mm-dd': { custom, artisan } } cookies already approved that week
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
  pickupAddress: '[Street address], Rosemont, IL',   // private in the Sheet: only in the confirmation email (email #2)
  pickupInstructions: '[Pickup instructions, e.g. pickup window, where to park, which door]',
  pickupCity: 'Rosemont, IL',
  instagram: 'https://www.instagram.com/sweet_nothings_by_m/',
  instagramHandle: '@sweet_nothings_by_m',
  // Menu photos. In the Sheet these are the photoCustom / photoMini / photoLarge rows on the Pages tab.
  images: { custom: '', mini: '', large: '' },

  // Website wording and photos, edited on the Sheet's Pages, Events and Gallery tabs (starter copy below matches the Sheet's).
  // Photos: an image link, a file in this repo, or "[bracket text]" for a placeholder box. Blank lines start new paragraphs.
  pages: {
    homeTitle: 'Handmade cookies for life’s sweetest moments',
    homeIntro: 'Hand-decorated custom sets for birthdays, showers and celebrations, plus small-batch artisan favorites by the dozen.',
    homeHeroPhoto: '[Hero photo of her cookies]',
    homeMakeIntro: 'Hand-decorated custom sets, small-batch artisan favorites, and kits to decorate at home.',
    homeEventsLine: 'Decorating classes and pop-ups around the northwest suburbs',
    aboutTitle: 'Hi, I\'m Melissa',
    aboutIntro: 'Sweet Nothings by M bakes custom decorated and artisan cookies for the moments worth celebrating.',
    aboutPhoto: '[Photo of M in the kitchen]',
    aboutStoryHeading: 'The story',
    aboutStory: '[A few sentences in M\'s own words: how she started baking, what she loves about making cookies for people, and what makes Sweet Nothings special.]\n\n[What customers can expect: how custom orders work, how far ahead to book, and pickup in Rosemont or local drop-off.]',
    aboutGoodToKnowHeading: 'Good to know',
    aboutGoodToKnow: '[Allergen note, e.g. "Cookies are made in a kitchen that also handles nuts, dairy, eggs and wheat."]\n\n[Storage tips: how long cookies stay fresh and how to keep them.]',
    eventsTitle: 'Classes, pop-ups & seasonal specials',
    eventsIntro: 'Limited-time cookies and cookie decorating classes. Follow along on Instagram for the latest dates.',
    galleryTitle: 'Past creations',
    galleryIntro: 'A peek at cookies made for birthdays, showers, weddings and more. See the newest work on Instagram.'
  },
  // button: 'Add to bag' (a class: needs a price; booked and paid at checkout) | 'Order now' | 'Message me' | 'None'.
  // Blank fields don't show. spotsLeft comes from the Sheet when max (attendees) is set.
  events: [
    { id: 'e1', title: '[Cookie decorating class]', date: '', start: '', end: '', address: '', price: '', max: '', desc: '[What attendees will make and what\'s included.]', photo: '[Class photo]', when: '', button: 'Add to bag' },
    { id: 'e2', title: '[Seasonal special]', date: '', start: '', end: '', address: '', price: '', max: '', desc: '[Holiday or seasonal box description. Specials can also be added to the artisan menu from the admin page.]', photo: '[Seasonal cookie photo]', when: '[Available dates]', button: 'Order now' },
    { id: 'e3', title: 'Planning something bigger?', date: '', start: '', end: '', address: '', price: '', max: '', desc: 'For weddings, corporate gifts or large events, start an order and describe what you have in mind, or send me a message.', photo: '[Event photo]', when: '', button: 'Message me' }
  ],
  gallery: ['Birthday', 'Baby shower', 'Wedding shower', 'Anniversary', 'Holiday', 'Party', 'Artisan box', 'Custom set']
    .map((l) => ({ photo: '[' + l + ' cookie photo]', caption: l + ' cookies' }))
};
/* LIVE SNAPSHOT START */
// Live settings as of 2026-10-25 (node .claude/snapshot.js). The Sheet always wins once it answers.
Object.assign(SN_DEFAULTS, {
 "acceptingOrders": true,
 "leadDays": 14,
 "capCustomPerWeek": 50,
 "capArtisanPerWeek": 75,
 "minQty": 12,
 "maxDesigns": 6,
 "customBasePrice": 5,
 "customNote": "Pricing may vary based on the complexity of the design and the number of different designs.",
 "allergyNote": "Need allergy-friendly swaps, like gluten-free or dairy-free? Happy to help! Ingredient changes for allergies or dietary needs add an extra cost, which I'll include in your final price.",
 "miniPerDozen": 24,
 "largePerDozen": 36,
 "flavorsPerDozen": 4,
 "flavorsMax": 6,
 "flavorsMaxAt": 24,
 "specialText": "Check out our new cookie decorating class in Special Events!",
 "specialUntil": "2026-11-19",
 "showAbout": true,
 "showEvents": true,
 "showGallery": true,
 "showFaq": true,
 "pickupCity": "Rosemont, IL",
 "instagram": "https://www.instagram.com/sweet_nothings_by_m/",
 "instagramHandle": "@sweet_nothings_by_m",
 "images": {
  "custom": "https://drive.google.com/file/d/1Y_muW7U8fjlWHTmlAUtLkz6d2zizJKaM/view?usp=drive_link",
  "mini": "https://drive.google.com/file/d/1oMg8CgGeHU2J70Co8hTl23JtIjU73oua/view?usp=drive_link",
  "large": "https://drive.google.com/file/d/1fVEvptw39Sxuikk8194DzSi2cyhli1HP/view?usp=drive_link"
 },
 "homeItems": [
  {
   "link": "mini",
   "name": "Mini artisan",
   "photo": "https://drive.google.com/file/d/1FwRES_GHzSirQCc_xtX3Kl9vWhhzeg6G/view?usp=drive_link",
   "line": ""
  },
  {
   "line": "",
   "link": "large",
   "name": "Large artisan",
   "photo": "https://drive.google.com/file/d/1HEZfTu1RtfmPz3D9hi2d6oMivoNZfkOe/view?usp=drive_link"
  },
  {
   "line": "At pop-ups and events",
   "link": "events",
   "photo": "https://drive.google.com/file/d/1BlHGZAJ0M8oz3b-BuSUnvp47CJ37aF7p/view?usp=sharing",
   "name": "Cookie kits"
  }
 ],
 "homeSlides": [
  {
   "photo": "https://drive.google.com/file/d/1FcY8pb2v3EFW__h0OjLcCkTFLebwjkb5/view?usp=drive_link"
  },
  {
   "photo": "https://drive.google.com/file/d/1N3frQACziYnjKCK6Uymb0xhQjKfJQDKF/view?usp=drive_link"
  },
  {
   "photo": "https://drive.google.com/file/d/11kD-C2BF0GiC4ZXE-HSBzczVTK1lycSF/view?usp=drive_link"
  },
  {
   "photo": "https://drive.google.com/file/d/1WJxTRfeHGAZ6IWPFU94ePWp3JDDGijY1/view?usp=drive_link"
  },
  {
   "photo": "https://drive.google.com/file/d/1awI4HSH5wzdqZAIzU_0avCKqM5oQDRH7/view?usp=drive_link"
  },
  {
   "photo": "https://drive.google.com/file/d/1zSis-DU2QpFcp5V_3uNzLf6oZD-ww1-9/view?usp=drive_link"
  }
 ],
 "classHoldMinutes": 15,
 "maintenanceTitle": "Something sweet is in the oven",
 "maintenanceMessage": "We’re mixing up a fresh batch of updates to the site. Check back soon, or follow along on Instagram in the meantime!",
 "flavors": [
  {
   "id": "cc",
   "name": "Brown Butter Chocolate Chip",
   "on": true,
   "special": false
  },
  {
   "id": "ff",
   "name": "Confetti Golden Oreo",
   "on": true,
   "special": false
  },
  {
   "id": "sd",
   "name": "Snickerdoodle",
   "on": true,
   "special": false
  },
  {
   "id": "dc",
   "name": "Peanut Butter Chocolate",
   "on": true,
   "special": false
  },
  {
   "id": "ps",
   "name": "Pumpkin Spice",
   "on": true,
   "special": true
  },
  {
   "id": "ls",
   "name": "Lemon Crinkle",
   "on": true,
   "special": false
  },
  {
   "id": "fmvirytkp",
   "name": "Strawberry Crunch",
   "on": true,
   "special": false
  },
  {
   "id": "fmvmst1cq",
   "name": "Banana Pudding",
   "on": true,
   "special": false
  }
 ],
 "zones": [
  {
   "zip": "60018",
   "area": "Rosemont / Des Plaines",
   "fee": 5
  },
  {
   "zip": "60016",
   "area": "Des Plaines",
   "fee": 5
  },
  {
   "zip": "60068",
   "area": "Park Ridge",
   "fee": 5
  },
  {
   "zip": "60656",
   "area": "Chicago (O’Hare)",
   "fee": 5
  },
  {
   "zip": "60007",
   "area": "Elk Grove Village",
   "fee": 10
  },
  {
   "zip": "60056",
   "area": "Mount Prospect",
   "fee": 10
  },
  {
   "zip": "60004",
   "area": "Arlington Heights",
   "fee": 10
  },
  {
   "zip": "60074",
   "area": "Palatine",
   "fee": 10
  },
  {
   "zip": "60068",
   "area": "Park Ridge",
   "fee": 5
  },
  {
   "zip": "60025",
   "area": "Glenview",
   "fee": 10
  }
 ],
 "faqs": [
  {
   "q": "What ingredients do you use?",
   "a": "I bake everything from scratch with using real ingredients. Custom cookies are a vanilla based sugar cookie that are hand decorated with royal icing."
  },
  {
   "q": "Can you make allergen-friendly cookies?",
   "a": "Yes! I’ve made gluten-free, dairy-free and nut-free cookies before. Just mention any allergies or dietary needs when you order (there’s a spot for it at checkout), or send me a message first. Please note my kitchen is not allergen-free, so I can’t guarantee against cross-contact for severe allergies."
  },
  {
   "q": "How far ahead should I order?",
   "a": "Please order at least 14 days before you need your cookies. Larger custom orders and busy seasons (holidays, graduation, wedding season) book up fast, so earlier is better.\n\nNeed them sooner? If you need your cookies sooner than 14 days, send me a message before ordering to see if I can fit you in. Rush orders have an extra rush fee, added to your final price."
  },
  {
   "q": "How does ordering work?",
   "a": "Choose your cookies and send your order request. You’ll get an email right away, but it’s not a final order yet. I’ll review the details and send a second email with your confirmation, final price and a QuickBooks invoice. Your date is reserved once the invoice is paid."
  },
  {
   "q": "How much do custom cookies cost?",
   "a": "Custom cookies start at $5 per cookie with a 1 dozen minimum. Pricing may vary based on the complexity of the design and the number of different designs. You’ll see an estimate when you order, and I’ll confirm the final price before you pay."
  },
  {
   "q": "Do you deliver?",
   "a": "Pickup is free in Rosemont, IL (exact address is in your confirmation). Local drop-off is available to nearby ZIP codes for $5–$10. You’ll see the fee for your ZIP at checkout. \n\nOutside my drop-off area? No problem. We can meet at a spot within my drop-off zone! Just choose drop-off at checkout and enter the meet-up spot’s address in the address section."
  },
  {
   "q": "How do I pay?",
   "a": "Once I approve your order, you’ll get a QuickBooks invoice by email. You can pay securely by card or bank transfer."
  },
  {
   "q": "How should I store my cookies?",
   "a": "Artisan cookies stay fresh for about 5 days at room temperature in an airtight container in their sealed individual bags. Decorated cookies can stay at room temperature in their sealed bags for up to 10 days. All cookies can be frozen for up to 6 months. Keep them out of direct sunlight and away from heat."
  }
 ],
 "pages": {
  "homeTitle": "Handmade cookies for life’s sweetest moments",
  "homeIntro": "Hand-decorated custom sets for birthdays, showers and celebrations, plus small-batch artisan favorites by the dozen.",
  "homeHeroPhoto": "https://drive.google.com/file/d/18rIL8mi96GNpsKh0XivYNDhKISk-AejT/view?usp=drive_link",
  "homeMakeIntro": "Hand-decorated custom sets, small-batch artisan favorites, and kits to decorate at home.",
  "homeEventsLine": "Decorating classes and pop-ups around the northwest suburbs",
  "photoCustom": "https://drive.google.com/file/d/1Y_muW7U8fjlWHTmlAUtLkz6d2zizJKaM/view?usp=drive_link",
  "photoMini": "https://drive.google.com/file/d/1oMg8CgGeHU2J70Co8hTl23JtIjU73oua/view?usp=drive_link",
  "photoLarge": "https://drive.google.com/file/d/1fVEvptw39Sxuikk8194DzSi2cyhli1HP/view?usp=drive_link",
  "aboutTitle": "Hi, I'm Melissa",
  "aboutIntro": "Sweet Nothings by M bakes custom decorated and artisan cookies for the moments worth celebrating.",
  "aboutPhoto": "https://drive.google.com/file/d/1kgXEHECkF32WkBQ_hGyZorMeggvUvnel/view?usp=drive_link",
  "aboutStoryHeading": "The story",
  "aboutStory": "Sweet Nothings by M started with one cookie that quickly became a fan favorite!\n\nI’ve loved baking since I was young, and I’ve always enjoyed bringing sweet treats to share with family and friends, and to spoil the nurses and doctors I work with every day. I’ve been a PICU nurse for 20 years, and Sweet Nothings is how I turned my passion for baking into a small, home-based cottage bakery.\n\nI love being part of people’s lives and their special moments, and cookies give me the chance to do that every day.",
  "aboutGoodToKnowHeading": "Good to know",
  "aboutGoodToKnow": "How ordering works:\nPlease order at least 14 days before you need your cookies. When you send your order, it’s a request, not a final order. I’ll review the details and email you a confirmation with your final price and an invoice. Your date is reserved once the invoice is paid.\n\nAllergies and dietary needs: \nNeed allergy-friendly swaps, like gluten-free or dairy-free? Happy to help! Ingredient changes for allergies or dietary needs add an extra cost, which I’ll include in your final price. Please note my kitchen is not allergen-free, so I can’t guarantee against cross-contact for severe allergies.",
  "eventsTitle": "Classes, pop-ups & seasonal specials",
  "eventsIntro": "Limited-time cookies and cookie decorating classes. Follow along on Instagram for the latest dates.",
  "galleryTitle": "Past creations",
  "galleryIntro": "A peek at cookies made for birthdays, showers, weddings and more. See the newest work on Instagram."
 },
 "events": [
  {
   "id": "e1",
   "title": "Cookie Decorating Class",
   "date": "2026-11-19",
   "start": "6:00pm",
   "end": "8:00pm",
   "address": "106 S. Emerson St., Mount Prospect, IL",
   "price": 60,
   "max": 18,
   "desc": "Join us for a fun, hands-on class where you'll learn basic cookie decorating techniques and create this adorable set of 6-fall-themed cookies!\n\nAll supplies included. Step-by-step instruction. No experience needed. Take home (and eat!) your creations.\n\nMust by 12 years or older to participate.",
   "photo": "https://drive.google.com/file/d/1r01WNCMsYuTcFPB9FyRbiFubL_qbehvC/view?usp=drive_link",
   "when": "",
   "button": "Add to bag",
   "venue": "Khepri Kitchen & Coffee",
   "summary": "Decorate 6 fall themed cookies to take home. All supplies included.",
   "flyer": "https://drive.google.com/file/d/1kp9mdYHQpO5teBcrMWsZNA0mjXNNNBld/view?usp=drive_link"
  },
  {
   "id": "e2",
   "title": "Arlington Heights Farmers Market",
   "date": "",
   "start": "",
   "end": "",
   "address": "",
   "price": "",
   "max": "",
   "desc": "Find me at the Downtown Arlington Heights Farmer's Market on Saturdays!",
   "photo": "https://drive.google.com/file/d/1t63ARqrHbJhECsrEj5XOsbl8xr2W7ZYT/view?usp=drive_link",
   "when": "See you next year! Thanks to everyone who came to buy cookies!",
   "button": "None",
   "venue": "Season has ended.",
   "summary": "",
   "flyer": ""
  },
  {
   "id": "e3",
   "title": "Planning something bigger?",
   "date": "",
   "start": "",
   "end": "",
   "address": "",
   "price": "",
   "max": "",
   "desc": "For weddings, corporate gifts or large events, start an order and describe what you have in mind, or send me a message.",
   "photo": "https://drive.google.com/file/d/1NTfE0oM1IIXXaQ2nUncBhSwjJ0_ZJgao/view?usp=drive_link",
   "when": "",
   "button": "Message me",
   "venue": "",
   "summary": "",
   "flyer": ""
  }
 ],
 "gallery": [
  {
   "photo": "https://drive.google.com/file/d/195x0hS57V75HZyoTL26h7ozvB19fJKL6/view?usp=drive_link",
   "caption": "Birthday cookies"
  },
  {
   "photo": "https://drive.google.com/file/d/1q0DR7rL7BpoTElkGvcmlfjG0xIThHlvS/view?usp=drive_link",
   "caption": "Baby shower cookies"
  },
  {
   "photo": "https://drive.google.com/file/d/1pY87fAp4FOo0eqBQzsgMbER453gJHVeL/view?usp=drive_link",
   "caption": "Wedding shower cookies"
  },
  {
   "photo": "https://drive.google.com/file/d/1yhgHxLn81YeqbXrzTkUn91zyNxzCO8-y/view?usp=drive_link",
   "caption": "Graduation"
  },
  {
   "photo": "https://drive.google.com/file/d/1GiLNI6cM58DUyoNQXeSGO9d1mep6UsLF/view?usp=drive_link",
   "caption": "Birthday"
  },
  {
   "photo": "https://drive.google.com/file/d/1eDpEn84y0RrwhJ3GN-3lg8_IuC3XnQ3m/view?usp=drive_link",
   "caption": "Artisan box cookies"
  },
  {
   "photo": "https://drive.google.com/file/d/12R4TcQpX64dxld6iQ3tHxttQ1q0XpEc9/view?usp=drive_link",
   "caption": "Custom set cookies"
  },
  {
   "photo": "https://drive.google.com/file/d/1UR51KuNMQnnrrx4mzgMyFp7yb8lSsCHA/view?usp=drive_link",
   "caption": "Birthday Party"
  },
  {
   "photo": "https://drive.google.com/file/d/1dVtaE7qWS6-cL5rwnSvdk7UCa2p0zL_B/view?usp=drive_link",
   "caption": "Dog Party"
  },
  {
   "photo": "https://drive.google.com/file/d/1VFocdWGkiHFdOxNk5y0k-JwsowS87i-a/view?usp=drive_link",
   "caption": "Baby Shower"
  },
  {
   "photo": "https://drive.google.com/file/d/1yqE328FmyqKofRU9MKnzfpcBM_wZSjqv/view?usp=drive_link",
   "caption": "Garden Theme"
  },
  {
   "photo": "https://drive.google.com/file/d/132TROTZh-hjQDt1wtaOK1tx5AbkCx-IX/view?usp=drive_link",
   "caption": "Winnie the Pooh Theme"
  },
  {
   "photo": "https://drive.google.com/file/d/1rqe5y84dXJuM4Rmh1tFTpAxln5jQrzEj/view?usp=drive_link",
   "caption": "KPop Demon Hunters"
  },
  {
   "photo": "https://drive.google.com/file/d/1fYECyAJd7J-w7hlB9V69aYYyvDI_w9Oj/view?usp=drive_link",
   "caption": "Strawberry"
  },
  {
   "photo": "https://drive.google.com/file/d/1VIMJ_DNH9n5xiBPa08k-vhi-vHUcjKtf/view?usp=drive_link",
   "caption": "Woodland Theme"
  },
  {
   "photo": "https://drive.google.com/file/d/1mdw67eE9nWjsOtVVPgOr7bB1eeY9tRky/view?usp=drive_link",
   "caption": "Lego Theme"
  },
  {
   "photo": "https://drive.google.com/file/d/1zSis-DU2QpFcp5V_3uNzLf6oZD-ww1-9/view?usp=drive_link",
   "caption": "New York"
  },
  {
   "photo": "https://drive.google.com/file/d/1g93i7Thw2uUFYRmas8Xn0e0aI28uBxsk/view?usp=drive_link",
   "caption": "Tennis"
  },
  {
   "photo": "https://drive.google.com/file/d/1LXugSYUowI-IqQOZ8xHxyAMMqhtvZWRN/view?usp=drive_link",
   "caption": "Irish Wedding Shower"
  },
  {
   "photo": "https://drive.google.com/file/d/1FcY8pb2v3EFW__h0OjLcCkTFLebwjkb5/view?usp=drive_link",
   "caption": "Minnie Mouse"
  },
  {
   "photo": "https://drive.google.com/file/d/10cGMRIEdQV9RVesUlzDubgmnGEJBm1e2/view?usp=drive_link",
   "caption": "Cars"
  },
  {
   "photo": "https://drive.google.com/file/d/16xF6UAppepucHISEP77GPvtCif9QNsPC/view?usp=drive_link",
   "caption": "Poker"
  },
  {
   "photo": "https://drive.google.com/file/d/1FwRES_GHzSirQCc_xtX3Kl9vWhhzeg6G/view?usp=drive_link",
   "caption": "Smores"
  },
  {
   "photo": "https://drive.google.com/file/d/1LMJsMtDU3zhurBb-DL89K7RC2rtaUt0l/view?usp=drive_link",
   "caption": "Lemon"
  },
  {
   "photo": "https://drive.google.com/file/d/1E58pWiHJ-cChyhlQVp5aumJBNftwtA-0/view?usp=drive_link",
   "caption": "Baby Sprinkle"
  },
  {
   "photo": "https://drive.google.com/file/d/1kcxYKAkPdEnJcJZdR9OEpth4msZpFWaI/view?usp=drive_link",
   "caption": "College Bound"
  },
  {
   "photo": "https://drive.google.com/file/d/1UX44Ke2QSElo_kKQHVrCxkry37gPef_u/view?usp=drive_link",
   "caption": "Halloween Birthday"
  },
  {
   "photo": "https://drive.google.com/file/d/126aKxCEUYkBwX360-en-sMM2wmBZ9xU8/view?usp=drive_link",
   "caption": "Business"
  }
 ],
 "classesPayOnline": true,
 "blockedDates": [
  "2026-11-26",
  "2026-12-24",
  "2026-12-25",
  "2026-12-26"
 ]
});
/* LIVE SNAPSHOT END */

const SN = {
  clone(o) { return JSON.parse(JSON.stringify(o)); },

  // Settings for the public pages: live settings from the Sheet (once SN.ready resolves), else SN_DEFAULTS.
  // opts.ignorePreview: the prototype admin page, which still edits this browser's own copy until phase 2.
  load(opts) {
    let cfg = SN.clone(SN_DEFAULTS);
    try {
      if (opts && opts.ignorePreview) {
        const raw = localStorage.getItem('sn_config');
        if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
      } else {
        if (SN._live) cfg = Object.assign(cfg, SN.clone(SN._live));
        // Preview from the prototype admin (same browser) when the Sheet has no draft.
        const local = SN.isPreview() && !SN._serverDraft ? localStorage.getItem('sn_config_draft') : null;
        if (local) cfg = Object.assign(cfg, JSON.parse(local));
      }
    } catch (e) { /* storage unavailable: use defaults */ }
    return SN.dropPastDates(cfg);
  },
  _live: null,          // settings from the Sheet (in preview mode: live settings with the draft applied)
  _serverDraft: false,  // true when the Sheet's Draft tab had unsaved admin changes

  /* ---------- Talking to the Apps Script web app ---------- */
  // GET returns JSON. POST uses text/plain with a JSON body and no custom headers, so the browser skips the CORS preflight.
  request(opts, timeoutMs) {
    if (!SN_ENV.api) return Promise.reject(new Error('No API URL set for ' + SN_ENV.name));
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const url = SN_ENV.api + (opts.query ? '?' + opts.query : '');
    const init = opts.body ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(opts.body) } : {};
    if (ctrl) init.signal = ctrl.signal;
    return fetch(url, init)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(timer));
  },
  // Every send carries the maintenance password if this browser has one, so testing works while the site is closed.
  post(action, data) { return SN.request({ body: Object.assign({ action }, data, SN.bypassKey() ? { bypass: SN.bypassKey() } : {}) }, 45000); },

  // Send a message, retrying once if the server's answer gets lost (slow moment, flaky signal). A one-time ID
  // makes the retry safe: the server recognizes it and answers "already got it" instead of saving it twice.
  sendMessage(data) {
    const body = Object.assign({ submissionId: SN.newSubmissionId() }, data);
    const lost = (r) => !(r && r.ok === false);   // a real "no" from the server isn't retried; a missing answer is
    return SN.post('sendMessage', body).catch((r) => {
      if (!lost(r)) throw r;
      return new Promise((res) => setTimeout(res, 2500)).then(() => SN.post('sendMessage', body));
    }).catch((r) => {
      if (!lost(r)) throw r;
      throw { ok: false, error: 'We couldn’t confirm your message was sent. Please wait a minute before trying again; if it went through, you’ll get a reply by email. You can also message us on Instagram ' + (SN.load().instagramHandle || '') + '.' };
    });
  },

  /* ---------- "Are you sure? … Did you mean …@gmail.com?" under every email box ---------- */
  emailHints() {
    const hintFor = (input) => {
      let h = input.parentNode.querySelector('.email-hint[data-for="' + input.id + '"]');
      const fix = SN.emailFix(input.value);
      if (!fix) { if (h) h.hidden = true; return; }
      if (!h) {
        h = document.createElement('p');
        h.className = 'email-hint';
        h.dataset.for = input.id;
        h.setAttribute('aria-live', 'polite');
        input.insertAdjacentElement('afterend', h);
      }
      h.innerHTML = '<strong>Are you sure? This email looks like it has a typo.</strong> Did you mean ' + SN.esc(fix) + '? <button type="button" class="link-btn" data-email-fix="' + SN.esc(fix) + '">Use it</button>';
      h.hidden = false;
    };
    document.addEventListener('input', (e) => { if (e.target.type === 'email' && e.target.id) hintFor(e.target); });
    document.addEventListener('focusout', (e) => { if (e.target.type === 'email' && e.target.id) hintFor(e.target); });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-email-fix]');
      if (!b) return;
      e.preventDefault();
      const input = document.getElementById(b.closest('.email-hint').dataset.for);
      input.value = b.dataset.emailFix;
      ['input', 'change', 'focusout'].forEach((t) => input.dispatchEvent(new Event(t, { bubbles: true })));
      input.focus();
    });
  },

  /* ---------- Maintenance mode bypass ---------- */
  bypassKey() { try { return localStorage.getItem('sn_bypass') || ''; } catch (e) { return ''; } },
  setBypassKey(v) { try { if (v) localStorage.setItem('sn_bypass', v); else localStorage.removeItem('sn_bypass'); } catch (e) { /* ignore */ } },
  // Friendly text for a failed send. r is the server's reply ({ ok:false, error | errors }) or a network error.
  sendErrorText(r) {
    if (r && r.code === 'invalid' && r.errors) return 'Please check: ' + r.errors.join(', ') + '.';
    if (r && r.error && r.ok === false) return r.error;
    return 'Sorry, that didn’t go through. Please check your connection and try again in a minute. If it keeps happening, message me on Instagram ' + (SN.load().instagramHandle || '') + '.';
  },

  // Loads live settings once per page. The Sheet's server takes a second or more to answer, so this browser
  // remembers the last copy:
  //   - under 30 seconds old: used as is
  //   - under 30 minutes old: used right away, and a fresh copy is fetched in the background for the next page
  //     (prices, spots and codes are re-checked by the server when an order is placed; layout.js reacts to the
  //     fresh copy's maintenance mode through the 'sn:config' event)
  //   - older, or none yet: the page waits for the server.
  fetchConfig() {
    const preview = SN.isPreview();
    let cached = null;
    if (!preview) { try { cached = JSON.parse(localStorage.getItem(SN.CONFIG_KEY) || 'null'); } catch (e) { /* ignore */ } }
    const age = cached ? Date.now() - cached.t : Infinity;
    const fetchFresh = () => SN.request({ query: 'action=config' + (preview ? '&preview=1' : '') }, 10000).then((r) => {
      if (!r || !r.ok || !r.config) return false;
      SN._live = r.config;
      SN._serverDraft = !!r.hasDraft;
      if (!preview) { try { localStorage.setItem(SN.CONFIG_KEY, JSON.stringify({ t: Date.now(), cfg: r.config })); } catch (e) { /* ignore */ } }
      return true;
    });
    if (cached && age < 30 * 1000) { SN._live = cached.cfg; return Promise.resolve(); }
    if (cached && age < 30 * 60 * 1000) {
      SN._live = cached.cfg;
      fetchFresh().then((ok) => { if (ok) document.dispatchEvent(new CustomEvent('sn:config')); }).catch(() => { /* keep the remembered copy */ });
      return Promise.resolve();
    }
    // Waiting on the Sheet (first visit, or a copy older than 30 minutes): the page content stays hidden so built-in
    // values don't flash, then fades in once the real settings are on the page (or after 2.5 s if the Sheet is slow).
    const root = document.documentElement;
    root.classList.add('sn-loading');
    const reveal = () => root.classList.remove('sn-loading');
    setTimeout(reveal, 2500);
    const p = fetchFresh()
      .catch(() => { /* Sheet unreachable: pages fall back to SN_DEFAULTS */ })
      .then(() => { SN.configFailed = !SN._live; });
    p.then(() => setTimeout(reveal, 30));   // after the pages' own SN.ready handlers have filled things in
    return p;
  },
  CONFIG_KEY: 'sn_live_cfg_v2',
  // Forget the remembered settings, so the next page asks the server (after booking spots, leaving preview).
  dropCachedConfig() { try { localStorage.removeItem(SN.CONFIG_KEY); sessionStorage.removeItem('sn_live_cfg'); } catch (e) { /* ignore */ } },
  // True when the Sheet couldn't be reached: pages show the built-in wording, and the order page pauses ordering
  // (the built-in prices and flavors may be out of date).
  configFailed: false,
  // Blocked dates in the past are removed automatically so the list doesn't get cluttered.
  dropPastDates(cfg) {
    const today = SN.isoDate(new Date());
    cfg.blockedDates = (cfg.blockedDates || []).filter((d) => d >= today).sort();
    return cfg;
  },

  /* ---------- Preview mode (admin "Preview changes") ---------- */
  // A tab opened with ?preview=1 shows the admin's unsaved draft until the visitor exits preview.
  // The draft comes from the Sheet's Draft tab (phase 2 admin) or, for the prototype admin, this browser's storage.
  isPreview() {
    try {
      if (new URLSearchParams(location.search).get('preview') === '1') sessionStorage.setItem('sn_preview', '1');
      return sessionStorage.getItem('sn_preview') === '1' && (SN._serverDraft || !!localStorage.getItem('sn_config_draft') || !SN._live);
    } catch (e) { return false; }
  },
  exitPreview() { try { sessionStorage.removeItem('sn_preview'); } catch (e) { /* ignore */ } SN.dropCachedConfig(); },
  saveDraft(cfg) { try { localStorage.setItem('sn_config_draft', JSON.stringify(cfg)); return true; } catch (e) { return false; } },
  clearDraft() { try { localStorage.removeItem('sn_config_draft'); } catch (e) { /* ignore */ } },
  save(cfg) {
    try { localStorage.setItem('sn_config', JSON.stringify(cfg)); return true; } catch (e) { return false; }
  },
  reset() { try { localStorage.removeItem('sn_config'); } catch (e) { /* ignore */ } },

  // Bag lives in sessionStorage so it survives moving between pages.
  getBag() { try { return JSON.parse(sessionStorage.getItem('sn_bag') || '[]'); } catch (e) { return []; } },
  // Photos ride along in the bag. If they don't fit in the browser's storage, the bag is kept without them
  // (the page that's open still has them in memory and sends them).
  setBag(bag) {
    try { sessionStorage.setItem('sn_bag', JSON.stringify(bag)); } catch (e) {
      try { sessionStorage.setItem('sn_bag', JSON.stringify(bag.map((it) => Object.assign({}, it, { photos: undefined, photoData: undefined })))); } catch (e2) { /* ignore */ }
    }
  },

  // Most photos a customer can attach to a custom cookie item or a message (the server allows the same).
  maxPhotos: 5,

  // Tap-to-open note shown under every inspiration-photo upload (order and contact pages).
  aiPhotoNote: '<details><summary>Using AI images for inspiration?</summary><p>AI images are welcome as inspiration! Just know they often show details that can’t be made with real icing and cookies, so your set will be my hand-decorated take on the idea, not an exact match to the picture.</p></details>',
  // The "add up to 5 photos" box on the order and contact pages: previews with × to remove, and an add button.
  // el is an empty container; opts: { id (for the file input), label, photos (to start with), onChange }.
  // Returns { photos() → [{ name, data }], busy() → true while a photo is still being shrunk }.
  photoPicker(el, opts) {
    const photos = (opts.photos || []).slice();
    let pending = 0, note = '';
    function draw() {
      const room = SN.maxPhotos - photos.length - pending;
      el.innerHTML =
        (photos.length || pending
          ? '<div class="photo-picks">' +
              photos.map((p, i) => '<span class="photo-pick"><img src="' + p.data + '" alt="Photo ' + (i + 1) + '">' +
                '<button type="button" class="photo-x" data-photo-x="' + i + '" aria-label="Remove photo ' + (i + 1) + '">×</button></span>').join('') +
              '<span class="photo-pick loading" aria-hidden="true"></span>'.repeat(pending) +
            '</div>'
          : '') +
        (room > 0
          ? '<label class="upload" for="' + opts.id + '"><span>' + SN_ICONS.upload + '</span>' +
              '<span><strong>' + (pending ? 'Preparing your photos…' : photos.length ? 'Add more photos' : opts.label) + '</strong><br>' +
              '<span class="hint">' + SN.esc(note || 'Up to ' + SN.maxPhotos + ' photos from your phone or computer') + '</span></span>' +
              '<input type="file" id="' + opts.id + '" accept="image/*" multiple class="sr-only"></label>'
          : '<p class="hint">' + SN.maxPhotos + ' photos is the most you can add. Remove one to swap it for another.</p>');
    }
    const changed = () => { draw(); if (opts.onChange) opts.onChange(); };
    el.addEventListener('change', (e) => {
      if (e.target.id !== opts.id) return;
      const files = Array.from(e.target.files || []);
      const room = SN.maxPhotos - photos.length - pending;
      note = files.length > room ? 'Only ' + SN.maxPhotos + ' photos fit, so the first ' + room + ' were added.' : '';
      files.slice(0, room).forEach((f) => {
        pending++;
        SN.shrinkPhoto(f).then((p) => { photos.push(p); }).catch((err) => { note = err.message; })
          .then(() => { pending--; changed(); });
      });
      changed();
    });
    el.addEventListener('click', (e) => {
      const x = e.target.closest('[data-photo-x]');
      if (!x) return;
      photos.splice(Number(x.dataset.photoX), 1);
      note = '';
      changed();
    });
    draw();
    return { photos: () => photos.slice(), busy: () => pending > 0 };
  },

  // A customer's photo, shrunk in the browser to a JPEG (longest side max px, about half a megabyte) so up to 5
  // upload quickly from a phone and fit in the bag. Resolves { name, data } where data is a data: URL; rejects if
  // the browser can't read the image.
  shrinkPhoto(file, max) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('No file')); return; }
      const src = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, (max || 1280) / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';   // transparent PNGs get a white background, not black
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(src);
        let q = 0.82, data = c.toDataURL('image/jpeg', q);
        while (data.length > 700000 && q > 0.4) { q -= 0.12; data = c.toDataURL('image/jpeg', q); }
        resolve({ name: String(file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', data });
      };
      img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('That photo couldn’t be read. Try a JPG or PNG.')); };
      img.src = src;
    });
  },

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

  /* ---------- Editable page content (Pages / Events / Gallery tabs) ---------- */
  // A photo cell as a usable image address, or '' when it's blank or a [placeholder].
  // Google Drive share links ("…/file/d/ID/view" or "…open?id=ID") become a direct image link.
  photoUrl(v) {
    const s = String(v || '').trim();
    if (!s || s[0] === '[') return '';
    const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1600';
    return /^(https?:)?\/\//.test(s) || /^[\w./-]+\.(jpe?g|png|webp|gif|avif)$/i.test(s) ? s : '';
  },
  // The [placeholder] label for a photo cell, or ''.
  photoPlaceholder(v) { const s = String(v || '').trim(); return s[0] === '[' ? s : ''; },
  // A photo cell as HTML: the image, a placeholder box, or '' when blank. style applies to either.
  photoHtml(v, alt, style) {
    const url = SN.photoUrl(v), ph = SN.photoPlaceholder(v);
    if (url) return '<img src="' + SN.esc(url) + '" alt="' + SN.esc(alt || '') + '" loading="lazy" style="display:block;width:100%;object-fit:cover;' + (style || '') + '">';
    if (ph) return '<div class="placeholder" style="' + (style || '') + '">' + SN.esc(ph) + '</div>';
    return '';
  },
  // Plain text to paragraphs: blank lines split paragraphs, single line breaks stay as <br>. Text is escaped.
  paras(text, attrs) {
    return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      .map((p) => '<p' + (attrs || '') + '>' + SN.esc(p).replace(/\n/g, '<br>') + '</p>').join('');
  },

  /* ---------- Contact details ---------- */
  // Rejects things like "a@b", "a@b.c" and "a@b..com". apps-script/Code.gs uses the same check.
  validEmail(s) { return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(String(s || '').trim()) && !SN.emailFix(s); },
  // A likely typo in an email's ending or a big provider's name ("pat@gmial.cm" -> "pat@gmail.com"), else ''.
  // Endings like .cm and .con are real or near-real, but for a local bakery they're almost always a slip.
  // Email endings customers really use; anything else gets the 'Are you sure?' fix. Mirrored in Code.gs (EMAIL_ENDINGS).
  EMAIL_ENDINGS: ['com', 'net', 'org', 'edu', 'gov', 'mil', 'us', 'co', 'io', 'me', 'info', 'biz', 'ai', 'app', 'dev', 'ca', 'uk', 'au', 'nz', 'ie', 'de', 'fr', 'mx', 'in'],
  emailFix(s) {
    const m = String(s || '').trim().match(/^([^\s@]+)@([^\s@]+\.[A-Za-z]+)$/);
    if (!m) return '';
    const domain = m[2].toLowerCase();
    const OK = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com', 'me.com', 'mac.com',
      'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net', 'ymail.com', 'mail.com', 'email.com', 'gmx.com', 'proton.me', 'protonmail.com',
      'fastmail.com', 'hey.com', 'duck.com', 'rocketmail.com', 'verizon.com', 'att.com', 'proton.me'];
    if (OK.indexOf(domain) !== -1) return '';
    const TLD = { cm: 'com', con: 'com', cmo: 'com', comm: 'com', om: 'com', vom: 'com', xom: 'com', cpm: 'com', ocm: 'com', coom: 'com',
      nte: 'net', ner: 'net', nett: 'net', ogr: 'org', orh: 'org', rog: 'org' };
    const parts = domain.split('.');
    let tld = parts.pop();
    let name = parts.join('.');
    // Letters apart, counting a swapped pair as one ("gmial" is 1 from "gmail").
    const dist = (a, b) => {
      const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
      for (let j = 1; j <= b.length; j++) d[0][j] = j;
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      return d[a.length][b.length];
    };
    if (TLD[tld]) tld = TLD[tld];
    // Any other ending not on the list (.clm, .comx…) is treated as a typo of .com, .net or .org, whichever is closest.
    if (SN.EMAIL_ENDINGS.indexOf(tld) === -1) tld = ['com', 'net', 'org'].sort((x, y) => dist(tld, x) - dist(tld, y))[0];
    // Big providers, misspelled by a letter or two (or a swapped pair), or with a short ending like gmail.co.
    const BIG = { gmail: 'com', yahoo: 'com', hotmail: 'com', outlook: 'com', icloud: 'com', aol: 'com', live: 'com', comcast: 'net', sbcglobal: 'net', verizon: 'net', protonmail: 'com' };
    if (!/\./.test(name)) {
      const hit = Object.keys(BIG).find((p) => p === name ||
        (p.length >= 5 && name.length >= 3 && name[0] === p[0] && dist(name, p) <= 2) ||   // gml, gmal, yhoo, hotmal
        (p.length >= 5 && name.length >= 4 && dist(name, p) <= (p.length >= 7 ? 2 : 1)));
      if (hit) { name = hit; tld = BIG[hit]; }
    }
    const fixed = name + '.' + tld;
    return fixed !== domain ? m[1] + '@' + fixed : '';
  },
  // Just the digits of a US phone number, at most 10. A leading country code 1 is dropped (e.g. pasted "+1 847…").
  phoneDigits(s) {
    let d = String(s || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return d.slice(0, 10);
  },
  // "8475550100" -> "847-555-0100" (partial numbers are formatted as far as they go).
  formatPhone(s) {
    const d = SN.phoneDigits(s);
    return d.length > 6 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d;
  },
  validPhone(s) { return SN.phoneDigits(s).length === 10; },
  // Wire a phone box: digits only, up to 10, dashes added as they type.
  phoneInput(el) {
    el.setAttribute('inputmode', 'numeric');   // no maxlength: a pasted "+1 (847) 555-0100" must reach the formatter whole
    el.addEventListener('input', () => { const v = SN.formatPhone(el.value); if (el.value !== v) el.value = v; });
  },

  money(n) { const v = Math.round(n * 100) / 100; return (v < 0 ? '−' : '') + '$' + Math.abs(v).toFixed(2); },   // −$5.00, not $-5.00
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  customPrice(cfg) { return Number(cfg.customBasePrice) || 0; },
  perCookie(cfg, kind) { return (kind === 'mini' ? cfg.miniPerDozen : cfg.largePerDozen) / 12; },

  // Artisan flavor limit: flavorsPerDozen (4) below flavorsMaxAt cookies (24), then flavorsMax (6). Same rule in Code.gs.
  flavorLimit(cfg, qty) { return qty >= (Number(cfg.flavorsMaxAt) || 24) ? (Number(cfg.flavorsMax) || 6) : (Number(cfg.flavorsPerDozen) || 4); },
  artisanCheck(cfg, fq) {
    const qty = Object.values(fq || {}).reduce((a, b) => a + b, 0);
    const used = Object.values(fq || {}).filter((v) => v > 0).length;
    const max = SN.flavorLimit(cfg, qty);
    const atMost = qty >= (Number(cfg.flavorsMaxAt) || 24);
    let err = '';
    if (qty < cfg.minQty) err = qty === 0 ? 'Add at least ' + cfg.minQty + ' cookies.' : (cfg.minQty - qty) + ' more to reach the 1 dozen minimum.';
    else if (used > max) err = 'Up to ' + max + ' flavors for ' + qty + ' cookies. Remove a flavor' + (atMost ? '.' : ' or reach ' + cfg.flavorsMaxAt + ' cookies for up to ' + cfg.flavorsMax + '.');
    return { qty, used, max, err };
  },

  // A class in the bag: today's price from the Events settings (or the price when it was added).
  classEvent(cfg, it) { return (cfg.events || []).find((e) => e.id === it.eventId) || null; },
  itemTotal(cfg, it) {
    if (it.kind === 'class') { const ev = SN.classEvent(cfg, it); return it.qty * (ev ? Number(ev.price) || 0 : Number(it.price) || 0); }
    if (it.kind === 'custom') return it.qty * SN.customPrice(cfg);
    return SN.artisanCheck(cfg, it.fq).qty * SN.perCookie(cfg, it.kind);
  },

  /* ---------- Weekly cookie caps (Mon-Sun) ---------- */
  mondayOf(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return SN.isoDate(dt);
  },
  // Cookies still available that week: { custom, artisan } (null = no limit).
  weekRoom(cfg, iso) {
    const load = (cfg.weekLoads || {})[SN.mondayOf(iso)] || { custom: 0, artisan: 0 };
    const room = (cap, used) => (Number(cap) > 0 ? Math.max(0, Number(cap) - used) : null);
    return { custom: room(cfg.capCustomPerWeek, load.custom), artisan: room(cfg.capArtisanPerWeek, load.artisan) };
  },
  // "17:00" (from a time box) -> "5:00 PM"; anything else comes back as is.
  time12(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? ((Number(m[1]) % 12) || 12) + ':' + m[2] + ' ' + (Number(m[1]) < 12 ? 'AM' : 'PM') : String(t || '').trim();
  },
  // "Khepri Kitchen & Coffee, 106 S. Emerson St., Mount Prospect, IL"
  eventPlace(ev) { return [ev.venue, ev.address].filter(Boolean).join(', '); },
  // A maps link for an event: Apple Maps on iPhone, iPad and Mac, Google Maps everywhere else.
  mapsUrl(ev) {
    const q = encodeURIComponent(SN.eventPlace(ev));
    return /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? 'https://maps.apple.com/?q=' + q : 'https://www.google.com/maps/search/?api=1&query=' + q;
  },
  // "Sat, Dec 6 · 2:00 PM–4:00 PM"
  classWhen(ev) {
    const day = ev.date ? SN.prettyDate(ev.date, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    const time = ev.start ? ev.start + (ev.end ? '–' + ev.end : '') : '';
    return [day, time].filter(Boolean).join(' · ');
  },
  // A one-time ID per checkout, so a retry after a dropped connection doesn't place the order twice.
  newSubmissionId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); },

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

  itemLabel(kind) { return kind === 'custom' ? 'Custom Cookies' : kind === 'mini' ? 'Mini Artisan' : kind === 'class' ? 'Class' : 'Large Artisan'; },
  // "24 Custom Cookies", or for a class "2 spots · Holiday decorating"
  itemHeading(it) { return it.kind === 'class' ? it.qty + ' spot' + (it.qty > 1 ? 's' : '') + ' · ' + it.title : it.qty + ' ' + SN.itemLabel(it.kind); },

  describeItem(cfg, it) {
    if (it.kind === 'class') { const ev = SN.classEvent(cfg, it) || it; return [it.summary || SN.classWhen(ev), SN.eventPlace(ev)].filter(Boolean).join(' · '); }
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

  // Starting invoice lines built from the customer's request (same wording as startingLines_ in Code.gs).
  // A percent promo code becomes its own discount line.
  linesFromOrder(cfg, o) {
    const lines = o.items.map((it) => {
      // Orders from the Sheet carry the unit price they were quoted at; otherwise use today's prices.
      const unit = it.unit != null ? it.unit : it.kind === 'custom' ? SN.customPrice(cfg) : SN.perCookie(cfg, it.kind);
      const desc = it.kind === 'class'
        ? 'Class: ' + it.title + (it.summary ? ' (' + it.summary + ')' : '')
        : it.qty + ' ' + SN.itemLabel(it.kind) + (it.summary ? ' (' + it.summary.replace(/ · estimated at .*?each/, '') + ')' : '');
      return { desc, qty: it.qty, unit: Math.round(unit * 100) / 100 };
    });
    if (o.discount) lines.push({ desc: 'Promo code ' + o.promoCode, qty: 1, unit: -Math.round(o.discount * 100) / 100 });
    return lines;
  },
  // Totals for a set of invoice lines. Tax applies to the lines, not the drop-off fee; a gift card credit comes off last.
  // An invoice's totals before sales tax (QuickBooks adds the tax). taxRate is ignored; kept so older calls still work.
  invoiceTotals(lines, fee, taxRate, credit) {
    const subtotal = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0);
    const tax = 0;
    const f = Number(fee) || 0;
    const c = Math.min(Number(credit) || 0, Math.max(0, subtotal + tax + f));
    return { subtotal, tax, fee: f, credit: c, total: subtotal + tax + f - c };
  }
};

// Pages wait on this before reading settings: SN.ready.then(() => { const cfg = SN.load(); ... })
// The admin page (window.SN_ADMIN) gets its data from Apps Script directly, so it skips this.
SN.ready = window.SN_ADMIN ? Promise.resolve() : SN.fetchConfig();

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
