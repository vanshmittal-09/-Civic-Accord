import os, json, numpy as np, onnxruntime as ort
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, accuracy_score, confusion_matrix
d = np.load("feats.npz")
X = np.vstack([d["Xtr"], d["Xva"]]); y = np.concatenate([d["ytr"], d["yva"]])
sc = StandardScaler().fit(X)
clf = LogisticRegression(C=0.05, max_iter=6000).fit(sc.transform(X), y)

# test with multi-crop averaging (same as the browser will do)
DB = "/tmp/claude-0/probe/ankurmaurya01_AI-Image-Detector/database/test"
sess = ort.InferenceSession("mnv2_features.onnx", providers=["CPUExecutionProvider"])
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
def crops(im):
    im = im.convert("RGB"); w, h = im.size; s = 256 / min(w, h)
    im = im.resize((max(224, round(w*s)), max(224, round(h*s))), Image.BILINEAR); w, h = im.size
    out = []
    for (x, y0) in [((w-224)//2, (h-224)//2), (0, 0), (w-224, 0), (0, h-224), (w-224, h-224)]:
        c = im.crop((x, y0, x+224, y0+224))
        for cc in (c, c.transpose(Image.FLIP_LEFT_RIGHT)):
            out.append(((np.asarray(cc, np.float32)/255 - MEAN)/STD).transpose(2,0,1))
    return np.stack(out)
def score(feats):
    z = clf.decision_function(sc.transform(feats))
    return 1/(1+np.exp(-z.mean()))
ys, ps1, ps10 = [], [], []
for label, c in [(0,"REAL"),(1,"FAKE")]:
    for f in sorted(os.listdir(f"{DB}/{c}")):
        try: im = Image.open(f"{DB}/{c}/{f}"); im.load()
        except Exception: continue
        F = sess.run(None, {"input": crops(im)})[0]
        ys.append(label); ps1.append(score(F[:1])); ps10.append(score(F))
ys, ps1, ps10 = map(np.array, (ys, ps1, ps10))
for name, p in [("1 crop", ps1), ("10 crops", ps10)]:
    print(f"TEST {name}: acc={accuracy_score(ys, p>0.5):.3f} auc={roc_auc_score(ys, p):.3f}", confusion_matrix(ys, p>0.5).tolist())
for t in [0.5, 0.6, 0.7, 0.8]:
    pr = ps10 > t
    print(f"  threshold {t}: AI caught {pr[ys==1].mean():.0%}, real wrongly flagged {pr[ys==0].mean():.0%}")
# export head: fold scaler into weights  z = w·((x-mu)/sd) + b
w = clf.coef_[0] / sc.scale_; b = clf.intercept_[0] - np.sum(clf.coef_[0] * sc.mean_ / sc.scale_)
json.dump({"version": 1, "dims": int(len(w)), "w": [round(float(v), 7) for v in w], "b": float(b),
           "input": 224, "resizeShort": 256, "mean": MEAN.tolist(), "std": STD.tolist(),
           "test": {"accuracy": round(float(accuracy_score(ys, ps10>0.5)), 3), "auc": round(float(roc_auc_score(ys, ps10)), 3)}},
          open("head.json", "w"))
print("head.json", os.path.getsize("head.json"))
