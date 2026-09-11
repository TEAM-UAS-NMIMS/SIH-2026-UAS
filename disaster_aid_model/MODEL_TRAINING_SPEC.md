# GridZERO Disaster Aid Model — Training & Scope Specification

**Project:** GridZERO / Project ResQ  
**SIH Problem Statement:** 26177 — Qualcomm Inc.  
**Target workspace:** `/home/adi/workspace/hackathons/sih-26/disaster_aid_model`

## 1. Mission

This model owns the **Detect** stage of:

**Detect → Localize → Communicate → Visualize → Respond**

It must perform **offline, edge-native perception** on aerial disaster imagery/video. It should output structured detections that can later feed the localization and GCS systems.

The public SIH 26177 description calls for real-time on-device detection of survivors and hazards, including fire, floodwaters, damaged structures, exposed electrical lines, debris, landslide zones and chemical leaks. It also mentions RGB/thermal sensing and offline operation.

**Important:** not every hazard should automatically become a YOLO bounding-box class. Objects, regions and whole-scene conditions require different computer-vision formulations.

---

# 2. Recommended architecture

Use a **modular perception stack**, not one giant network.

### Model A — Primary aerial detector

Use a lightweight YOLO-family object detector.

Initial candidate classes:

1. `person`
2. `fire`
3. `smoke`
4. `debris`
5. `damaged_structure`
6. `electrical_line`

Only finalize a class if representative data and reliable annotations exist.

Potential later classes: `vehicle`, `rescue_equipment`, `boat`.

### Model B — Flood scene understanding

Use lightweight segmentation/classification for flood/water regions.

Floodwater is generally a **region/scene phenomenon**, so do not force it into bounding-box detection merely for architectural simplicity.

### Model C — Optional thermal-person model

Thermal human detection is relevant to the SIH concept, but it must not block the RGB MVP. Add it only when suitable thermal hardware/data are available.

---

# 3. MVP priority

The most important target is:

## `person`

Aerial people are often tiny, partially occluded and visually ambiguous. Generic YOLO performance is not sufficient evidence for SAR performance.

The person model must be tested across:

- altitude
- viewing angle
- small target sizes
- occlusion
- shadows
- clutter/rubble
- forests/open terrain
- daylight variation

For aerial small objects, investigate higher-resolution inference, tiling/overlapping tiles, multi-scale training and appropriate augmentation. Do not assume that simply increasing `imgsz` solves the problem.

---

# 4. Candidate datasets

## Aerial people / UAV imagery

### VisDrone

Use as a major source for aerial-person training/fine-tuning.

VisDrone contains drone imagery, video frames and annotations, including pedestrians. Its published benchmark contains 10,209 static images, 261,908 video frames and more than 2.6 million annotated bounding boxes across its object categories.

Do not train on every VisDrone class. Map only useful source annotations into the GridZERO schema.

## Fire / smoke

### D-Fire

Useful for `fire` and `smoke`.

Published dataset statistics:

- >21,000 images
- fire-only: 1,164
- smoke-only: 5,867
- fire + smoke: 4,658
- none: 9,838
- fire boxes: 14,692
- smoke boxes: 11,865

Annotations are available in YOLO format.

Expect domain mismatch because D-Fire is not exclusively UAV/SAR imagery. Supplement it with suitable aerial/disaster imagery where licensing permits.

## Flood

### FloodNet

Highly relevant because it uses high-resolution UAS imagery collected after Hurricane Harvey.

Semantic classes include:

- background
- flooded building
- non-flooded building
- flooded road
- non-flooded road
- water
- tree
- vehicle
- pool
- grass

Use this for flood/scene segmentation or classification rather than automatically converting everything to bounding boxes.

## Building damage

### xBD

xBD contains building polygons and damage labels across disaster events and also labels environmental factors such as fire, water and smoke.

It is valuable for building-damage research, but it is not a clean UAV object-detection dataset. Use it for a later segmentation/classification branch or only convert labels to detection boxes when the conversion is scientifically justified and documented.

## Custom GridZERO data

Create a project-specific validation/test set from legally usable aerial disaster footage/images.

This is essential because benchmark performance alone does not establish performance on our intended SAR imagery.

---

# 5. Dataset engineering rules

Use multiple sources rather than one dataset.

Maintain:

```text
datasets/
├── raw/
│   ├── visdrone/
│   ├── dfire/
│   ├── floodnet/
│   ├── xbd/
│   └── custom/
├── processed/
│   ├── detection/
│   ├── segmentation/
│   └── classification/
└── gridzero/
    ├── train/
    ├── val/
    └── test/
```

For detection use YOLO-compatible image/label pairs.

Every converted annotation must retain:

- source dataset
- original class
- mapped GridZERO class
- conversion method
- license
- split information

### Avoid leakage

Never randomly split adjacent frames from the same video into train and validation.

Prefer splitting by:

- video/sequence
- disaster event
- geographic region

where possible.

---

# 6. Training phases

## Phase 0 — Baseline

Run a pretrained lightweight YOLO model on representative GridZERO footage before training.

Record actual:

- precision
- recall
- mAP50
- mAP50-95
- per-class results
- false positives
- small-person failures
- latency/FPS

This establishes the baseline.

## Phase 1 — Person specialization

Fine-tune using aerial-person data, prioritizing small-object recall.

