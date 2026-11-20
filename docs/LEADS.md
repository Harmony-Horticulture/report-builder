# Setting up Leads

The Leads page keeps every new lead in one place: phone calls, texts, emails, the website contact form and the New Client Intake form. Slack still gets a message for each one, with a button that opens the lead. It lives in this app at `leads.html` (for example `https://harmony-horticulture.github.io/report-builder/leads.html`) and uses the same login as Reports and the Time Tracker.

This takes about 20 minutes, once. Kasey (the intake form's owner) is needed for step 5.

| Piece | What it does |
|---|---|
| `supabase/02_leads.sql` | The leads tables and security rules |
| `leads-import-from-slack.sql` (project files, `setup` folder) | Brings over the leads from the Slack Leads list. Not on GitHub because it has client contact details |
| `supabase/functions/leads-inbox` | Takes in intake form and website leads, matches them to existing leads and posts to Slack |
| `integrations/google-form-intake.gs` | A small script on the Google Form that sends each answer to the dashboard |

---

## 1. Add the leads tables

1. In Supabase, open **SQL Editor > New query**.
2. Paste all of [`supabase/02_leads.sql`](../supabase/02_leads.sql) and click **Run**. The result says "Leads are set up".
3. Open another new query, paste all of **leads-import-from-slack.sql** from the project files and click **Run**. You'll see how many leads landed in each stage.

Then do the same with [`supabase/03_leads_won_date.sql`](../supabase/03_leads_won_date.sql), which records the day each lead is won for the "Won this month" count, and [`supabase/04_leads_details.sql`](../supabase/04_leads_details.sql), which holds the intake form answers that don't have a column of their own.

All of them are safe to run again.

## 2. Make a Slack link for lead messages

1. Go to [api.slack.com/apps](https://api.slack.com/apps), click **Create New App > From scratch**, name it **Harmony Leads** and pick the Harmony workspace.
2. Click **Incoming Webhooks**, switch it **On**, click **Add New Webhook to Workspace**, pick the channel (for example **#leads** or **#form-submissions**) and click **Allow**.
3. Copy the **Webhook URL** (it starts with `https://hooks.slack.com/services/`).

## 3. Add the secrets

In Supabase, open **Edge Functions > Secrets** and add:

| Name | Value |
|---|---|
| `SLACK_WEBHOOK_URL` | The webhook URL from step 2 |
| `LEADS_INBOX_KEY` | The key in **leads-inbox-key.txt** in the project files (`setup` folder) |
| `APP_URL` | `https://harmony-horticulture.github.io/report-builder/` |

## 4. Add the leads-inbox helper

1. In Supabase, open **Edge Functions > Deploy a new function > Via Editor**.
2. Name it `leads-inbox`, delete the sample code, paste all of [`supabase/functions/leads-inbox/index.ts`](../supabase/functions/leads-inbox/index.ts) and click **Deploy**.
3. Open the function's **Details** (or **Settings**) and turn **off** "Enforce JWT verification" (it may be called "Verify JWT"), then **Save**. The Google Form can't sign in, so the helper checks the key itself.

## 5. Connect the intake form (Kasey)

Kasey owns "HHC - New Client Intake", so Kasey does this, signed in to the Google account that owns the form:

1. Open the form in edit mode, click the **⋮** menu (top right) and choose **Apps Script**.
2. Delete the sample code and paste all of [`integrations/google-form-intake.gs`](../integrations/google-form-intake.gs).
3. Replace `PASTE-THE-KEY-HERE` with the key from step 3, then click **Save**.
4. In the function list at the top, choose **installTrigger** and click **Run**. Allow the permissions Google asks for. (If it says "Google hasn't verified this app", click **Advanced > Go to … (unsafe)**: it's your own script.)
5. Choose **sendTest** and click **Run**. The latest intake answer should show up on the Leads page and in Slack.
6. Optional: choose **sendAllPastAnswers** and click **Run** to bring in every earlier answer. They're matched to existing leads by email or phone, and nothing is added twice.

The response sheet and the existing #form-submissions messages keep working as they are. When you're happy with the new Slack messages, you can turn the old ones off so each submission is announced once.

## 6. Try it

1. Open `leads.html`, sign in, and check that the Slack leads are there.
2. Click **+ Add a lead**, add a test lead with Slack ticked, and check that the message arrives. Then delete the test lead.

## How each kind of lead gets in

- **Phone calls, texts and emails:** **+ Add a lead**. Paste the voicemail, text or email into "What do they need?". If the phone or email matches an existing lead, it says so first.
- **Intake form:** arrives on its own. If the email or phone matches a lead, the answers attach to that lead and the stage moves to **Intake received**. Otherwise it becomes a new lead.
- **Website contact form:** the hourly lead check reads the "New Consultation Request" emails and sends each one to the dashboard, with the same matching. (Later, the website could send leads straight to `leads-inbox` instead.)

## Good to know

- **Lead card and Edit:** clicking a lead opens a card with only what's filled in. **Edit** opens every intake form question, in the same order as the Google Form. The client's form answers fill in on their own, and anything typed on a call is saved as you go, so the fields are the same whoever filled them in.

- **Who sees leads:** only admins (Krista and Kasey). They assign leads out from the Leads page. Consultants and technicians don't see the Leads page or any leads ([`supabase/05_leads_admins_only.sql`](../supabase/05_leads_admins_only.sql)).
- **Assign and send report:** on a lead's card, pick Kasey, Krista, Robert or Stephanie and add a note. The lead gets a branded **lead report** (`lead-report.html`), and Slack gets a message that tags that person with an **Open lead report** button. The report opens without a login at a long random link, so Robert and Stephanie don't need accounts, and it only shows that one lead. It's a copy of the lead at the time you send it, so use **Reassign or resend report** after adding new details. See an example at `lead-report.html?sample`. Slack only notifies people who are in the channel the Slack link posts to.
- **Copy buttons:** every contact field has its own **Copy** button, and **Copy for QuickBooks** copies the customer name, contact, email, phone and address in one go.
- **Export to Excel** downloads the leads you're looking at (after filters) as a branded spreadsheet.
- **History:** every stage change is noted automatically under **Notes and history**, with who changed it and when.
