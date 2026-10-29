// Supabase Edge Function: detect-ai-image
// Receives { image: "data:image/jpeg;base64,..." } from the Supervisor screen, sends it to
// Sightengine's AI-generated image detection model, and returns { aiGenerated: 0..1 }.
// The Sightengine keys stay on the server, never in the app.
//
// Setup (see README):
//   supabase secrets set SIGHTENGINE_API_USER=... SIGHTENGINE_API_SECRET=...
//   supabase functions deploy detect-ai-image

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_BYTES = 8 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);

  const apiUser = Deno.env.get("SIGHTENGINE_API_USER");
  const apiSecret = Deno.env.get("SIGHTENGINE_API_SECRET");
  if (!apiUser || !apiSecret) {
    return reply({ error: "Online AI check isn't set up yet: add the Sightengine keys as Supabase secrets." });
  }

  let image = "";
  try {
    ({ image } = await req.json());
  } catch {
    return reply({ error: "Send JSON like { image: 'data:image/jpeg;base64,...' }." }, 400);
  }
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(image || "");
  if (!match) return reply({ error: "Only base64 image data is supported." }, 400);

  const bytes = Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0));
  if (bytes.length > MAX_BYTES) return reply({ error: "Image is too large to check." }, 413);

  const form = new FormData();
  form.append("media", new Blob([bytes], { type: match[1] }), "photo");
  form.append("models", "genai");
  form.append("api_user", apiUser);
  form.append("api_secret", apiSecret);

  try {
    const res = await fetch("https://api.sightengine.com/1.0/check.json", { method: "POST", body: form });
    const out = await res.json();
    if (out.status !== "success" || !out.type || typeof out.type.ai_generated !== "number") {
      return reply({ error: "The AI detection service couldn't check this photo." });
    }
    return reply({ aiGenerated: out.type.ai_generated });
  } catch {
    return reply({ error: "Couldn't reach the AI detection service. Try again." });
  }
});
