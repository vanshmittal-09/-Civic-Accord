// imageCheck.js — helps the supervisor judge whether a photo is a real camera photo or AI-generated.
//
// 1. readPhotoSignals(file): runs when a photo is taken. It reads camera make/model, capture time,
//    editing software, size, AI-tool markers and the GPS location (if the camera recorded one).
//    The photo's metadata (EXIF, including GPS) is kept in the saved photo as well.
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

// Minimal EXIF reader: camera make/model, software, date taken, GPS location.
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
  let gpsIfd = 0;
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
      if (tag === 0x8825) { gpsIfd = u32(e + 8); continue; }
      if (type !== 2 || !wanted[tag]) continue;
      const valOff = count > 4 ? start + u32(e + 8) : e + 8;
      let s = "";
      for (let k = 0; k < count - 1 && valOff + k < v.byteLength && k < 120; k++) s += String.fromCharCode(v.getUint8(valOff + k));
      out[wanted[tag]] = s.replace(/\0/g, "").trim();
    }
  };
  readIfd(u32(start + 4), { 0x010f: "make", 0x0110: "model", 0x0131: "software", 0x0132: "dateTime" });
  if (exifIfd) readIfd(exifIfd, { 0x9003: "dateTimeOriginal" });
  if (gpsIfd) {
    // GPS IFD: 1 LatRef "N"/"S", 2 Lat (3 rationals), 3 LonRef "E"/"W", 4 Lon, 5 AltRef, 6 Alt
    const base = start + gpsIfd;
    const g = {};
    if (base + 2 <= v.byteLength) {
      const n = u16(base);
      for (let i = 0; i < n; i++) {
        const e = base + 2 + i * 12;
        if (e + 12 > v.byteLength) break;
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        if ((tag === 1 || tag === 3) && type === 2) g[tag] = String.fromCharCode(v.getUint8(e + 8));
        if ((tag === 2 || tag === 4) && type === 5 && count === 3) {
          const p = start + u32(e + 8);
          if (p + 24 <= v.byteLength) {
            const r = (k) => { const den = u32(p + k * 8 + 4); return den ? u32(p + k * 8) / den : 0; };
            g[tag] = r(0) + r(1) / 60 + r(2) / 3600;
          }
        }
        if (tag === 6 && type === 5) {
          const p = start + u32(e + 8);
          if (p + 8 <= v.byteLength) { const den = u32(p + 4); g.alt = den ? u32(p) / den : null; }
        }
      }
    }
    if (typeof g[2] === "number" && typeof g[4] === "number" && (g[2] || g[4])) {
      out.gps = {
        lat: +(g[2] * (g[1] === "S" ? -1 : 1)).toFixed(6),
        lon: +(g[4] * (g[3] === "W" ? -1 : 1)).toFixed(6),
        ...(g.alt != null ? { alt: Math.round(g.alt) } : {}),
      };
    }
  }
  return out;
}

/**
 * Returns the photo's EXIF block (APP1 segment, GPS included) ready to be copied into the
 * compressed photo, with Orientation reset to 1 because the compressed photo is already upright.
 */
export function extractExifSegment(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 10 < v.byteLength) {
    const marker = v.getUint16(off);
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
      const seg = new Uint8Array(buf.slice(off, off + 2 + len));
      const sv = new DataView(seg.buffer);
      const start = 10;
      const little = sv.getUint16(start) === 0x4949;
      const ifd0 = start + sv.getUint32(start + 4, little);
      if (ifd0 + 2 <= sv.byteLength) {
        const n = sv.getUint16(ifd0, little);
        for (let i = 0; i < n; i++) {
          const e = ifd0 + 2 + i * 12;
          if (e + 12 > sv.byteLength) break;
          if (sv.getUint16(e, little) === 0x0112) sv.setUint16(e + 8, 1, little); // Orientation = normal
        }
      }
      return seg;
    }
    if ((marker & 0xff00) !== 0xff00 || len < 2) break;
    off += 2 + len;
  }
  return null;
}

/** Distance in metres between two { lat, lon } points. */
export function distanceMeters(a, b) {
  if (!a || !b) return null;
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export const mapsLink = (gps) => `https://www.google.com/maps?q=${gps.lat},${gps.lon}`;
export const formatGps = (gps) => `${Math.abs(gps.lat).toFixed(5)}°${gps.lat >= 0 ? "N" : "S"}, ${Math.abs(gps.lon).toFixed(5)}°${gps.lon >= 0 ? "E" : "W"}`;

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

/** Reads authenticity facts and the GPS location from the original file. */
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
      gps: exif.gps || null,
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
  return { aiGenerated: data.aiGenerated, provider: data.provider || "online" };
}

export const ONLINE_AI_CHECK = CLOUD;
export const PROVIDER_NAME = { hive: "Hive AI Detector", "hive-nvidia": "Hive AI Detector", sightengine: "Sightengine", online: "AI detector", local: "AI detector (offline check)" };
