import os, io, random, numpy as np, onnxruntime as ort
from PIL import Image
random.seed(0)
DB = "/tmp/claude-0/probe/ankurmaurya01_AI-Image-Detector/database"
sess = ort.InferenceSession("mnv2_features.onnx", providers=["CPUExecutionProvider"])
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)

def jpeg(im, q):
    b = io.BytesIO(); im.save(b, "JPEG", quality=q); b.seek(0); return Image.open(b).convert("RGB")

def prep(im, mode):
    im = im.convert("RGB")
    if mode != "center":
        if random.random() < 0.7: im = jpeg(im, random.randint(60, 95))   # same compression for both classes
        if random.random() < 0.3:  # downscale like a messaging app
            s = random.uniform(0.4, 0.8); im = im.resize((max(64, int(im.width * s)), max(64, int(im.height * s))), Image.BILINEAR)
    w, h = im.size; s = 256 / min(w, h)
    im = im.resize((max(224, round(w * s)), max(224, round(h * s))), Image.BILINEAR)
    w, h = im.size
    if mode == "center": x, y = (w - 224) // 2, (h - 224) // 2
    else: x, y = random.randint(0, w - 224), random.randint(0, h - 224)
    im = im.crop((x, y, x + 224, y + 224))
    if mode != "center" and random.random() < 0.5: im = im.transpose(Image.FLIP_LEFT_RIGHT)
    a = (np.asarray(im, np.float32) / 255 - MEAN) / STD
    return a.transpose(2, 0, 1)

def run(split, variants):
    X, y = [], []
    for label, c in [(0, "REAL"), (1, "FAKE")]:
        d = f"{DB}/{split}/{c}"
        for f in sorted(os.listdir(d)):
            try: im = Image.open(os.path.join(d, f)); im.load()
            except Exception: continue
            batch = np.stack([prep(im, m) for m in variants])
            feats = sess.run(None, {"input": batch})[0]
            for v in feats: X.append(v); y.append(label)
    return np.array(X, np.float32), np.array(y)

Xtr, ytr = run("train", ["center", "aug", "aug"])
Xva, yva = run("valid", ["center", "aug"])
Xte, yte = run("test", ["center"])
np.savez_compressed("feats.npz", Xtr=Xtr, ytr=ytr, Xva=Xva, yva=yva, Xte=Xte, yte=yte)
print(Xtr.shape, Xva.shape, Xte.shape)
