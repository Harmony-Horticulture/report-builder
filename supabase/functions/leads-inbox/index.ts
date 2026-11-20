// =====================================================================
// leads-inbox: the one door new leads come in through.
// Runs on Supabase as an Edge Function.
//
// 1. The Google intake form (google-form-intake.gs) and the website
//    lead check send each submission here with the LEADS_INBOX_KEY.
//    It is matched to an existing lead by email or phone, or becomes a
//    new lead, the answers are saved, and Slack gets a message.
// 2. The Leads page calls it (signed in as an admin) after someone adds
//    a lead by hand, so Slack hears about calls and texts too.
//
// Secrets to set in Supabase (Edge Functions > Secrets):
//   LEADS_INBOX_KEY    a long random password that the form script and
//                      the website lead check send with each submission
//   SLACK_WEBHOOK_URL  a Slack "Incoming Webhook" address for the
//                      channel that should get lead messages
// Optional:
//   APP_URL            the app's web address, e.g.
//                      https://harmony-horticulture.github.io/report-builder/
//
// IMPORTANT: turn OFF "Enforce JWT verification" for this function
// (Edge Functions > leads-inbox > Settings). The Google Form can't sign
// in, so this function checks the key or the person's login itself.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-leads-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type QA = { q: string; a: string };
type LeadFields = Record<string, unknown>;

const STAGE_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", intake_sent: "Waiting on intake form", intake_received: "Intake received",
  scheduled: "Site visit scheduled", proposal_sent: "Proposal sent", won: "Won", lost: "Lost",
};
const CHANNEL_LABEL: Record<string, string> = {
  phone: "Phone call", email: "Email", text: "Text", website: "Website form", intake_form: "Intake form",
  referral: "Referral", other: "Other",
};
const TEXT_FIELDS = [
  "project_name", "contact_name", "company", "email", "phone", "address", "property_type",
  "service", "request", "goals", "budget", "heard_about",
];

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);
const clip = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
// Slack message text: keep it from turning into links or mentions
const slackSafe = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Turn the form's questions and answers into lead fields. Works with the
// question wording on the current Google Form and on the website form, and
// with small wording changes. Anything not recognized is still kept in
// the full answers.
function fieldsFromAnswers(answers: QA[]): LeadFields {
  const out: LeadFields = {};
  const used = new Set<number>();
  const take = (key: string, test: RegExp, not?: RegExp) => {
    if (out[key]) return;
    const i = answers.findIndex((x, idx) => !used.has(idx) && test.test(x.q) && !(not && not.test(x.q)) && String(x.a ?? "").trim());
    if (i >= 0) { out[key] = String(answers[i].a).trim(); used.add(i); }
  };
  take("email", /e-?mail/i);
  take("phone", /phone|cell|mobile/i);
  take("project_name", /property name|project name/i);
  take("company", /company|business|organization|hoa name/i);
  take("contact_name", /^(your )?(full )?name|first and last|contact name|client name|^name/i, /property|company|landscaper|project|referr/i);
  take("address", /address|location/i, /e-?mail/i);
  take("property_type", /property type|type of property/i);
  take("service", /frequency|service|scope|interested in/i);
  take("heard_about", /hear about|referred|referral|find us/i);
  take("budget", /budget/i);
  take("goals", /goal/i);
  take("request", /issue|problem|project|describe|concern|help with|tell us|need/i, /name|address|type|scope/i);
  const news = answers.find((x) => /newsletter|field notes/i.test(x.q));
  if (news) out.newsletter = /^\s*(yes|y|true|subscribe)/i.test(String(news.a));
  return out;
}

async function postToSlack(text: string, url: string, button?: string) {
  const hook = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!hook) return "Slack isn't set up (SLACK_WEBHOOK_URL is missing).";
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text } }];
  if (url) {
    blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: button || "Open lead" }, url, style: "primary" }] });
  }
  const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, blocks }) });
  return res.ok ? null : `Slack said ${res.status}`;
}

