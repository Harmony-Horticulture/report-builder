/**
 * =====================================================================
 * Harmony Horticulture: send each New Client Intake form answer to the
 * Leads dashboard.
 *
 * Install once, on the "HHC - New Client Intake" Google Form, signed in
 * as the form's owner:
 *   1. Open the form in edit mode, click the ⋮ menu (top right) and
 *      choose "Apps Script".
 *   2. Delete the sample code, paste this whole file, and fill in the two
 *      values below (from docs/LEADS.md).
 *   3. Click Save, choose "installTrigger" in the function list at the
 *      top, and click Run. Allow the permissions Google asks for.
 *   4. Choose "sendTest" and click Run to send your most recent answer as
 *      a test. It should show up on the Leads page and in Slack.
 *
 * It sends every question and answer exactly as the client typed them.
 * Photo uploads are sent as links to the files in Google Drive.
 * Nothing else on the form or the response sheet changes.
 * =====================================================================
 */

// The leads-inbox address: https://<your-project>.supabase.co/functions/v1/leads-inbox
var LEADS_INBOX_URL = "https://toqirqxhlisnvggxshxz.supabase.co/functions/v1/leads-inbox";
// The LEADS_INBOX_KEY you saved in Supabase (Edge Functions > Secrets)
var LEADS_INBOX_KEY = "PASTE-THE-KEY-HERE";
// The Leads page, so Slack messages can link straight to the lead
var APP_URL = "https://harmony-horticulture.github.io/report-builder/";

/** Runs by itself every time someone submits the form. */
function onIntakeSubmit(e) {
  sendResponse_(e.response);
}

/** Run once to switch on onIntakeSubmit. Safe to run again. */
function installTrigger() {
  var form = FormApp.getActiveForm();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "onIntakeSubmit") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onIntakeSubmit").forForm(form).onFormSubmit().create();
  Logger.log("Done: new intake answers will now go to the Leads dashboard.");
}

/** Sends the most recent answer again, as a test. */
function sendTest() {
  var all = FormApp.getActiveForm().getResponses();
  if (!all.length) { Logger.log("The form has no answers yet."); return; }
  Logger.log(sendResponse_(all[all.length - 1]));
}

/**
 * Optional: sends every answer the form already has, oldest first.
 * Answers already on the dashboard are skipped, so it is safe to run twice.
 */
function sendAllPastAnswers() {
  var all = FormApp.getActiveForm().getResponses();
  all.forEach(function (r) { sendResponse_(r); Utilities.sleep(400); });
  Logger.log("Sent " + all.length + " answers.");
}

function sendResponse_(response) {
  var answers = response.getItemResponses().map(function (ir) {
    var item = ir.getItem();
    var value = ir.getResponse();
    if (item.getType() === FormApp.ItemType.FILE_UPLOAD) {
      value = [].concat(value).map(function (id) { return "https://drive.google.com/open?id=" + id; });
    } else if (item.getType() === FormApp.ItemType.GRID || item.getType() === FormApp.ItemType.CHECKBOX_GRID) {
      var rows = item.getType() === FormApp.ItemType.GRID ? item.asGridItem().getRows() : item.asCheckboxGridItem().getRows();
      value = rows.map(function (row, i) { return row + ": " + [].concat(value[i] || "").join(", "); }).join("; ");
    }
    return { q: item.getTitle(), a: Array.isArray(value) ? value.join(", ") : String(value == null ? "" : value) };
  });
  var email = response.getRespondentEmail && response.getRespondentEmail();
  if (email && !answers.some(function (x) { return /e-?mail/i.test(x.q); })) {
    answers.unshift({ q: "Email", a: email });
  }
  var payload = {
    source: "intake_form",
    external_id: "gform:" + response.getId(),
    submitted_at: response.getTimestamp().toISOString(),
    answers: answers,
    app_url: APP_URL,
  };
  var res = UrlFetchApp.fetch(LEADS_INBOX_URL, {
    method: "post",
    contentType: "application/json",
    headers: { "x-leads-key": LEADS_INBOX_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var text = res.getContentText();
  if (res.getResponseCode() >= 300) {
    // Shows up under Executions in Apps Script, and Google emails the owner
    throw new Error("Leads dashboard didn't accept the answer (" + res.getResponseCode() + "): " + text);
  }
  return text;
}
