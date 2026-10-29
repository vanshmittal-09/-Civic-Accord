// aiDetector.js — Civic Accord's own AI-image detector. Runs entirely in the browser.
//
// How it works:
//   1. A pretrained MobileNetV2 (ImageNet) turns the photo into 2,176 numbers describing its
//      content and its fine texture (taken from several layers of the network).
//   2. Our own classifier, trained on 1,000+ labelled real and AI-generated images
//      (Midjourney / Stable Diffusion / DALL·E style), turns those numbers into a 0–1 score.
//   3. The score is averaged over 10 views of the photo (5 crops × mirror) and combined with
//      file evidence (camera details, AI-tool traces, typical generator sizes).
// Held-out test set: 96.5% accuracy (98% of AI images caught, ~5% of real photos flagged).
// No photo leaves the device for this check.
import HEAD from "./aiHead.json";

export const ORT_VERSION = "1.20.1";
// The engine (onnxruntime-web ${ORT_VERSION}) and model are served with the app, so it works offline too.
const abs = (p) => new URL(p, document.baseURI).href; // the engine needs absolute URLs
const ORT_BASE = () => abs((typeof window !== "undefined" && window.__ORT_BASE__) || "ort/");
const MODEL_URL = () => abs((typeof window !== "undefined" && window.__AI_MODEL_URL__) || "models/civic-ai-detector.onnx");

export const DETECTOR_NAME = "Civic Accord AI Detector";
export const MODEL_TEST = HEAD.test; // { accuracy, auc } on the held-out test set

let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.ort) return resolve(window.ort);
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => (window.ort ? resolve(window.ort) : reject(new Error("AI engine failed to start.")));
    s.onerror = () => reject(new Error("Couldn't load the AI engine."));
    document.head.appendChild(s);
  });
}

