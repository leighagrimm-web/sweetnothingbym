# Sweet Nothings by M — website prototype

A clickable prototype of the ordering site for **Sweet Nothings by M** ([@sweet_nothings_by_m](https://www.instagram.com/sweet_nothings_by_m/)).

## What's in here

| Page | What it does |
|---|---|
| `index.html` | **Landing page.** Hero with **Start your order**, what she makes (with live prices), how ordering works, recent creations, and links to FAQ and Contact. |
| `order.html` | **Order page.** Menu of Custom Cookies (starting at $5/cookie), Mini Artisan and Large Artisan. Each opens a slide-over to customize and **Add to bag**. The **Bag** collects event type, date (8+ days out), allergies/dietary needs (optional), pickup or drop-off (fee by ZIP) and contact details, shows an **estimated** total, and sends a **preliminary order request** (no payment yet). |
| `faq.html` | **FAQ.** Questions and answers she edits from the admin page (starter answers have [brackets] for her details). |
| (every page) | **Message me** pop-out form (email + message only), opened by any button with `data-quick-message="<topic>"`. Used on Special Events. |
| `contact.html` | **Contact form.** Name, email (required), phone (optional), topic, message and an optional photo. Messages show in the admin **Messages** inbox. |
| `admin.html` | **Owner admin.** Orders arrive as *Pending review*. **Review** opens the request with an editable invoice: approve as-is, approve with changes (edit prices/qty, add lines, change drop-off fee, add a note), or decline. Approving sends the invoice. **Preview changes** opens the site in a new tab showing her unsaved edits (yellow "Preview mode" banner, ordering turned off) before she saves. Also: **Messages** inbox from the Contact page and the "Message me" form, **FAQ editor**, custom starting price + pricing note, artisan prices, add/hide/delete flavors, monthly special, lead time, blocked dates, drop-off ZIPs, contact info. (Sales tax isn't set on the site: QuickBooks adds it to each invoice.) |
| `email.html` | Email previews: `?type=request` (request received), `?type=invoice` (approved, with Pay button), `?type=declined`. Add `&o=SN-1042` to show a real test order. |
| `about.html`, `events.html`, `gallery.html` | Content pages with `[bracketed]` placeholders for M's story and photos. |

Settings live in `js/config.js` (`SN_DEFAULTS`). Shared look is in `css/styles.css`.

## Backend (phase 1)

- Settings, orders and messages live in a **Google Sheet**, served by a **Google Apps Script** web app. Setup steps are in [`apps-script/README.md`](apps-script/README.md).
- `config.js` → `SN_ENV` picks the backend by website address: the GitHub Pages site uses the **UAT** Sheet, and Melissa's domain will use **PROD**.
- Sending an order request saves it as `SN-####`, emails the customer "request received (not yet confirmed)", and emails the owner "New order to review". Contact and "Message me" messages are saved and emailed to the owner, with reply-to set to the customer.
- If the Sheet can't be reached, pages show the built-in defaults, and sending shows a friendly error.

## Publishing updates

Every page loads `styles.css` and the scripts with a version number, for example `styles.css?v=20261022`. Phones and browsers otherwise keep the old file for up to 10 minutes. When you change CSS or JS, change that number everywhere it appears, using the date (add a letter for more than one publish a day). Find-and-replace the old number with the new one across:

- the `.html` files (`?v=` on every link and script)
- `config.js` (`SN_BUILD`)
- `version.json`

A visitor with a tab left open from before the publish gets the new version when they come back to it. The page compares its `SN_BUILD` with `version.json` and reloads itself, or, if their bag or checkout is open, shows a "this page has been updated" banner instead.

## Owner admin (phase 2)

- The admin runs on Apps Script behind the owner's Google sign-in. `admin.html` on the website just links to it.
- Melissa uses it to:
  - review orders and approve them (as-is or with changes) or decline them, which emails the customer
  - set statuses after approval
  - manage messages
  - edit every setting, including the Home, About, Events and Gallery pages
  - preview changes before saving
- Days with `maxOrdersPerDay` approved orders (Invoice sent and later) are blocked on the site automatically.

## Still to come (later phases)

- **Phase 3: customer photo uploads.** Inspiration photos from the order and Contact forms will be saved to a Google Drive folder, with thumbnails in the admin, the owner emails and the Sheet. Today only the file name is recorded.
- **Phase 4: QuickBooks.** Approving an order creates and sends the QuickBooks invoice with a Pay button (sandbox first), and the confirmation email gets the real Pay link.
- **Launch:** replace the `[bracketed]` placeholder copy and photos (in the admin), switch to Melissa's Google account, and add her custom domain.

## Adding real photos

In the admin, open **Website pages**, **Events** or **Gallery** and paste a Google Drive share link into a photo box. In Drive, use **Share → General access → Anyone with the link → Copy link**. A small preview shows next to the box.
