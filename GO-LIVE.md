# Go-live checklist: www.sweetnothingsbym.com

Moving from the test site (GitHub Pages + Leigha's Google account and sandboxes) to the live site (Melissa's domain, Google account, QuickBooks and Square). The test site stays as it is, for trying changes before they go live.

**Who:** **L** = Leigha, **M** = Melissa, **C** = Claude (code changes). Most steps are L; the ones that need Melissa's own logins are marked M.

Keep the site in **maintenance mode** from step 4 until step 8, so nobody can order while things are half set up.

---

## 0. Decisions before starting

- [x] **Live Google account:** `SweetNothingsByM@gmail.com`. The live Sheet and script live here, and customer emails come from it.
- [x] **How does Leigha get into the live admin?** By signing in with Melissa's Google account for go-live. **Admin helpers** (admin → Contact & pickup) is there as an option for later, for someone helping with setup under their own Google account. See step 3.
- [x] **Hosting:** **Cloudflare Pages** (free, HTTPS included). It publishes automatically from the same GitHub repo; GitHub Pages stays the test site.
- [x] **Domain:** sweetnothingsbym.com is registered at **Porkbun**. Its nameservers move to Cloudflare (step 4); it stays registered at Porkbun.
- [ ] **Go-live date**, and a quiet time to do steps 4–8 (about 2–3 hours, plus waiting for the domain). (L + M)

## 1. Build items still to do (C)

