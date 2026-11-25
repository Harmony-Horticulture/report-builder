# Harmony Horticulture Report Builder

A web app for writing branded client reports on a phone or computer: pick a report type, fill in the header, add notes, observations with photos, and Priority 1 / Priority 2 / Future priorities, then download a Word file or PDF, or email the client a link. Built from the Report tab of the App User Stories (version 3, November 2026).

**Try it now:** until Supabase is connected, the app runs in **demo mode** with sample reports kept in your own browser. **Setting it up:** follow [docs/SETUP.md](docs/SETUP.md).

This app is separate from the Time Tracker (its own code and its own web address). It uses the same tools (Supabase, GitHub Pages and the Google Workspace mailbox for email), and if both apps use the same Supabase project, one login works in both.

## What it does

**Consultants and admins**
- Sign in with their own account. Invite-only: no one can sign up without an invitation (RC-01, RC-02)
- Fill in a profile with name, title and credentials the first time they sign in. It becomes the signature on every report (RC-04)
- See a **Dashboard** of their reports, newest first, with Draft / Review / Sent status and filters for client, status, type and dates. Admins see everyone's and can filter by consultant (RC-03, RC-29)
- Start a **New Report** by choosing its type: Monthly Property Care Report, Site Visit Photo Report or Punch List (RC-05, RC-06, RC-07)
- Fill in the header: client search (existing clients only), property, HOA or community, contact person and email, consultant (themselves) and date (today, changeable). Contact details are copied from that client's last report (RC-09)
- Add notes with **bold** and bullets, observations each with an optional photo (camera or library) and a recommendation, photos with a short note, and priorities in three tiers. Everything can be reordered (RC-10 to RC-13)
- **Punch List** (large estates): one compact row per task with photo, notes, priority, assigned to, status and approval, grouped by inspection date. Tap a row to edit it, tap the status to change it. "Bring over open items from last punch list" copies everything not yet complete from the client's last punch list, photos included. Word and PDF show a compact table per inspection date (about 7 pages for 50 items)
- Dictate into any text box with the microphone button. An admin word list fixes plant names and terms (RC-17, RC-18)
- Photos are shrunk to 1600 pixels so files stay small enough to email (RC-14)
- Drafts save automatically a second after typing stops and when leaving the screen (RC-15)
- Works on a phone without zooming (RC-16)
- **Preview** the report as the client will see it, with **Edit / Word / PDF / Send** buttons (RC-20)
- Download an editable **Word** file and a **PDF**, named "Client - Report Type - Date". Both use the official logo, the four brand colors, Montserrat, all-caps titles, an Earth Brown priorities table and a footer with page numbers. Photos keep their proportions and are never split across pages (RC-21, RC-22, RC-23)
- **Send** the report from the app: the client gets a branded email ("Property Report · property name") greeting them by name, with the personal message and a "View your report" button. Replies go to the consultant (RC-26)
- **Polish Copy** (only when an admin turns it on): tidies grammar and tone, shows every change next to the original, and lets you keep or undo each one. It is told never to change facts, and any suggestion that changes a number is dropped automatically (RC-19)

**Clients** (no login)
- Open the link from the email to read the branded report on any phone or computer, and download or print the PDF. The link has a long random code, so changing it can't reach anyone else's report (RC-27)

**Admins**
- Invite people and set their role and access (Team)
- Turn AI polish on or off, keep the dictation word list, and add or change report types and their sections without a developer (Settings, RC-08)
- Sent reports are locked. Editing one makes a new version that has to be sent again, a PDF of every sent version is kept, and the send history shows who sent which version to whom and when (RC-25, RC-28)

## Leads

The **Leads** page (`leads.html`, linked from the menu for admins) keeps every new lead in one place: calls, texts and emails added with **+ Add a lead**, plus the website contact form and the New Client Intake form, which arrive on their own and match to existing leads by email or phone. Each lead moves through stages (New, Contacted, Waiting on intake form, Intake received, Site visit scheduled, Proposal sent, Won, Lost) and shows the full intake answers, notes and history. Every field has a Copy button, **Copy for QuickBooks** copies the customer details in one go, and **Export to Excel** downloads a branded spreadsheet. Slack gets a message for each new lead or intake form. **Setting it up:** [docs/LEADS.md](docs/LEADS.md).

## Statement check

