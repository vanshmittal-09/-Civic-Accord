// imageCheck.js — helps the supervisor judge whether a photo is a real camera photo or AI-generated.
//
// 1. readPhotoSignals(file): runs when a photo is taken, BEFORE metadata is stripped. It keeps only
//    harmless facts (camera make/model, capture time, editing software, size, AI-tool markers).
//    GPS / location is never read or kept.
// 2. assessPhoto(photo): turns those facts into an advisory verdict with plain reasons.
// 3. detectAiOnline(src): optional. With Supabase connected and the "detect-ai-image" function
//    deployed, sends the photo to an AI-image detection model and returns a 0–1 score.
//
// No detector is perfect. Results are advice for the supervisor, never an automatic decision.
import { CLOUD, getSupabase } from "./supabase";

// Text that AI image tools commonly leave inside the file.
const AI_MARKERS = [
  ["trainedalgorithmicmedia", "IPTC tag 'made by AI'"],
  ["midjourney", "Midjourney"],
  ["dall-e", "DALL·E"], ["dall·e", "DALL·E"],
  ["openai", "OpenAI"],
  ["stable diffusion", "Stable Diffusion"], ["stablediffusion", "Stable Diffusion"],
  ["comfyui", "ComfyUI"], ["automatic1111", "Stable Diffusion WebUI"],
  ["novelai", "NovelAI"],
  ["adobe firefly", "Adobe Firefly"], ["firefly", "Adobe Firefly"],
  ["imagen", "Google Imagen"], ["gemini", "Google Gemini"],
  ["leonardo.ai", "Leonardo AI"], ["ideogram", "Ideogram"],
  ["flux.1", "FLUX"], ["black forest labs", "FLUX"],
  ["negative prompt", "AI prompt text"], ["sampler:", "AI generation settings"],
];

// Output sizes typical of AI generators (width x height, either orientation).
const GENERATOR_SIZES = new Set([
  "512x512", "768x768", "1024x1024", "1536x1536", "2048x2048",
  "1792x1024", "1024x1792", "1344x768", "768x1344", "1216x832", "832x1216",
  "1152x896", "896x1152", "1536x1024", "1024x1536", "1456x816", "816x1456",
]);

function formatOf(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  const ascii = String.fromCharCode(...bytes.slice(0, 12));
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "webp";
  if (ascii.slice(4, 8) === "ftyp") return "heic";
  return "other";
}

// Minimal EXIF reader: camera make/model, software, date taken. Nothing else is read.
function readExif(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
  let off = 2;
  while (off + 10 < v.byteLength) {
    const marker = v.getUint16(off);
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
    if ((marker & 0xff00) !== 0xff00 || len < 2) break;
    off += 2 + len;
  }
  return {};
}

function parseTiff(v, start) {
  const out = {};
  if (start + 8 > v.byteLength) return out;
  const little = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(o, little);
  const u32 = (o) => v.getUint32(o, little);
  let exifIfd = 0;
  const readIfd = (ifdOff, wanted) => {
    const base = start + ifdOff;
    if (!ifdOff || base + 2 > v.byteLength) return;
    const n = u16(base);
    for (let i = 0; i < n; i++) {
      const e = base + 2 + i * 12;
      if (e + 12 > v.byteLength) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      if (tag === 0x8769) { exifIfd = u32(e + 8); continue; }
      if (type !== 2 || !wanted[tag]) continue;
      const valOff = count > 4 ? start + u32(e + 8) : e + 8;
      let s = "";
      for (let k = 0; k < count - 1 && valOff + k < v.byteLength && k < 120; k++) s += String.fromCharCode(v.getUint8(valOff + k));
      out[wanted[tag]] = s.replace(/\0/g, "").trim();
    }
  };
  readIfd(u32(start + 4), { 0x010f: "make", 0x0110: "model", 0x0131: "software", 0x0132: "dateTime" });
  if (exifIfd) readIfd(exifIfd, { 0x9003: "dateTimeOriginal" });
  return out;
}