function leadUrl(id: string, appUrlFromCaller?: string) {
  let base = Deno.env.get("APP_URL") || appUrlFromCaller || "";
  if (!/^https?:\/\//.test(base)) return "";
  if (!base.endsWith("/")) base += "/";
  return `${base}leads.html#lead=${id}`;
}

function slackText(kind: string, lead: Record<string, unknown>, extra = "") {
  const who = [lead.contact_name, lead.project_name && lead.project_name !== lead.contact_name ? lead.project_name : ""].filter(Boolean).join(" · ");
  const lines = [
    `*${kind}:* ${slackSafe(who || lead.email || lead.phone || "No name given")}`,
    [lead.phone, lead.email].filter(Boolean).map(slackSafe).join("  ·  "),
    lead.address ? slackSafe(clip(lead.address, 120)) : "",
    lead.request ? `_${slackSafe(clip(lead.request, 220))}_` : "",
    `Came in by: ${CHANNEL_LABEL[String(lead.channel)] || lead.channel}${lead.heard_about ? ` (${slackSafe(lead.heard_about)})` : ""}  ·  Stage: ${STAGE_LABEL[String(lead.stage)] || lead.stage}`,
    extra,
  ];
  return lines.filter(Boolean).join("\n");
}

// The project's secret key. Newer Supabase projects provide it as
// SUPABASE_SECRET_KEYS ({"default": "sb_secret_..."}); older ones as
// SUPABASE_SERVICE_ROLE_KEY.
function serviceKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const k = keys.default || Object.values(keys)[0];
    if (k) return String(k);
  } catch { /* fall back below */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Send JSON." }, 400); }

  try {
    // ---------------------------------------------------------------
    // From the Leads page: tell Slack about a lead someone just added
    // ---------------------------------------------------------------
    if (body.notify_lead_id) {
      // Acts as the signed-in person, so the database security rules decide
      const auth = req.headers.get("Authorization") ?? "";
      const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      });
      const { data: u } = await asUser.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (!u?.user) return json({ error: "Please sign in again." }, 401);
      const { data: me, error: meErr } = await asUser.from("profiles").select("full_name, email, role, active").eq("id", u.user.id).single();
      if (meErr) console.error("profile lookup", meErr);
      if (!me || !me.active) return json({ error: "You don't have permission to do that." }, 403);
      const { data: lead } = await asUser.from("leads").select("*").eq("id", body.notify_lead_id).single();
      if (!lead) return json({ error: "Lead not found." }, 404);
      if (me.role !== "admin" && lead.assigned_to !== u.user.id) return json({ error: "You don't have permission to do that." }, 403);
      const url = leadUrl(lead.id, String(body.app_url || ""));
      const err = await postToSlack(slackText("New lead", lead, `Added by ${slackSafe(me.full_name || me.email)}`), url);
      return json({ ok: true, slack: err ? err : "sent" });
    }

    // ---------------------------------------------------------------
    // From the intake form or the website lead check (needs the key)
    // ---------------------------------------------------------------
    const key = Deno.env.get("LEADS_INBOX_KEY") || "";
    const given = req.headers.get("x-leads-key") || String(body.key || "");
    if (!key || given !== key) return json({ error: "Wrong or missing key." }, 401);

    const source = body.source === "website" ? "website" : "intake_form";
    const answers: QA[] = (Array.isArray(body.answers) ? body.answers : [])
      .map((x: { q?: unknown; a?: unknown }) => ({ q: String(x?.q ?? "").trim(), a: Array.isArray(x?.a) ? x.a.join(", ") : String(x?.a ?? "").trim() }))
      .filter((x: QA) => x.q);
    const given_fields = (body.lead && typeof body.lead === "object") ? body.lead as LeadFields : {};
    const fields: LeadFields = { ...fieldsFromAnswers(answers), ...Object.fromEntries(Object.entries(given_fields).filter(([, v]) => v !== "" && v != null)) };
    if (fields.email) fields.email = String(fields.email).trim().toLowerCase();
    if (!fields.contact_name && !fields.email && !fields.phone) {
      return json({ error: "No name, email or phone in the submission." }, 400);
    }
    const externalId = body.external_id ? String(body.external_id) : null;
    const submittedAt = body.submitted_at ? new Date(String(body.submitted_at)) : new Date();
    const submittedIso = isNaN(submittedAt.getTime()) ? new Date().toISOString() : submittedAt.toISOString();

    // The same submission sent twice (for example the hourly check seeing
    // an email again) is ignored.
    if (externalId) {
      const { data: seen } = await admin.from("lead_intakes").select("lead_id").eq("external_id", externalId).maybeSingle();
      if (seen) return json({ ok: true, duplicate: true, lead_id: seen.lead_id });
    }

    // Is this someone we already have? Match on email, then on phone.
    let lead: Record<string, unknown> | null = null;
    if (fields.email) {
      const { data } = await admin.from("leads").select("*").ilike("email", String(fields.email)).order("created_at", { ascending: false }).limit(1);
      lead = data?.[0] ?? null;
    }
    if (!lead && digits(fields.phone).length === 10) {
      const { data } = await admin.from("leads").select("*").order("created_at", { ascending: false });
      lead = (data || []).find((l) => digits(l.phone) === digits(fields.phone)) ?? null;
    }

    const azDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date(submittedIso));
    let isNew = false;
    if (lead) {
      // Fill in anything we didn't have yet. Never overwrite what's there.
      const patch: LeadFields = {};
      for (const k of TEXT_FIELDS) if (fields[k] && !String(lead[k] ?? "").trim()) patch[k] = String(fields[k]);
      if (fields.newsletter != null && lead.newsletter == null) patch.newsletter = fields.newsletter;
      if (source === "intake_form" && ["new", "contacted", "intake_sent"].includes(String(lead.stage))) patch.stage = "intake_received";
      if (Object.keys(patch).length) {
        const { data, error } = await admin.from("leads").update(patch).eq("id", lead.id).select("*").single();
        if (error) throw error;
        lead = data;
      }
    } else {
      isNew = true;
      const row: LeadFields = { channel: source, stage: source === "intake_form" ? "intake_received" : "new", lead_date: azDate };
      for (const k of TEXT_FIELDS) if (fields[k]) row[k] = String(fields[k]);
      if (fields.newsletter != null) row.newsletter = fields.newsletter;
      if (!row.project_name) {
        const last = String(fields.contact_name || "").trim().split(/\s+/).pop();
        row.project_name = fields.company ? String(fields.company) : last ? `${last} Residence` : "";
      }
      const { data, error } = await admin.from("leads").insert(row).select("*").single();
      if (error) throw error;
      lead = data;
    }

    const { error: iErr } = await admin.from("lead_intakes").insert({
      lead_id: lead!.id, source, submitted_at: submittedIso, answers, external_id: externalId,
    });
    if (iErr && !/duplicate key/i.test(iErr.message)) throw iErr;
    await admin.from("lead_notes").insert({
      lead_id: lead!.id, author_name: "Automatic", automatic: true,
      body: source === "intake_form" ? "Intake form received" : isNew ? "Came in from the website form" : "Sent another request from the website form",
    });

    const kind = source === "intake_form"
      ? (isNew ? "New intake form (new lead)" : "Intake form received")
      : (isNew ? "New website lead" : "Website request from an existing lead");
    const extra = fields.service ? `Service: ${slackSafe(fields.service)}` : "";
    const slack = await postToSlack(slackText(kind, lead!, extra), leadUrl(String(lead!.id), String(body.app_url || "")),
      source === "intake_form" ? "See intake answers" : "Open lead");

    return json({ ok: true, lead_id: lead!.id, new_lead: isNew, slack: slack ?? "sent" });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Something went wrong." }, 500);
  }
});