## Phase 2 — Hazard detection

Add fire/smoke and then other hazard classes only when sufficient representative data exist.

## Phase 3 — Flood branch

Train a lightweight segmentation/classification branch using FloodNet or compatible data.

## Phase 4 — Integration

Expose a common perception interface such as:

```json
{
  "timestamp": 123456789,
  "detections": [
    {
      "class": "person",
      "confidence": 0.94,
      "bbox": [x1, y1, x2, y2]
    }
  ],
  "scene": {
    "flood_probability": 0.76
  }
}
```

The numbers above are illustrative schema values only, not measured results.

---

# 7. Model-size strategy

The deployment target is the Jetson, not the RTX 4050 laptop.

Start with the smallest pretrained model that can satisfy the detection requirement.

Benchmark progressively:

```text
small model
    ↓
measure
    ↓
medium model if necessary
    ↓
compare accuracy / latency / memory
    ↓
select deployment model
```

Do not train a large model from scratch.

---

# 8. Development hardware constraints

Current development machine:

- Lenovo LOQ
- RTX 4050
- 6 GB VRAM
- 16 GB RAM
- native Ubuntu Linux

Use:

- pretrained weights
- mixed precision
- manageable image sizes
- batch sizes that fit 6 GB VRAM
- gradient accumulation only if needed

Do not assume laptop GPU FPS equals Jetson deployment FPS.

---

# 9. Evaluation

For detection report:

- precision
- recall
- mAP50
- mAP50-95
- per-class precision/recall
- confusion matrix
- inference latency
- FPS
- model size

For SAR, recall for `person` is especially important because a missed survivor is more serious than a candidate false positive. Precision still matters because excessive false alarms burden responders.

### Person-specific evaluation buckets

Evaluate separately by:

**Target size**
- tiny
- small
- medium
- large

**Scene**
- open terrain
- forest
- rubble
- road
- urban
- collapsed structures

**Visibility**
- clear
- partially occluded
- heavily occluded
- shadow
- low contrast

**Altitude/view**
- low
- medium
- high

This is more meaningful than reporting only one aggregate benchmark number.

---

# 10. Deployment interface

The deployed perception pipeline should support:

- offline inference
- image/video input
- GPU/NPU acceleration where available
- configurable confidence threshold
- configurable IoU threshold
- class labels
- bounding boxes
- confidence
- timestamps/frame IDs
- structured output

Target:

```text
RGB camera
    ↓
preprocessing
    ↓
GridZERO detector
    ↓
detections
    ↓
localization
    ↓
telemetry
    ↓
GCS
```

No cloud dependency.

---

# 11. What NOT to build initially

Do not initially build:

- one enormous multi-task network
- thermal fusion
- acoustic cry detection
- autonomous navigation
- VIO/SLAM
- GCS
- cloud inference
- chemical identification
- temporal transformers
- a custom neural architecture from scratch

These are separate system components.

---

# 12. Final MVP

The first useful detector should produce, where supported by data:

```text
PERSON
  bbox + confidence

FIRE
  bbox + confidence

SMOKE
  bbox + confidence

DEBRIS
  bbox + confidence

DAMAGED_STRUCTURE
  bbox + confidence

ELECTRICAL_LINE
  bbox + confidence
```

and optionally:

```text
FLOOD
  probability + segmentation mask
```

The exact final class list is subject to dataset feasibility and validation.

A smaller set of reliable SAR detections is preferable to many poorly supported classes.

---

# 13. Priority

## MUST HAVE

1. Inspect candidate datasets and licenses.
2. Build reproducible dataset organization/conversion.
3. Establish a pretrained YOLO baseline.
4. Fine-tune aerial person detection.
5. Evaluate small-object performance.
6. Add fire/smoke.
7. Add other hazard classes only when enough representative data exists.
8. Benchmark an edge-deployable model.

## SHOULD HAVE

9. Flood segmentation/classification.
10. GridZERO-specific validation set.
11. Video inference pipeline.
12. Temporal smoothing/tracking.
13. Structured JSON output.
14. Localization integration interface.

## NICE TO HAVE

15. Thermal model/fusion.
16. Multi-object tracking.
17. Active learning.
18. Quantization/pruning experiments.
19. NPU-specific optimization.
20. Research comparison across model sizes.

---

# 14. Agent operating rules

Before downloading datasets or installing packages:

1. Inspect the existing workspace.
2. Inspect installed Python/CUDA/PyTorch/Ultralytics capabilities.
3. Check GPU VRAM and available disk.
4. Do not modify the GridZERO repository.
5. Do not install large dependencies without reporting them first.
6. Do not automatically download huge datasets without approval.
7. Verify dataset licenses before using data in a distributable project.
8. Keep raw data separate from processed data.
9. Preserve source attribution and metadata.
10. Make preprocessing/conversion reproducible.
11. Never claim model performance without actually evaluating it.
12. Never fabricate dataset statistics or results.

## FIRST AGENT TASK — DATASET FEASIBILITY REPORT

**Do NOT train anything yet.**

First produce a report containing for every candidate dataset:

- source URL
- license
- image/frame count
- classes
- annotation type
- aerial/UAV relevance
- usefulness for GridZERO
- conversion effort
- approximate storage requirement
- whether it should be used

Then propose the exact first training experiment.

**Only after reviewing that report should dataset downloads and training begin.**
