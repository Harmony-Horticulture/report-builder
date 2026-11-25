/**
 * =====================================================================
 * Harmony Horticulture: save SOPs from the app into the Google Drive
 * SOP folder.
 *
 * Every time an admin saves an SOP in the app, the app sends the new
 * Word file and PDF here. This script:
 *   - moves the old copies of that SOP (Word, PDF or Google Doc with the
 *     same name) into the folder's "Archive" subfolder, adding the date
 *     they were replaced to the name, and
 *   - saves the new Word file and PDF in the SOP folder.
 * It only accepts files from someone signed in to the app as an active
 * admin, so nobody else can write to the folder.
 *
 * Install once, signed in to Google as an account that can edit the SOP
 * folder (full steps with pictures: docs/SOPS.md):
 *   1. Go to script.google.com and click New project.
 *   2. Delete the sample code and paste this whole file. Click Save.
 *   3. Click Deploy > New deployment. Click the gear next to "Select
 *      type" and choose Web app. Set "Execute as" to Me and "Who has
 *      access" to Anyone. Click Deploy and allow the permissions.
 *   4. Copy the Web app URL. In the app, open SOPs > Google Drive setup,
 *      paste it and click Save.
 * =====================================================================
 */

// The Google Drive SOP folder (the long code at the end of its address)
var SOP_FOLDER_ID = "12Q-lMck_aNmYqiWwUcgyfMgF17ieZNge";
// The app's database (same values as js/config.js; both are safe to share)
var SUPABASE_URL = "https://toqirqxhlisnvggxshxz.supabase.co";
var SUPABASE_KEY = "sb_publishable_npyRIEu3nfnKbHHGcfc_Gg_5J3a7HSh";

var WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The app sends each saved SOP here. */
function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var who = checkAdmin_(req.token);
    if (req.ping) return reply_({ ok: true, folder: DriveApp.getFolderById(SOP_FOLDER_ID).getName(), who: who });
    var base = cleanName_(req.base);
    if (!base) throw new Error("The SOP has no name.");

    var folder = DriveApp.getFolderById(SOP_FOLDER_ID);
    var archive = archiveFolder_(folder);
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    var names = [base];
    if (req.oldBase && cleanName_(req.oldBase) !== base) names.push(cleanName_(req.oldBase));

    // Move the old copies into Archive
    var files = folder.getFiles();
    var moved = 0;
    while (files.hasNext()) {
      var f = files.next();
      var name = f.getName();
      var m = name.match(/^(.*?)(\.(docx|pdf))?$/i);
      if (names.indexOf(m[1]) === -1) continue;
      f.setName(m[1] + " (replaced " + stamp + ")" + (m[2] || ""));
      f.moveTo(archive);
      moved++;
    }

    // Save the new ones
    var docx = folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.docx), WORD, base + ".docx"));
    var pdf = folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.pdf), "application/pdf", base + ".pdf"));
    docx.setDescription("Saved from the Harmony Horticulture app by " + who);
    pdf.setDescription("Saved from the Harmony Horticulture app by " + who);
    return reply_({ ok: true, docx_url: docx.getUrl(), pdf_url: pdf.getUrl(), archived: moved });
  } catch (err) {
    return reply_({ ok: false, error: String(err && err.message || err) });
  }
}

/** Only active admins of the app can save. Returns their name. */
function checkAdmin_(token) {
  if (!token) throw new Error("Sign in to the app first.");
  var headers = { apikey: SUPABASE_KEY, Authorization: "Bearer " + token };
  var u = UrlFetchApp.fetch(SUPABASE_URL + "/auth/v1/user", { headers: headers, muteHttpExceptions: true });
  if (u.getResponseCode() !== 200) throw new Error("Your sign-in has expired. Reload the app and try again.");
  var id = JSON.parse(u.getContentText()).id;
  var p = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/profiles?select=role,active,full_name,email&id=eq." + encodeURIComponent(id), { headers: headers, muteHttpExceptions: true });
  var rows = p.getResponseCode() === 200 ? JSON.parse(p.getContentText()) : [];
  if (!rows.length || rows[0].role !== "admin" || !rows[0].active) throw new Error("Only admins can save SOPs to Google Drive.");
  return rows[0].full_name || rows[0].email;
}

function archiveFolder_(folder) {
  var it = folder.getFoldersByName("Archive");
  return it.hasNext() ? it.next() : folder.createFolder("Archive");
}

function cleanName_(s) {
  return String(s || "").replace(/[\\\/:*?"<>|]+/g, "").trim();
}

function reply_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Run this once from the editor to check the folder can be reached. */
function checkFolder() {
  Logger.log("SOP folder: " + DriveApp.getFolderById(SOP_FOLDER_ID).getName());
}
