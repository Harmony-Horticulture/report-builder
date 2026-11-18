// =====================================================================
// send-report: emails a finished report to the client through Resend
// (RC-26, RC-27). Runs on Supabase as an Edge Function.
//
// Secrets to set in Supabase (Edge Functions > Secrets):
//   RESEND_API_KEY   your Resend API key
//   REPORTS_FROM     e.g. Harmony Horticulture <reports@harmonyhorticulture.com>
//   APP_URL          optional: your app's web address, e.g.
//                    https://harmony-horticulture.github.io/report-builder/
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    // Acts as the signed-in person, so the database security rules apply
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Please sign in again." }, 401);

    const { report_id, to, message, app_url } = await req.json();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || ""))) return json({ error: "Enter a valid email address." }, 400);

    const { data: report, error } = await sb.from("reports").select("*").eq("id", report_id).single();
    if (error || !report) return json({ error: "Report not found." }, 404);
    if (!report.share_token) return json({ error: "The report wasn't prepared for sending. Please try again." }, 400);

    let appUrl = Deno.env.get("APP_URL") || String(app_url || "");
    if (!/^https?:\/\//.test(appUrl)) return json({ error: "Missing app address." }, 400);
    if (!appUrl.endsWith("/")) appUrl += "/";
    const link = `${appUrl}view.html?r=${report.share_token}`;

    const cons = report.consultant || {};
    const property = report.property || report.client_name;
    const first = String(report.contact_name || "").trim().split(/\s+/)[0];
    const sig = [cons.name, cons.title, cons.credentials, cons.email, cons.phone].filter((x: string) => x && String(x).trim());
    const subject = `Property Report · ${property}`;

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F2F2F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:24px 12px;font-family:Montserrat,Arial,Helvetica,sans-serif;color:#1A1A1A;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:10px;overflow:hidden;">
  <tr><td style="background:#FFFFFF;padding:24px 28px 18px;border-bottom:3px solid #8AC641;"><img src="${esc(appUrl)}assets/logo.png" width="150" alt="Harmony Horticulture" style="display:block;width:150px;height:auto;border:0;"></td></tr>
  <tr><td style="padding:30px 28px 8px;">
    <p style="margin:0 0 6px;color:#F065A5;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${esc(report.type_name)}</p>
    <h1 style="margin:0 0 20px;color:#5F351B;font-size:22px;font-weight:300;letter-spacing:1px;text-transform:uppercase;">${esc(property)}</h1>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">${first ? `Hi ${esc(first)},` : "Hello,"}</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Your ${esc(report.type_name)} for ${esc(property)} is ready.</p>
    ${message ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;white-space:pre-line;">${esc(message)}</p>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr><td style="background:#009344;border-radius:8px;">
      <a href="${esc(link)}" style="display:inline-block;padding:13px 24px;color:#FFFFFF;font-weight:700;font-size:15px;text-decoration:none;">View your report</a>
    </td></tr></table>
    <p style="margin:0 0 22px;font-size:13px;color:#595959;line-height:1.5;">The report opens in your browser, where you can download or print it. If you have questions, just reply to this email.</p>
    <p style="margin:0;font-size:14px;line-height:1.5;">${sig.map((l: string, i: number) => (i === 0 ? `<strong>${esc(l)}</strong>` : `<span style="color:#595959;">${esc(l)}</span>`)).join("<br>")}</p>
  </td></tr>
  <tr><td style="padding:22px 28px;"><div style="border-top:2px solid #8AC641;padding-top:10px;font-size:11px;color:#595959;">Harmony Horticulture</div></td></tr>
</table></td></tr></table></body></html>`;

    const text = `${first ? `Hi ${first},` : "Hello,"}\n\nYour ${report.type_name} for ${property} is ready.\n\n${message ? message + "\n\n" : ""}View your report: ${link}\n\n${sig.join("\n")}\n\nHarmony Horticulture`;

    const replyTo = cons.email || user.email;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("REPORTS_FROM") || "Harmony Horticulture <reports@harmonyhorticulture.com>",
        to: [to],
        reply_to: replyTo ? [replyTo] : undefined, // client replies go to the consultant
        subject, html, text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("Resend error", res.status, detail);
      return json({ error: "The email service didn't accept the message. Check the Resend settings in docs/SETUP.md." }, 502);
    }

    const now = new Date().toISOString();
    await sb.from("report_sends").insert({ report_id: report.id, version: report.version, sent_by: user.id, sent_to: to, message: message || "" });
    await sb.from("reports").update({ status: "sent", sent_at: now, sent_to: to }).eq("id", report.id);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong sending the report." }, 500);
  }
});
