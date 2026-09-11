# D-AID v1: Disaster AI Detection Baseline

**Model Identifier:** `d_aid_v1`  
**Architecture:** `YOLOv8n` (COCO-pretrained base)  
**Task:** Aerial Person Detection (Class 0: `person`)  
**Training Source:** VisDrone2019-DET Person-Only Dataset (6,471 train / 548 val images)  
**Creation Date:** 2026-09-11  

---

## 1. Description & Purpose
D-AID v1 serves as the frozen reference baseline for Project ResQ Mission Control / GridZERO perception stack (SIH Problem Statement 26177). It was trained strictly on aerial person annotations to establish a clean, reproducible starting point before integrating additional disaster modalities (fire, smoke, flood, SARD casualty data).

## 2. Checkpoint Details
* **Weights File:** `models/d_aid_v1/best.pt`
* **Source Checkpoint:** `runs/baseline/visdrone_person_yolov8n/weights/best.pt`
* **Size:** 6.0 MB (3,005,843 parameters)
* **Compute Footprint:** 8.1 GFLOPs at 640×640 input resolution

## 3. Training Specification
* **Epochs:** 100
* **Batch Size:** 8
* **Image Size (`imgsz`):** 640
* **Optimizer:** Auto (SGD with momentum 0.937, weight decay 0.0005)
* **Seed:** 42 (deterministic)
* **Hardware:** NVIDIA GeForce RTX 4050 Laptop GPU (6 GB VRAM)
* **Training Time:** 4,813.39 seconds (~1.34 hours)

## 4. Formal Validation Performance (VisDrone Val)
* **Precision:** 0.6623
* **Recall:** 0.4725
* **mAP@50:** 0.5201
* **mAP@50-95:** 0.2094
* **Peak F1 Score:** 0.5516 (at confidence threshold 0.276)

## 5. Versioning Rule
D-AID v1 is permanently frozen. All future experiments must increment version numbers (`d_aid_v2`, `d_aid_v3`, etc.) and preserve their corresponding weights, configurations, and forensic evaluations without overwriting previous iterations.
