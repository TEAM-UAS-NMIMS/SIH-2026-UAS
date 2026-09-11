# GridZERO — Phase 0.8: YOLO GPU Smoke Test Report

**Workspace:** `/home/adi/workspace/hackathons/sih-26/disaster_aid_model`  
**Phase:** Phase 0.8 — YOLO GPU Pipeline Smoke Test  
**Execution Timestamp:** 2026-09-11T03:36:20Z  
**Result:** **PASS**

---

## 1. Environment

*   **Python Version:** `3.14.4` (`/usr/bin/python3`)
*   **PyTorch Version:** `2.13.0+cu130`
*   **TorchVision Version:** `0.29.0+cu130`
*   **Ultralytics Version:** `8.4.146`
*   **CUDA Version Reported by PyTorch:** `13.0`
*   **NVIDIA Driver Version:** `595.84`
*   **System CUDA Version (Driver):** `13.2`
*   **GPU Model:** `NVIDIA GeForce RTX 4050 Laptop GPU`
*   **Physical Dedicated VRAM:** `6,141 MiB` (6.0 GB)
*   **Host System RAM:** `16 GB`

---

## 2. Dataset

*   **Dataset Configuration YAML:** `configs/visdrone_person.yaml`
*   **Dataset Root Path:** `/home/adi/workspace/hackathons/sih-26/disaster_aid_model/datasets/processed/visdrone_person`
*   **Train Images Count:** **6,471 images** (symlinked from raw VisDrone images)
*   **Validation Images Count:** **548 images** (symlinked from raw VisDrone images)
*   **Class Count (`nc`):** **1**
*   **Class Names:** `{0: 'person'}` (unifying `pedestrian` and `people`)
*   **Cache Status:** `labels/train.cache` and `labels/val.cache` scanned and generated with zero missing labels.

---

## 3. Training & Hardware Execution

*   **Pretrained Architecture:** `YOLOv8n` (`yolov8n.pt`, 3,005,843 parameters, 8.1 GFLOPs)
*   **Input Image Resolution (`imgsz`):** `640`
*   **Batch Size:** `2`
*   **Epochs:** `1` (strictly minimal smoke test)
*   **DataLoader Workers:** `2`
*   **Compute Device:** `0` (CUDA:0 - NVIDIA GeForce RTX 4050 Laptop GPU)
*   **Mixed Precision (AMP):** Enabled (`amp=True`, FP16)
*   **Training Wall-Clock Time:** **199.54 seconds** (~3.3 minutes total execution)
*   **Measured Speed:**
    *   Training loop: **~17.5 - 18.9 iterations/sec** (batch size 2)
    *   Inference latency: **2.0 ms per image**
    *   Preprocess latency: **0.1 ms per image**
    *   Postprocess latency: **1.0 ms per image**

---

## 4. Resource Usage & Hardware Monitoring (Actual Measured Values)

| Resource Metric | Measured Value | Percentage of Capacity |
| :--- | :--- | :--- |
| **Initial Idle VRAM (System)** | 15.0 MiB | 0.2% |
| **Peak PyTorch Memory Allocated** | **395.16 MiB** | 6.4% |
| **Peak PyTorch Memory Reserved** | **464.00 MiB** | 7.6% |
| **Peak `nvidia-smi` GPU Memory** | **632.00 MiB** | **10.3%** |
| **Peak GPU Compute Utilization** | **34.0%** | — |
| **GPU Operating Temperature** | **55°C** | Safe |
| **GPU Power Draw** | **17W / 75W** | Low thermal stress |

Zero CUDA Out-Of-Memory (OOM) events occurred. Memory overhead remained exceptionally light at batch size 2.

---

## 5. Checkpoint Verification

*   **Checkpoint Directory:** `/home/adi/workspace/hackathons/sih-26/disaster_aid_model/runs/smoke_test/phase_0_8_yolov8n/weights/`
*   **Generated Checkpoints:**
    *   `best.pt`: **5.93 MB** (Valid PyTorch checkpoint, optimizer stripped)
    *   `last.pt`: **5.93 MB** (Valid PyTorch checkpoint, optimizer stripped)
*   **Instantiation Check:** Successfully re-loaded `best.pt` into a clean `ultralytics.YOLO` model instance without error.

---

## 6. Observed Issues & Resolutions

1.  **PyPI Torch Replacement Risk:**
    *   *Issue:* Running a standard `pip install ultralytics` on modern Python distributions attempts to resolve `torch>=1.8.0` by pulling a generic CPU-only PyTorch wheel, which would overwrite the existing GPU-enabled `torch 2.13.0+cu130`.
    *   *Resolution:* Installed helper packages (`scipy`, `matplotlib`, `pandas`, `tqdm`, `opencv-python-headless`) independently and installed `ultralytics` with `--no-deps`. This strictly preserved the CUDA-accelerated `torch 2.13.0+cu130` installation on the RTX 4050.
2.  **Missing `torchvision` Metadata:**
    *   *Issue:* Ultralytics checks `importlib.metadata.version("torchvision")` on startup, raising `PackageNotFoundError` if torchvision package metadata is absent.
    *   *Resolution:* Installed `torchvision==0.29.0` with `--no-deps` to provide metadata without modifying the underlying CUDA PyTorch wheel.
3.  **Missing `polars` for Results Logging:**
    *   *Issue:* During the first run attempt, after the training and validation passes completed, Ultralytics 8.4 attempted to import `polars` for plotting summary curves, triggering a `ModuleNotFoundError`.
    *   *Resolution:* Installed `polars` along with `cloudpickle`, `nvidia-ml-py`, and `ultralytics-platform`. The subsequent rerun completed the entire training, validation, plotting, and checkpoint save cycle cleanly.

---

## 7. Important Interpretation

> [!IMPORTANT]
> **This was a pipeline smoke test and its metrics must NOT be interpreted as the final GridZERO detector benchmark.**
> A single epoch at batch size 2 on a subset of the learning rate schedule is designed purely to verify numerical stability, GPU kernel execution, CUDA memory safety, dataloader integrity, and artifact persistence. It does not reflect the accuracy, recall, or operational viability of the GridZERO SAR perception system.

---

## 8. Final Status

```text
============================================================
PHASE 0.8 SMOKE TEST VERDICT: PASS
============================================================
CUDA works:                     YES (RTX 4050 active)
YOLO loads:                     YES (YOLOv8n)
Dataset loads:                  YES (VisDrone Person)
Training starts:                YES
Forward/backward pass succeeds: YES
Validation completes:           YES
Checkpoint is produced:         YES (best.pt / last.pt verified)
============================================================
```

**All Phase 0.8 objectives have been achieved. STOPPED. No full training, hyperparameter tuning, or SARD integration will begin without explicit approval.**
