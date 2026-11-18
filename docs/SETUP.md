# Setting up the Report Builder

This takes about 30 to 45 minutes, once. You don't need to write code. Until you finish, the app works in **demo mode**, so you can click around first.

| Piece | What it does | Service | Cost |
|---|---|---|---|
| Website | Shows the app at a web address | GitHub Pages (part of GitHub) | Free |
| Database, sign-in and photos | Stores reports, photos, logins and invitations | Supabase | Free plan; Pro is $25/month if you outgrow it |
| Email | Sends reports to clients, plus invitations and password resets | Resend | Free up to 3,000 emails/month |
| AI polish (optional, off by default) | Tidies wording | Anthropic (Claude) | Pay per use, usually a few cents per report |

> **One login for both apps:** use the **same Supabase project as the Time Tracker**. Set up the Time Tracker first (its own SETUP.md), then follow the steps below and skip step 1.

---

## 1. Only if this app gets its own Supabase project

Skip this if the Time Tracker is already set up in Supabase.

1. In Supabase, click **New project**, name it, save the database password, pick **West US** and keep the **Free** plan.
2. Open **SQL Editor > New query**, paste all of [`supabase/00_shared_login_and_clients.sql`](../supabase/00_shared_login_and_clients.sql) (use **Copy raw file** on GitHub) and click **Run**.
3. Go to **Authentication > Users > Add user > Create new user**, enter your email and a password, tick **Auto Confirm User**. The first person becomes the admin.

## 2. Add the report tables

1. In your Supabase project, open **SQL Editor > New query**.
2. Paste all of [`supabase/01_reports.sql`](../supabase/01_reports.sql) and click **Run**. You should see "Success. No rows returned."

This adds the report tables, photo storage, security rules and the two report types. It doesn't change any Time Tracker data, and it is safe to run again.

3. Open another new query, paste all of **client-contacts.sql** from the project files (the `setup` folder) and click **Run**. It fills in the contact name, email and phone for every customer already in the client list, so picking a client in a report fills them in. It never adds or removes customers. It isn't on GitHub because it has customer email addresses.

Both files are safe to run again, for example after an update.

## 3. Put the app online (GitHub Pages)

1. In this repository on GitHub, click **Settings > Pages**.
2. Set Source to **Deploy from a branch**, Branch to **main**, folder **/ (root)**, and **Save**.
3. After a minute the page shows your web address, like `https://harmony-horticulture.github.io/report-builder/`.

## 4. Connect the app to Supabase

Already done for Harmony Horticulture: [`js/config.js`](../js/config.js) has the Time Tracker's project address and publishable key. Only change it if you move to a different project.

1. In Supabase, go to **Project Settings > API** (or **Data API**) and copy the **Project URL** and the **anon public** key. These are the same two values the Time Tracker uses if you share a project.
2. In GitHub, open [`js/config.js`](../js/config.js), click the pencil icon, paste the two values between the quotes and click **Commit changes**.

## 5. Tell Supabase the web address

1. In Supabase, go to **Authentication > URL Configuration**.
2. Under **Redirect URLs**, click **Add URL** and add the address from step 3. (If the Time Tracker is the **Site URL**, leave that as it is. Both addresses just need to be on the list.)

## 6. Email (Resend)

If you already did this for the Time Tracker, invitations and password resets already work. You only need step 6.3 onward for sending reports.

1. Sign up at [resend.com](https://resend.com), add the domain `harmonyhorticulture.com` and add the DNS records it shows you. Send me a screenshot if you'd like help.
2. In Supabase, **Authentication > Emails > SMTP Settings**: turn on **Custom SMTP** with host `smtp.resend.com`, port `465`, username `resend`, your Resend API key as the password, and sender name `Harmony Horticulture`.
3. In Supabase, open **Edge Functions > Secrets** and add:
   - `RESEND_API_KEY`: your Resend API key
   - `REPORTS_FROM`: `Harmony Horticulture <reports@harmonyhorticulture.com>`
   - `APP_URL`: the web address from step 3

## 7. Add the two helpers (Edge Functions)

1. In Supabase, open **Edge Functions** and click **Deploy a new function > Via Editor**.
2. Name it `send-report`, delete the sample code, paste all of [`supabase/functions/send-report/index.ts`](../supabase/functions/send-report/index.ts) and click **Deploy**.
3. Do the same with the name `polish-report` and [`supabase/functions/polish-report/index.ts`](../supabase/functions/polish-report/index.ts).

## 8. AI polish (only when you're ready)

AI polish stays off until an admin turns it on under **Settings**. When you want it:

1. Create an API key at [console.anthropic.com](https://console.anthropic.com) and add a payment method.
2. In Supabase **Edge Functions > Secrets**, add `ANTHROPIC_API_KEY` with that key.
3. In the app, go to **Settings** and tick **Turn on AI polish**.

## 9. Put it on your phone

Open the app's web address on the phone, then:

- **iPhone (Safari):** tap the Share button, then **Add to Home Screen**.
- **Android (Chrome):** tap the **⋮** menu, then **Add to Home screen** or **Install app**.

It opens full screen like an app, with the Harmony icon. Updates show up on their own.

## 10. Try it

1. Open the app and sign in (same email and password as the Time Tracker if you share a project).
2. Fill in your profile, then make a report and send it to your own email to see what clients get.
3. Invite your team under **Team**.

---

## Good to know

- **Photos and storage:** the Supabase free plan includes 1 GB of storage. Photos are shrunk to about 300 KB each, so that's roughly 3,000 photos. Supabase Pro ($25/month) includes 100 GB.
- **Client links** don't expire. Anyone with the exact link can open that one report, the same as a PDF attached to an email.
- **Dictation** uses the phone or browser's own speech recognition (Chrome, Safari or Edge) and needs a connection. The microphone on the phone's keyboard also works in any text box.
