# ACRI HR Portal: hr.acriindia.org.in

A facilitator and admin portal for Ahmedabad Centre for Research and Innovation.

- **Facilitators** (`/`) see their sessions, submit attendance, track every payment and its status, and raise queries.
- **Admins** (`/admin/`) verify attendance, approve, withhold, reject or pay payments, manage facilitators, sessions and programmes, answer queries, and email facilitators.
- **ACRI Abhivyakti Fund**: the Vice President records money received and ACRI's deductions under titled heads. Facilitators are paid from what is left. A regular session the fund can't cover yet waits for funds. An extra session the fund can't cover is recorded as pro bono.
- **Automatic emails** go out through Zoho Mail (self client) for new accounts, attendance results, payment updates, query responses and pro bono sessions. Admins can also email one facilitator or all of them.

```
public/            → the website (deploy from GitHub to Cloudflare)
  index.html         facilitator portal
  admin/index.html   admin console
  config.js          ← put your Apps Script URL here
  assets/            styles, page helpers, logo
backend/
  Core.js            → paste into Apps Script as Core.gs
  Code.js            → paste into Apps Script as Code.gs
test/core.test.js  → `node test/core.test.js` checks the payment and fund rules
wrangler.jsonc     → Cloudflare Workers static-site config
```

---

## 1. Google Sheet and Apps Script

1. Create a new Google Sheet named **ACRI HR Portal Data**. Copy its ID from the URL (the part between `/d/` and `/edit`).
2. In the Sheet, open **Extensions → Apps Script**.
3. Create two script files, **Core.gs** and **Code.gs**, and paste in `backend/Core.js` and `backend/Code.js`.
4. Open **Project Settings → Script properties** and add:

| Property | Value |
|---|---|
| `SHEET_ID` | the Sheet ID |
| `ADMIN_EMAIL` | your admin email (e.g. `president@acriindia.org`) |
| `ADMIN_NAME` | `Fenil Pritesh Shah` |
| `ADMIN_PASSWORD` | a temporary password, 8+ characters (delete it after setup) |
| `VP_EMAIL` / `VP_NAME` | Prashant Pareek's email / `Prashant Pareek` |
| `YASHVI_EMAIL` | Yashvi's email |

5. In the editor, select **setup** and click **Run**. Approve the permissions.
   This creates all the tabs, the deduction heads, your owner account, the Vice President account, the Abhivyakti 2026–27 programme, and Yashvi with Sessions 1–3 (17, 24, 31 Oct) marked present. Her payments start as "Rate to be finalised".
6. Delete `ADMIN_PASSWORD` from Script properties.
7. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**. Copy the URL ending in `/exec`.

## 2. Zoho Mail self client (automatic emails)

1. Go to **api-console.zoho.in → Add Client → Self Client**. Copy the Client ID and Client Secret.
2. Add Script properties: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ACCOUNTS_HOST` = `accounts.zoho.in`, `ZOHO_MAIL_HOST` = `mail.zoho.in`, and `ZOHO_FROM_ADDRESS` = the mailbox that sends (for example `hr@acriindia.org`). It must be a mailbox in your Zoho account.
3. In the Self Client, open **Generate Code**, enter the scope `ZohoMail.messages.CREATE,ZohoMail.accounts.READ`, set the duration to 10 minutes, and generate.
4. In Code.gs, paste that code into `exchangeZohoCode()` and run it. It saves `ZOHO_REFRESH_TOKEN`.
5. Run `findZohoAccountId()`. It saves `ZOHO_ACCOUNT_ID`.
6. Run `testEmail()` and check your inbox.

Each email is logged in the **EmailLog** tab and in Admin → Emails. A failed email never blocks the action that triggered it.

## 3. Website on GitHub and Cloudflare

1. Put this folder in a GitHub repository.
2. In `public/config.js`, set `API_URL` to the `/exec` URL from step 1.7 and commit.
3. Deploy, using either option:
   - **Cloudflare Workers**: Workers & Pages → Create → Import a repository. It reads `wrangler.jsonc` and serves `public/`.
   - **Cloudflare Pages**: Create → Pages → Connect to Git. Leave the build command empty and set the output directory to `public`.
4. Under **Custom domains**, add `hr.acriindia.org.in`.

Every push to GitHub redeploys the site. If you change `backend/Core.js`, paste it into Core.gs again.

## 4. Day-to-day use

**Getting Yashvi started.** Go to Admin → Facilitators → **Send new password**. She gets her login by email and must set her own password on first login.

**After each session**
- The facilitator clicks **Submit attendance**. Admin → Attendance → **Verify present**, **Mark absent** (no pay), or **Reject** with a reason if there's a discrepancy (no pay unless it's resolved).
- Admins can also record attendance directly with **Set** in the attendance register.

**How facilitators are paid: lump sum split** (the default for Abhivyakti)

There is no rate per session. The money works like this:

1. **Money received.** The Vice President records each lump sum from the school under Admin → Abhivyakti Fund → *Record money received*.
2. **ACRI deductions come first.** He records each deduction under a titled head. A deduction is **final**: it cannot be edited or deleted later, so he has to tick a box confirming that.
3. **What's left is the facilitator pool.** It's split between the facilitators **equally**, or by a share % set under Admin → Payments → *Change*.
4. **Missed sessions reduce a share.** Each facilitator's part = pool × their share % × (sessions attended ÷ sessions held so far). For example, 50% of ₹18,000 is ₹9,000. Attending 3 of 5 sessions gives ₹5,400. The ₹3,600 not paid stays in the fund for ACRI to decide on later.
5. **Pay out.** Admin → Payments → *Pay out*. This creates one payment per facilitator and emails each of them how it was worked out.
6. **Later lump sums.** When more money comes in, record it and click *Pay out* again. The portal works everyone's share out again and pays only the difference.

Extra sessions are pro bono and aren't counted either way. The other payment models (flat rate per session, per-student amount) are still available under Programme & Sessions → Edit payment settings if ever needed.

**Paying**
- Admin → Payments → **Approve**, then **Mark paid** after the bank transfer, with the UTR. The facilitator gets an email at each step.
- **Withhold** or **Reject** requires a reason, and the reason is shown to the facilitator.
- Approved and paid payments are never changed automatically.

Facilitators see a summary of the fund (received, deductions by head, facilitator pool). To hide it, go to Admin → Team & Settings and set **Show the fund summary to facilitators** to No.

## Security notes
- Passwords are stored as salted SHA-256 hashes, never in plain text. Login sessions last 6 hours.
- Only the owner can add admins. Only the owner and Vice President can touch the fund.
- Every change is recorded in the **AuditLog** tab with who did it and when.
- Keep the Google Sheet private. The website only talks to it through the Apps Script.
