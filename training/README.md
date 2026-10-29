# Civic Accord AI Detector: training

Our own AI-generated-image detector. It runs in the browser (`src/aiDetector.js`) with no outside AI service.

1. `make_feat_model.py`: takes MobileNetV2 (ImageNet, from the ONNX Model Zoo) and turns it into a feature extractor.
   The output has 2,176 values: the final 1,280-d embedding plus the mean and second moment of 8 earlier layers, which capture fine texture.
2. `extract.py`: extracts features for every training image. Each image is resized so its short side is 256 px, then cropped to 224×224.
   Training images get random JPEG re-compression, downscaling, crops and flips, so the model can't cheat on file format or size.
3. `final.py`: trains a logistic-regression head on top and tests it with 10-view averaging, the same as the browser.
   It then exports `src/aiHead.json` (weights + bias).

Dataset: 1,622 labelled real / AI-generated images from github.com/ankurmaurya01/AI-Image-Detector (`database/`), using its train, valid and test splits.

Held-out test set (229 images): **96.5% accuracy, ROC AUC 0.99**. It caught 98% of AI images and wrongly flagged 5% of real photos.

In the app, a photo with genuine camera details (make/model + capture time) must score ≥ 92% to be rejected; other photos are rejected at ≥ 60%.
Photos that are a typical AI-generator size, or saved as PNG/WebP with no camera details, get a small boost.
The browser resize reproduces Pillow's bilinear filter, so browser and Python scores match exactly.

Limits: the training data is general photography, not Indian street scenes. Retrain on real civic photos plus AI images of
garbage, potholes and drains before production use, and keep a human appeal route for false positives.