/** Loads the engine and model once; later calls reuse them. Safe to call early to warm up. */
export function loadDetector() {
  if (!loading) {
    loading = (async () => {
      const ort = await loadScript(`${ORT_BASE()}ort.min.js`);
      ort.env.wasm.numThreads = 1; // works without cross-origin isolation
      ort.env.wasm.wasmPaths = ORT_BASE();
      const res = await fetch(MODEL_URL());
      if (!res.ok) throw new Error("Couldn't load the AI detector model.");
      const session = await ort.InferenceSession.create(await res.arrayBuffer(), { executionProviders: ["wasm"] });
      return { ort, session };
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pillow-compatible bilinear resize (triangle filter, antialiased), so the browser sees exactly
 *  what the model saw in training. src: RGBA bytes; returns RGB bytes. */
function resizeBilinear(src, inW, inH, outW, outH) {
  function coeffs(inSize, outSize) {
    const scale = inSize / outSize;
    const fscale = Math.max(1, scale);
    const support = fscale;
    const ksize = Math.ceil(support) * 2 + 1;
    const bounds = new Int32Array(outSize * 2);
    const kk = new Float64Array(outSize * ksize);
    for (let i = 0; i < outSize; i++) {
      const center = (i + 0.5) * scale;
      const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
      const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
      let ww = 0;
      for (let x = 0; x < xmax; x++) {
        const t = Math.abs((x + xmin - center + 0.5) / fscale);
        const w = t < 1 ? 1 - t : 0;
        kk[i * ksize + x] = w;
        ww += w;
      }
      for (let x = 0; x < xmax; x++) if (ww) kk[i * ksize + x] /= ww;
      bounds[i * 2] = xmin;
      bounds[i * 2 + 1] = xmax;
    }
    return { bounds, kk, ksize };
  }
  const clip = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
  // horizontal pass (RGBA -> RGB rows of outW)
  const H = coeffs(inW, outW);
  const tmp = new Uint8Array(outW * inH * 3);
  for (let y = 0; y < inH; y++) {
    for (let x = 0; x < outW; x++) {
      const xmin = H.bounds[x * 2], n = H.bounds[x * 2 + 1], k = x * H.ksize;
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < n; j++) {
        const w = H.kk[k + j], i = (y * inW + xmin + j) * 4;
        r += src[i] * w; g += src[i + 1] * w; b += src[i + 2] * w;
      }
      const o = (y * outW + x) * 3;
      tmp[o] = clip(r); tmp[o + 1] = clip(g); tmp[o + 2] = clip(b);
    }
  }
  // vertical pass
  const V = coeffs(inH, outH);
  const out = new Uint8Array(outW * outH * 3);
  for (let y = 0; y < outH; y++) {
    const ymin = V.bounds[y * 2], n = V.bounds[y * 2 + 1], k = y * V.ksize;
    for (let x = 0; x < outW; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < n; j++) {
        const w = V.kk[k + j], i = ((ymin + j) * outW + x) * 3;
        r += tmp[i] * w; g += tmp[i + 1] * w; b += tmp[i + 2] * w;
      }
      const o = (y * outW + x) * 3;
      out[o] = clip(r); out[o + 1] = clip(g); out[o + 2] = clip(b);
    }
  }
  return out;
}

/** 10 normalised 224×224 views: centre + 4 corners, each also mirrored. Matches training. */
function views(source) {
  const S = HEAD.input;
  const w0 = source.width, h0 = source.height;
  const raw = document.createElement("canvas");
  raw.width = w0; raw.height = h0;
  const rctx = raw.getContext("2d", { willReadFrequently: true });
  rctx.drawImage(source, 0, 0);
  const rgba = rctx.getImageData(0, 0, w0, h0).data;
  const k = HEAD.resizeShort / Math.min(w0, h0);
  const w = Math.max(S, Math.round(w0 * k)), h = Math.max(S, Math.round(h0 * k));
  const rgb = resizeBilinear(rgba, w0, h0, w, h);

  const spots = [[(w - S) >> 1, (h - S) >> 1], [0, 0], [w - S, 0], [0, h - S], [w - S, h - S]];
  const n = spots.length * 2, plane = S * S;
  const out = new Float32Array(n * 3 * plane);
  const [m0, m1, m2] = HEAD.mean, [s0, s1, s2] = HEAD.std;
  let v = 0;
  for (const [x0, y0] of spots) {
    for (const mirror of [false, true]) {
      const base = v * 3 * plane;
      for (let r = 0; r < S; r++) {
        for (let c = 0; c < S; c++) {
          const sc = mirror ? S - 1 - c : c;
          const i = ((y0 + r) * w + x0 + sc) * 3, o = r * S + c;
          out[base + o] = (rgb[i] / 255 - m0) / s0;
          out[base + plane + o] = (rgb[i + 1] / 255 - m1) / s1;
          out[base + 2 * plane + o] = (rgb[i + 2] / 255 - m2) / s2;
        }
      }
      v++;
    }
  }
  return { data: out, n };
}

/** Runs the model on a photo file. Returns { score: 0..1 } (1 = AI-generated). */
export async function detectAi(file) {
  const { ort, session } = await loadDetector();
  const bmp = await decode(file);
  const { data, n } = views(bmp);
  if (bmp.close) bmp.close();
  const S = HEAD.input;
  const out = await session.run({ input: new ort.Tensor("float32", data, [n, 3, S, S]) });
  const feats = out.features.data, D = HEAD.dims, w = HEAD.w;
  let zSum = 0;
  for (let k = 0; k < n; k++) {
    let z = HEAD.b;
    const off = k * D;
    for (let j = 0; j < D; j++) z += w[j] * feats[off + j];
    zSum += z;
  }
  return { score: 1 / (1 + Math.exp(-zSum / n)) };
}

/**
 * Final decision from the model score plus file evidence.
 * Photos with genuine camera details need a much higher score before they're rejected,
 * so real site photos are rarely blocked by mistake.
 */
export function decide(signals, model) {
  const s = signals || {};
  if (s.aiMarkers && s.aiMarkers.length) {
    return { isAi: true, score: 0.99, reason: `AI-tool traces in the file (${s.aiMarkers.join(", ")})` };
  }
  if (!model) return null;
  const fromCamera = Boolean(s.camera && s.takenAt);
  let score = model.score;
  const notes = [];
  if (!fromCamera) {
    if (s.generatorSize) { score = Math.min(1, score + 0.15); notes.push(`AI-generator size ${s.width}×${s.height}`); }
    if (s.format === "png" || s.format === "webp") { score = Math.min(1, score + 0.05); notes.push(`${s.format.toUpperCase()} with no camera details`); }
  }
  const limit = fromCamera ? 0.92 : 0.6;
  const pct = Math.round(score * 100);
  return {
    isAi: score >= limit,
    score,
    reason: `${DETECTOR_NAME}: ${pct}% likely AI-generated${notes.length ? ` (${notes.join(", ")})` : ""}`,
  };
}