- [x] **Privacy policy and terms pages:** `privacy.html` and `terms.html`, linked in the footer and readable even during maintenance. **M reviews the wording**, especially changes/refunds, allergies and pickup.
- [x] **Point the site at the live script:** fill in `PROD_HOSTS`, `API.prod` and `ADMIN.prod` in `config.js` (after step 3, once the live script's URLs exist).
- [ ] *(After go-live)* **Portfolio demo:** the admin running on fake data, with no connection to the test or live Sheet, plus a "how it's connected" page.

## 2. Content (M, with L)

Everything below is edited in the **test** admin first, so it can be checked on the test site. In step 3 the Sheet is copied with it.

- [ ] Prices, minimums, custom-cookie note, allergy note
- [ ] Artisan flavors (names, which are showing, specials)
- [ ] Drop-off ZIP codes and fees
- [ ] Weekly caps, lead days, blocked dates (vacations)
- [ ] Tax rate, **as confirmed by her accountant**
- [ ] Pickup address and pickup instructions (private: only in confirmation emails)
- [ ] Home, About, Events and Gallery text and **real photos** (replace every `[placeholder]`)
- [ ] FAQ answers
- [ ] Classes: dates, times, address, price, max attendees
- [ ] Instagram link and handle

## 3. Melissa's Google account: the live Sheet and script (L, with M signed in)

0. [x] **Use a separate browser window for the live account** (its own Chrome profile, or a private window). Apps Script gets confused when two Google accounts are signed in at once.
1. [x] Leigha shares the **test** Sheet with the live Google account (Share → that email → Editor). Then, signed in as the live account, open it and use **File → Make a copy**. The copy brings the script with it. Name it "Sweet Nothings – LIVE".
   - **Comes over (keep):** everything set up through the admin. That's **Settings** (prices, minimums, caps, lead days, tax, notes, maintenance text), **Flavors**, **Zones** (drop-off ZIPs and fees), **BlockedDates**, **FAQ**, **Pages** (all website wording and photo links), **Events** (classes, prices, max attendees) and **Gallery**.
   - **Test data (cleared in step 2):** Orders, OrderItems, Messages, Outbox, Draft, test promo codes.
2. [x] In the copy, clear the test data:
   - **Orders, OrderItems, Messages, Outbox, Draft:** delete every row except the headers. Class spots reset by themselves, since they're counted from orders.
   - **Codes:** delete the test codes, and keep any real gift cards or promo codes Melissa has already given out.
   - **Counters:** keep `nextOrder` (e.g. 1001) and set `nextMessage` to 1.
   - Customer photos from test orders stay in Leigha's Drive; the live site starts its own uploads folder in step 6.
3. [x] **Settings tab:**
   - `environment` = `PROD` (removes "[TEST]" from email subjects)
   - `siteUrl` = `https://www.sweetnothingsbym.com/`
   - `ownerEmail` and `replyToEmail` = Melissa's business email
   - `senderName` = `Sweet Nothings by M`
   - `maintenanceMode` = `TRUE`, and set a `maintenancePassword`
4. [x] **Extensions → Apps Script.** Paste the latest `apps-script/Code.gs` over everything and **Save**, so the live site starts on today's code. Under **Libraries**, check that **OAuth2** is listed; if not, add `1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF`.
5. [x] **Project Settings → Script Properties.** These are **not** copied with the Sheet, so add them fresh in step 5 and step 6.
6. [x] Run **setupSheet** and allow everything Google asks for: Sheets, Gmail sending, Drive, outside services and triggers. It creates the uploads folder and the 5-minute payment check.
7. [x] **Move the website photos into Melissa's Drive.** In the Apps Script editor, pick **copyWebsitePhotos** in the function list and click **Run**. It copies every photo the site shows (Home, About, menu, Events, Gallery) from Leigha's Drive into a **"Sweet Nothings website photos"** folder in Melissa's Drive, shares each copy so the site can show it, and points the Sheet at the copies. The live site then doesn't depend on Leigha's account at all.
   - Check the message at the bottom of the editor (Execution log): "Copied N photos…". If it lists any it couldn't copy, make sure those photos are shared "anyone with the link" in Leigha's Drive, then run it again (it skips ones already done).
   - Then open the live admin's **Website pages**, **Events** and **Gallery** tabs and check the previews show.
8. [x] **Deploy → New deployment → Web app**, twice:
   - **Public:** Execute as **Me**, Who has access **Anyone**. Copy the URL: this is `API.prod`.
   - **Admin:** Execute as **User accessing the web app**, Who has access **Anyone with Google account**, so helpers can be added later without redeploying. Only the owner and any admin helpers get past the sign-in; everyone else sees "Only the shop owner can do that." Copy the URL: this is `ADMIN.prod`, and it also goes in the Settings tab's `adminUrl`.
9. [x] Send both URLs to C to put in `config.js` (step 1).
10. [ ] *(Optional, any time later)* **Admin helpers.** Not needed for go-live, since Leigha signs in with Melissa's account. When someone should use the admin with their **own** Google account (for example, to help set things up):
   - Signed in as Melissa, go to the live admin → **Contact & pickup** → **Admin helpers**, enter their Gmail, and save. This shares the Sheet and the photos folder with them.
   - They open the admin link with their own Google account and allow the permissions it asks for.
   - Any emails they send from the admin (approvals, messages) wait in a hidden **Outbox** tab and go out from **Melissa's** account at the next 5-minute check. The order shows "Queued" until then.
   - Only Melissa's account can start the 5-minute check, which setupSheet does in item 6.

## 4. Hosting and the domain (L)

The Cloudflare account belongs to the shop: sign up with **SweetNothingsByM@gmail.com** (free plan). Leigha connects her GitHub to it once, in item 5.

1. [x] **Before changing anything at Porkbun:** Porkbun → **Domain Management** → sweetnothingsbym.com → **Details**. Write down anything already set up:
   - **Email forwarding** or email hosting on the domain. Its records have to be added again in Cloudflare.
   - **DNSSEC**. If it's on, turn it off first; it can be turned back on through Cloudflare later.
2. [x] **Cloudflare → Add a domain** → `sweetnothingsbym.com` → **Free** plan. Cloudflare copies the existing DNS records; check that any email records from item 1 are there. It then shows **two nameservers** (like `ada.ns.cloudflare.com`).
3. [x] **Porkbun** → sweetnothingsbym.com → **Authoritative Nameservers** → **Edit** → delete Porkbun's and paste Cloudflare's two → **Submit**.
4. [x] Wait for Cloudflare to say the domain is **Active** (usually within an hour, sometimes up to a day; Cloudflare emails when it is). The domain stays registered and renewed at Porkbun.
5. [x] **Cloudflare → Workers & Pages → Create → Pages → Connect to Git.** Sign in to GitHub as Leigha and allow access to just the `sweetnothingbym` repo. Then:
   - Production branch: `main`
   - Framework preset: **None**, build command: *empty*, output directory: *empty*
   - **Save and Deploy.** The site appears at `sweetnothingbym.pages.dev` (the name may differ slightly) and updates on every publish, just like the test site.
6. [x] In the Pages project → **Custom domains** → add **www.sweetnothingsbym.com**, then **sweetnothingsbym.com**. Cloudflare adds the DNS records and HTTPS certificates itself.
7. [x] Send everyone to **www**: Cloudflare → sweetnothingsbym.com → **Rules → Redirect Rules → Create rule** → template **"Redirect from root to WWW"** (301, keep the path and query) → **Deploy**.
8. [x] Check that **https://sweetnothingsbym.com** lands on **https://www.sweetnothingsbym.com** with the lock icon.
9. [x] C publishes the `config.js` update (live web address and the live script's URLs). Then **www.sweetnothingsbym.com** should show the "back soon" page, and the test site should be unchanged.
10. [x] Enter the maintenance password on the live site. It should show Melissa's content, with no "Test site" banner. **Privacy** and **Terms** (footer) should open without the password.

## 5. QuickBooks: production (L + M)

1. [ ] **M's QuickBooks:**
   - **Sales tax** set up (Taxes → Sales tax), and every cookie item given the **bakery** sales tax category, including the site's **Custom Cookies** and **Artisan Cookies** after connecting. The website no longer works out tax; QuickBooks adds it on each invoice.
   - **QuickBooks Payments** turned on (card and bank transfer), so invoices get a Pay button.
2. [ ] **Intuit developer app:**
   - Rename it from "Test App" to "Sweet Nothings by M website".
   - Fill in the production questionnaire. Its links: privacy policy, terms, the host domain `sweetnothingsbym.com`, and launch/disconnect URL = the live site.
3. [ ] **Production Keys & credentials:** add the redirect URI. The live script's ID is different, so copy the one shown on the live admin's **Payments** tab.
4. [ ] **Live Script Properties:**
   - `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` (the **Production** ones)
   - `QBO_ENV` = `production`
5. [ ] Live admin → **Payments** → **Connect QuickBooks**. **M signs in** and picks her real company. It should say "Connected" and "Invoice items are ready".

## 6. Square: production (M, with L)

1. [ ] **M signs in** to developer.squareup.com with **her** Square login and creates an application. If the token came from Leigha's developer account, class payments would go into Leigha's Square account.
2. [ ] **Live Script Properties:**
   - `SQUARE_ACCESS_TOKEN` (production access token)
   - `SQUARE_LOCATION_ID` (her location)
   - `SQUARE_ENV` = `production`
3. [ ] Live admin → **Payments**: Square should say "Connected to (her location)".

## 7. Real-money tests, small amounts (L + M)

With the maintenance password entered, in a normal browser:

1. [ ] Admin → **Promo & gift codes**: make `TEST95`, **95% off, max 3 uses**.
2. [ ] **Cookie order:**
   - Order 12 cookies with `TEST95`, a drop-off ZIP and an inspiration photo.
   - Check the request email and the owner alert, which should have a photo link.
   - Approve it in admin. The confirmation email's **tax and Amount due should match the QuickBooks invoice**, with no red note in admin. **If the tax is $0, stop here.** See the QuickBooks tax note at the end.
   - Pay it with a real card. It should change to **Paid** in admin within about 7 minutes.
3. [ ] **Class:**
   - Book a class with `TEST95` and pay in Square.
   - You should get "You're booked!", the confirmation and the owner alert, and admin should show **Paid**.
4. [ ] **Contact form:** send a message with a photo. It should show in admin → Messages and in the Drive "Sweet Nothings uploads" folder.
5. [ ] **Clean up:**
   - Refund both test payments (QuickBooks invoice → Refund; Square → Transactions → Refund).
   - Set the test orders to **Cancelled**.
   - Delete `TEST95`.

## 8. Open the doors (M)

- [ ] Admin → **Website pages** → turn **Maintenance mode off** → **Save changes**.
- [ ] Check the live site in a private window: no "back soon" page, and no test banners.
- [ ] Put the website link on Instagram and anywhere else it should go.

## 9. After launch

- [ ] Watch the first few real orders end to end: request → approve → invoice → Paid.
- [ ] Check that admin → Payments shows "Last check" updating every few minutes.
- [ ] **Email limit:** a regular Gmail account can send about 100 emails a day from the script. That's plenty for a small shop. If it's ever hit, emails fail until the next day; admin shows "FAILED" on the order and **Resend** works then.
- [ ] Keep the test site for trying changes: edit there first, check, then publish.

---

### Note: QuickBooks sales tax

In the sandbox, invoices the script created came out with **$0 sales tax**, even though the site sent the amount. The sandbox only allows a California address, so this couldn't be tested properly for Illinois. It's checked in step 7. If the live invoices also show $0 tax, the options are:
- a QuickBooks setting so its automatic sales tax applies to invoices made by apps, or
- (only with the accountant's OK) adding tax as its own invoice line.
