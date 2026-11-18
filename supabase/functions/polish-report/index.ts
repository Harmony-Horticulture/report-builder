// =====================================================================
// polish-report: tidies a report's wording with Claude (RC-19).
// Only runs when an admin has turned AI polish on in Settings.
//
// Secret to set in Supabase (Edge Functions > Secrets):
//   ANTHROPIC_API_KEY   from console.anthropic.com
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `You copyedit field notes written by horticulture consultants at Harmony Horticulture, a plant health and landscape consulting company, so they read as clear, professional, client-ready text.

What you may change: grammar, spelling of ordinary words, punctuation, capitalization, sentence flow, and tone (confident, warm, plain-spoken and professional; no hype, no exclamation marks).

What you must keep exactly: every fact. Do not add, remove or change any observation, diagnosis, cause, pest, disease, treatment, product, rate, timing, date, quantity, measurement, location, plant name (common or botanical), person's name or recommendation. Do not add advice, warnings, reasons or details that are not in the original. Do not drop details that are in it. If a note is ambiguous, keep the ambiguity rather than guessing.

Formatting: keep "**bold**" markers around the same words, keep lines that start with "- " as bullet lines, and keep line breaks between separate points. Keep roughly the same length. Short notes can stay short.

You get a JSON list of fields, each with an id and text. Return every id exactly once with the polished text. If a field already reads well, return it unchanged.`;

const Out = z.object({ fields: z.array(z.object({ id: z.string(), text: z.string() })) });

// Numbers are the easiest facts to check automatically. If a suggestion
// changes any number, we keep the consultant's original words.
const numbers = (s: string) => (s.match(/\d+(?:[.,/]\d+)*/g) || []).sort().join("|");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return json({ error: "Please sign in again." }, 401);
    const { data: settings } = await sb.from("report_settings").select("ai_polish_enabled").eq("id", 1).maybeSingle();
    if (!settings?.ai_polish_enabled) return json({ error: "AI polish is turned off. An admin can turn it on in Settings." }, 403);

    const { fields } = await req.json();
    if (!Array.isArray(fields) || !fields.length) return json({ fields: [] });
    const input = fields.slice(0, 200).map((f: { id: string; text: string }) => ({ id: String(f.id), text: String(f.text).slice(0, 6000) }));

    const client = new Anthropic(); // reads ANTHROPIC_API_KEY
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(Out) },
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ fields: input }) }],
    });

    // If the model declines or the reply can't be read, keep the original words
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return json({ fields: input });
    }
    const polished = new Map(response.parsed_output.fields.map((f) => [f.id, f.text]));
    const out = input.map((f) => {
      const p = polished.get(f.id);
      if (!p || !p.trim()) return f;
      if (numbers(p) !== numbers(f.text)) return f; // a number changed: keep the original
      return { id: f.id, text: p };
    });
    return json({ fields: out });
  } catch (e) {
    console.error(e);
    return json({ error: "AI polish isn't available right now. Your text is unchanged." }, 500);
  }
});
