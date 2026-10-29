// Supabase Edge Function: detect-ai-image
// Receives { image: "data:image/jpeg;base64,..." } from the app and returns
// { aiGenerated: 0..1, provider: "hive" | "hive-nvidia" | "sightengine" }.
//
// Every photo a resident attaches to a complaint and every work-completion photo an officer
// uploads is sent here before it is accepted. API keys stay on the server, never in the app.
//
// Detector used (first one with keys set):
//   1. Hive AI-Generated Image Detection   supabase secrets set HIVE_API_KEY=...
//      (optional) HIVE_API_URL to override the endpoint, HIVE_AUTH_SCHEME "Token" (default) or "Bearer"
//   2. Hive model via NVIDIA NIM           supabase secrets set NVIDIA_API_KEY=...
//   3. Sightengine (fallback)              supabase secrets set SIGHTENGINE_API_USER=... SIGHTENGINE_API_SECRET=...
// Deploy: supabase functions deploy detect-ai-image

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_BYTES = 8 * 1024 * 1024;

/** Finds the "ai_generated" class score anywhere in a Hive response (v2 uses "score", v3 uses "value"). */
function findAiScore(node: unknown): number | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const s = findAiScore(item);
      if (s !== null) return s;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o.class === "ai_generated") {
      const v = typeof o.score === "number" ? o.score : typeof o.value === "number" ? o.value : null;
      if (v !== null) return v;
    }
    for (const key of Object.keys(o)) {
      const s = findAiScore(o[key]);
      if (s !== null) return s;
    }
  }
  return null;
}

async function checkHive(key: string, mime: string, bytes: Uint8Array) {
  const url = Deno.env.get("HIVE_API_URL") || "https://api.thehive.ai/api/v2/task/sync";
  const scheme = Deno.env.get("HIVE_AUTH_SCHEME") || "Token";
  const form = new FormData();
  form.append("media", new Blob([bytes], { type: mime }), "photo");
  const res = await fetch(url, { method: "POST", headers: { Authorization: `${scheme} ${key}` }, body: form });
  const out = await res.json();
  const score = findAiScore(out);
  if (score === null) throw new Error("Hive couldn't check this photo.");
  return score;
}

async function checkHiveNvidia(key: string, image: string) {
  const res = await fetch("https://ai.api.nvidia.com/v1/cv/hive/ai-generated-image-detection", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ input: [image] }),
  });
  const out = await res.json();
  const score = findAiScore(out);
  if (score === null) throw new Error("Hive (NVIDIA) couldn't check this photo.");
  return score;
}

async function checkSightengine(user: string, secret: string, mime: string, bytes: Uint8Array) {
  const form = new FormData();
  form.append("media", new Blob([bytes], { type: mime }), "photo");
  form.append("models", "genai");
  form.append("api_user", user);
  form.append("api_secret", secret);
  const res = await fetch("https://api.sightengine.com/1.0/check.json", { method: "POST", body: form });
  const out = await res.json();
  if (out.status !== "success" || !out.type || typeof out.type.ai_generated !== "number") {
    throw new Error("Sightengine couldn't check this photo.");
  }
  return out.type.ai_generated as number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);

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

  const hiveKey = Deno.env.get("HIVE_API_KEY");
  const nvidiaKey = Deno.env.get("NVIDIA_API_KEY");
  const seUser = Deno.env.get("SIGHTENGINE_API_USER");
  const seSecret = Deno.env.get("SIGHTENGINE_API_SECRET");

  try {
    if (hiveKey) return reply({ aiGenerated: await checkHive(hiveKey, match[1], bytes), provider: "hive" });
    if (nvidiaKey) return reply({ aiGenerated: await checkHiveNvidia(nvidiaKey, image), provider: "hive-nvidia" });
    if (seUser && seSecret) return reply({ aiGenerated: await checkSightengine(seUser, seSecret, match[1], bytes), provider: "sightengine" });
    return reply({ error: "AI detector isn't set up yet: add HIVE_API_KEY as a Supabase secret." });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "Couldn't reach the AI detection service." });
  }
});