The **Statement check** page (`statements.html`, admins only, in the admin menus) checks a vendor's statement against QuickBooks before you pay. Add the statement (the PDF the vendor sends, or Excel/CSV) and a QuickBooks export for that vendor (Vendor Balance Detail or the vendor's transaction list work best; Transaction List by Vendor, Unpaid Bills and A/P Aging Detail work too). It lists every invoice that's missing from QuickBooks, entered twice, a different amount, entered under a different number, or paid on one side but still open on the other; QuickBooks bills the vendor doesn't list; statement payments not in QuickBooks; and bill payments QuickBooks hasn't applied to a bill. **Check or fix the lines it read** shows what was read from the PDF so anything misread can be corrected. **Download Excel** gives a branded workbook (Summary, To check, Payments, Every invoice). Nothing is saved, and QuickBooks isn't changed. Matching logic: `js/statement-match.js`. Try it without signing in: `statements.html?demo`.

## SOPs

The **SOPs** page (`sops.html`, in the menu for everyone, and in the Time Tracker menu too) is the library of standard operating procedures, grouped by category, with a search box that also finds words inside them.

- Each SOP is shown in the app in the same branded layout as the SOP Template, and anyone can **Download PDF**. Admins can also download the editable **Word** file.
- Admins tap **Edit** to change any part: the details table, sections, text, bullet lists, step tables, troubleshooting tables and highlight boxes. Put `**two stars**` around words to make them bold. Section numbers and step numbers keep themselves in order.
- **Save** asks what changed, then sets the revised date to today and records who saved it, raises the version (1.1 to 1.2) and adds a row to the Revision History with Kasey as approver. The old version is kept under Past versions.
- With Google Drive set up (**Set up Google Drive** on the SOPs page, using `integrations/sop-drive.gs`), every save also puts the new Word file and PDF in the Drive SOP folder and moves the old copies into its Archive folder.
- **+ Add an SOP** starts a new one from the template, or uploads a PDF made somewhere else.

**Setting it up:** run `supabase/07_sops.sql` and then `supabase/08_sop_editing.sql` once in Supabase > SQL Editor.

## How it's built

- Plain HTML, CSS and JavaScript with no build step. GitHub Pages serves the files as they are.
- [Supabase](https://supabase.com) for sign-in, the database and photo storage. Security rules in the database make sure consultants only see their own reports and admins see everyone's.
- Two small Supabase Edge Functions: `send-report` emails clients from the Google Workspace mailbox (Gmail SMTP), and `polish-report` calls Claude for AI polish.
- Word files are made with [docx](https://github.com/dolanmiu/docx) and PDFs with [jsPDF](https://github.com/parallax/jsPDF), both saved in `vendor/`. Montserrat is saved in `fonts/` so PDFs use the brand font.

| File | What's in it |
|---|---|
| `index.html` | The app |
| `view.html` | The page clients open from their email |
| `css/app.css`, `css/report.css` | Brand colors, fonts and layout; the report's look |
| `js/config.js` | Your Supabase address and key (the only file you need to edit) |
| `js/app.js` | The screens |
| `js/store.js` | Talks to the database (or to demo data in the browser) |
| `js/render.js` | The on-screen report |
| `js/exports.js` | Word and PDF files |
| `supabase/00_shared_login_and_clients.sql` | Sign-in and client tables. Only if this app has its own Supabase project |
| `supabase/01_reports.sql` | Report tables, security rules, photo storage and the two starting report types |
| `supabase/functions/` | The email and AI polish helpers, and `leads-inbox` for incoming leads |
| `leads.html`, `js/leads.js`, `css/leads.css` | The Leads page |
| `sops.html`, `js/sops.js`, `css/sops.css` | The SOPs page and editor. `js/sop-doc.js` draws an SOP on screen and makes its PDF and Word files. `vendor/pdfjs/` shows the PDFs on screen ([PDF.js](https://mozilla.github.io/pdf.js/)) |
| `supabase/07_sops.sql`, `08_sop_editing.sql` | SOP tables, who-can-see rules, private file storage and SOP editing |
| `integrations/sop-drive.gs` | The small Google script that saves SOPs into the Drive SOP folder |
| `supabase/02_leads.sql` | Lead tables and security rules |
| `integrations/google-form-intake.gs` | Sends each intake form answer to the Leads page |

## Still open

- **The third report template:** your demo showed three, and we only know two. Send an example and an admin can add it under Settings, or I can add it.
- **AI polish:** built but switched off until you confirm you're happy using it.
- **Admin approval before sending** (RC-24): not built, because the prototype lets consultants send directly. Easy to add if you want it.
- **Log time for this visit** (RC-30): not built yet. It would open the Time Tracker with the client and date filled in.
