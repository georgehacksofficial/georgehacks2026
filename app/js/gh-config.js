// Centralized runtime config for George Hacks (dev/prod switching).
// This file is safe to ship to production (it must not contain service role keys).
//
// How to override for production without editing JS:
// - In HTML, define `window.__ENV` *before* loading this script, e.g.
//   <script>
//     window.__ENV = {
//       SUPABASE_URL: "https://<prod-ref>.supabase.co",
//       SUPABASE_ANON_KEY: "sb_publishable_...",
//       STORAGE_BUCKET: "gh-resources"
//     };
//   </script>
//   <script src=".../app/js/gh-config.js"></script>

(() => {
  const DEFAULTS = {
    SUPABASE_URL: "https://bdvgjhdkwxjssahspavt.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_V5CMyn6GUpzaQ63pr86eYg_kRpU5TfD",
    STORAGE_BUCKET: "gh-resources",
  };

  const overrides =
    (typeof window !== "undefined" && window.__ENV && typeof window.__ENV === "object")
      ? window.__ENV
      : {};

  const cfg = {
    ...DEFAULTS,
    ...overrides,
  };

  // Guardrail: never allow obvious service role key patterns in the browser config.
  const maybeBad =
    String(cfg.SUPABASE_ANON_KEY || "").toLowerCase().includes("service_role") ||
    String(cfg.SUPABASE_ANON_KEY || "").toLowerCase().includes("service-role");
  if (maybeBad && typeof console !== "undefined") {
    console.warn(
      "[GH_CONFIG] Refusing to trust a key that looks like a service role key in the browser."
    );
    cfg.SUPABASE_ANON_KEY = DEFAULTS.SUPABASE_ANON_KEY;
  }

  // Expose globally (works for both classic scripts and ES modules).
  window.GH_CONFIG = Object.freeze(cfg);
})();

