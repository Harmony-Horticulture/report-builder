// =====================================================================
// Harmony Horticulture Report Builder: settings
//
// Paste your two Supabase values here (Supabase > Project Settings > API).
// Use the SAME values as the Time Tracker if both apps share one
// Supabase project, so one login works in both.
// Both values are safe to put on a public website: the database
// security rules decide what each signed-in person can see.
//
// Leave them empty to run the app in DEMO MODE. Demo mode keeps sample
// reports in your own browser only, so you can click around before the
// database is set up. Nothing is emailed in demo mode.
// =====================================================================
window.HH_CONFIG = {
  // Same Supabase project as the Time Tracker, so one login works in both
  SUPABASE_URL: "https://toqirqxhlisnvggxshxz.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_npyRIEu3nfnKbHHGcfc_Gg_5J3a7HSh", // "publishable" (anon) key

  // The Time Tracker, opened from "Time tracker" in the menu
  TIME_TRACKER_URL: "https://harmony-horticulture.github.io/time-tracker/",
};
