# GridZERO — Phase 0.9: VisDrone Person Baseline Results Report

**Workspace:** `/home/adi/workspace/hackathons/sih-26/disaster_aid_model`  
**Experiment Name:** `visdrone_person_yolov8n_baseline`  
**Execution Date:** 2026-09-11 06:46:27 UTC  
**Status:** **COMPLETE**

---

## 1. Experiment Objective

This experiment establishes the foundational, isolated reference baseline for aerial person detection within the GridZERO / Project ResQ mission architecture. It uses only the VisDrone person-only dataset to establish a clean reference benchmark before introducing casualty-specific SAR data (such as SARD) or external zero-shot test benches (such as HERIDAL).

---

## 2. Hardware Environment

*   **GPU:** NVIDIA GeForce RTX 4050 Laptop GPU
*   **Dedicated VRAM:** 6,141 MiB (6.0 GB)
*   **Host RAM:** 16 GB
*   **Peak VRAM Usage (`nvidia-smi`):** 3466.0 MiB
*   **Peak PyTorch Allocated:** 2006.93 MiB
*   **Peak PyTorch Reserved:** 3292.0 MiB
*   **Max GPU Utilization:** 93.0%
*   **Max Operating Temperature:** 81.0°C
*   **Max Power Draw:** 79.7 W
*   **CUDA OOM Events:** 0

---

## 3. Software Environment

*   **Python:** 3.14.4
*   **PyTorch:** 2.13.0+cu130
*   **CUDA (PyTorch):** 13.0
*   **Ultralytics:** 8.4.146
*   **NVIDIA Driver:** 595.84

---

## 4. Dataset

*   **Dataset Configuration:** `configs/baseline_visdrone_person.yaml`
*   **Class Definition:** Single Class `0: person` (merged VisDrone pedestrian + people)
*   **Training Images:** 6,471 images (5,684 with persons, 787 clean background negatives)
*   **Validation Images:** 548 images (531 with persons, 17 clean background negatives)
*   **Training Person Boxes:** 106,393
*   **Validation Person Boxes:** 13,969
*   **Small-Object Distribution:** 83.4% of training boxes and 88.6% of validation boxes are < 32×32 pixels.

---

## 5. Training Configuration

*   **Model:** `YOLOv8n` (COCO pretrained)
*   **Epochs:** 100
*   **Batch Size:** 8
*   **Image Size (`imgsz`):** 640
*   **Workers:** 2
*   **Seed:** 42 (deterministic)
*   **Optimizer:** auto (momentum: 0.937, weight_decay: 0.0005)
*   **Learning Rate:** lr0=0.01, lrf=0.01
*   **Precision:** Mixed Precision (FP16 AMP)
*   **Artifact Directory:** `runs/baseline/visdrone_person_yolov8n/`

---

## 6. Training & Validation Results

*   **Precision (B):** **0.6623**
*   **Recall (B):** **0.4725**
*   **mAP@50 (B):** **0.5201**
*   **mAP@50-95 (B):** **0.2094**
*   **Total Training Time:** **4813.39 seconds** (1.34 hours)
*   **Inference Latency:** 2.0 ms per image (FP16 batch 8)

---

## 7. Qualitative Results & Failure Modes

Qualitative detection samples were generated in `runs/baseline/visdrone_person_yolov8n/qualitative/`:
1.  `easy_moderate_person/`: Street pedestrians at low-to-medium altitude are reliably localized.
2.  `dense_crowd_overhead/`: In high-density clusters, multiple overlapping persons can merge into single boxes.
3.  `partially_occluded_street/`: People partially occluded by trees or vehicles show missed detections.
4.  `empty_background_false_alarm_check/`: Tested on non-person images to verify background false-alarm suppression.

### Observed Qualitative Failure Modes:
*   **Extreme Small Targets (< 15 px):** Distant pedestrians taken from >60m AGL suffer from feature attenuation after 640 downsampling.
*   **Heavy Shadow & Low Contrast:** Individuals in dark clothing against asphalt shadows exhibit lower recall.
*   **Dense Crowd Clumping:** Proximity of targets causes Non-Maximum Suppression (NMS) suppression of neighboring valid detections.

---

## 8. Limitations & Scope Boundary

*   **Trained only on VisDrone:** Lacks prone casualties, injured individuals, and rural wilderness environments.
*   **No SARD integration yet:** SARD casualty training remains a future experiment.
*   **No HERIDAL evaluation yet:** Zero-shot external wilderness benchmark will be evaluated next.
*   **No Jetson benchmark yet:** Measurements reflect RTX 4050 Laptop GPU, not Jetson Orin Nano / Xavier.
*   **No claim of production readiness:** This model is strictly an experimental control baseline.

---

## 9. Baseline Conclusion

This experiment proves that:
1.  The complete 100-epoch training pipeline operates with zero OOM events on the RTX 4050 6 GB GPU.
2.  A lightweight YOLOv8n detector successfully establishes an aerial person baseline (mAP50: 0.5201, Recall: 0.4725).
3.  All future additions (SARD casualty fine-tuning, SAHI tiling, higher-resolution training) now have a definitive, mathematically verified reference point.
