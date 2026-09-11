# GridZERO — Phase 0.9 Baseline Experiment Configuration

**Project:** GridZERO / Project ResQ  
**SIH Problem Statement:** 26177 — Qualcomm Inc.  
**Target:** Aerial Survivor / Person Detection Baseline  
**Date:** 2026-09-11  

---

## 1. Objective & Purpose

This experiment establishes the first reproducible, isolated aerial-person detection baseline using:
```text
COCO-pretrained YOLOv8n
        ↓
VisDrone Person-only (Class 0: person)
        ↓
100 Epochs Training (Batch 8, imgsz 640)
        ↓
Standard VisDrone Validation Split Evaluation
```
This baseline serves as the scientific control against which future datasets (such as SARD casualty poses and HERIDAL external zero-shot wilderness evaluation) will be measured.

---

## 2. Frozen Experiment Configuration

*   **Model:** `YOLOv8n` (`yolov8n.pt`, 3.01M parameters, 8.1 GFLOPs, COCO-pretrained weights).
*   **Dataset:** `datasets/processed/visdrone_person/`
    *   Train images: 6,471 images (5,684 with persons, 787 clean background negatives)
    *   Train person boxes: 106,393
    *   Val images: 548 images (531 with persons, 17 clean background negatives)
    *   Val person boxes: 13,969
*   **Classes:** 1 class: `0: person` (unifying VisDrone `pedestrian` [category 1] and `people` [category 2] where `score == 1`).
*   **Image Size (`imgsz`):** `640`
*   **Batch Size:** `8` (selected based on RTX 4050 6 GB VRAM safety margin; ~1.2–1.8 GB expected VRAM draw).
*   **Epochs:** `100` (full convergence schedule; no arbitrary early cutoff).
*   **Optimizer:** `auto` (Ultralytics default SGD/AdamW with standard momentum 0.937 and weight decay 0.0005).
*   **Learning Rate Configuration:** `lr0=0.01`, `lrf=0.01` (initial learning rate decaying to 1% of initial).
*   **Scheduler:** Linear / Cosine decay (`cos_lr=False`).
*   **Augmentation:** Standard Ultralytics YOLOv8 baseline augmentations:
    *   `mosaic=1.0` (active until last 10 epochs)
    *   `close_mosaic=10` (disables mosaic in final 10 epochs for sharp localization)
    *   `fliplr=0.5`
    *   `hsv_h=0.015`, `hsv_s=0.7`, `hsv_v=0.4`
    *   `translate=0.1`, `scale=0.5`
*   **Seed:** `42` (`deterministic=True`).
*   **Device:** `0` (NVIDIA GeForce RTX 4050 Laptop GPU, 6,141 MiB dedicated VRAM).
*   **Workers:** `2` (safe thread allocation on 16 GB host RAM).
*   **Precision:** Mixed Precision (`amp=True`, FP16).
*   **Checkpoint Selection Rule:** `best.pt` selected automatically by maximum validation `mAP50-95(B)`; `last.pt` preserved as final epoch state.
*   **Evaluation Dataset:** Official VisDrone2019-DET validation split (548 images, 13,969 person boxes).
*   **Artifact Directory:** `runs/baseline/visdrone_person_yolov8n/`

---

## 3. Methodological Note

No hyperparameter is assumed to be "optimal". This run strictly establishes the foundational reference benchmark under reproducible constraints.