async function imageSize(file) {
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    if (bmp.close) bmp.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/** Reads authenticity facts from the original file. Never reads location. */
export async function readPhotoSignals(file) {
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const head = bytes.subarray(0, Math.min(bytes.length, 512 * 1024));
    const tail = bytes.subarray(Math.max(0, bytes.length - 64 * 1024));
    let text = "";
    for (const part of [head, tail]) for (let i = 0; i < part.length; i += 8192) text += String.fromCharCode(...part.subarray(i, i + 8192));
    text = text.toLowerCase();

    const exif = readExif(buf);
    const { width, height } = await imageSize(file);
    const aiMarkers = [...new Set(AI_MARKERS.filter(([needle]) => text.includes(needle)).map(([, label]) => label))];
    const camera = [exif.make, exif.model].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return {
      format: formatOf(bytes),
      width,
      height,
      camera: camera || "",
      software: exif.software || "",
      takenAt: exif.dateTimeOriginal || exif.dateTime || "",
      aiMarkers,
      c2pa: text.includes("c2pa") || text.includes("jumb"),
      generatorSize: GENERATOR_SIZES.has(`${width}x${height}`),
      checkedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

// "2026:10:29 09:12:44" -> "29 Oct 2026, 9:12 am"
function prettyExifDate(t) {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(t || "");
  if (!m) return t;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Advisory verdict for one photo, with plain-language reasons. */
export function assessPhoto(photo) {
  if (!photo) return null;
  if (photo.sample) {
    return { level: "demo", label: "Demo illustration", reasons: ["This is a drawn sample image from the demo data, not a real photo."] };
  }
  const s = photo.signals;
  if (!s) {
    return { level: "unknown", label: "Not enough information", reasons: ["This photo was added before photo checks existed, so no file details were kept."] };
  }
  const reasons = [];
  let score = 0;
  if (s.aiMarkers && s.aiMarkers.length) {
    score += 3;
    reasons.push(`The file contains traces of AI tools: ${s.aiMarkers.join(", ")}.`);
  }
  if (s.camera) {
    score -= 2;
    reasons.push(`Taken on a camera: ${s.camera}.`);
  } else {
    score += 1;
    reasons.push("No camera details in the file. This is common for AI images and screenshots, but also for photos forwarded through some messaging apps.");
  }
  if (s.takenAt) reasons.push(`Camera clock says it was taken on ${prettyExifDate(s.takenAt)}.`);
  if (s.software) {
    if (/photoshop|gimp|canva|picsart|snapseed|lightroom|remini|faceapp|lensa/i.test(s.software)) score += 1;
    reasons.push(`Last saved with: ${s.software}.`);
  }
  if (s.generatorSize) {
    score += 1;
    reasons.push(`Its size (${s.width}×${s.height}) matches a common AI-generator output size.`);
  }
  if (s.format === "png" && !s.camera) {
    score += 1;
    reasons.push("Saved as PNG, which phone cameras rarely produce.");
  }
  if (s.c2pa) reasons.push("Has Content Credentials (C2PA). Checking the original in a C2PA viewer can show which app made it.");

  if (score >= 3) return { level: "high", label: "Likely AI-generated or edited", reasons };
  if (score >= 1) return { level: "medium", label: "Needs a closer look", reasons };
  return { level: "low", label: "Looks like a real camera photo", reasons };
}

/**
 * Optional online check with an AI-image detection model.
 * Returns { aiGenerated: 0..1 } or throws an Error whose message explains what's missing.
 */
export async function detectAiOnline(src) {
  if (!CLOUD) throw new Error("Online AI check needs the Supabase connection set up.");
  const sb = await getSupabase();
  const { data, error } = await sb.functions.invoke("detect-ai-image", { body: { image: src } });
  if (error || !data || typeof data.aiGenerated !== "number") {
    throw new Error((data && data.error) || "Online AI check isn't set up yet (deploy the detect-ai-image function).");
  }
  return data;
}

export const ONLINE_AI_CHECK = CLOUD;
