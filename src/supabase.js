// supabase.js — optional online database.
// If VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (in a .env file or your host's
// settings), the app stores accounts and cases in Supabase so every device shares them.
// If they're not set, the app falls back to this browser's storage, as before.

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

export const CLOUD = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;

/** Returns the Supabase client, or null when the app runs without a database. */
export function getSupabase() {
  if (!CLOUD) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    );
  }
  return clientPromise;
}
