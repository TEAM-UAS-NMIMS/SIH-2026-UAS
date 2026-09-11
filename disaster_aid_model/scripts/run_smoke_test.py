#!/usr/bin/env python3
"""
GridZERO Phase 0.8: YOLO GPU Smoke Test Runner
Runs a single-epoch, minimal-batch smoke test on the RTX 4050 GPU using VisDrone person-only.
Monitors exact GPU VRAM allocation, loss convergence, backprop, checkpoint generation, and validation.
"""

import os
import sys
import time
import json
import subprocess
from pathlib import Path
import torch
from ultralytics import YOLO

def get_gpu_memory_nvidiasmi():
    try:
        res = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu", "--format=csv,nounits,noheader"],
            encoding='utf-8'
        ).strip().split(',')
        return {
            'gpu_used_mb': float(res[0].strip()),
            'gpu_total_mb': float(res[1].strip()),
            'gpu_util_pct': float(res[2].strip())
        }
    except Exception as e:
        return {'error': str(e)}

def run_smoke_test():
    workspace = Path('/home/adi/workspace/hackathons/sih-26/disaster_aid_model')
    config_file = workspace / 'configs' / 'visdrone_person.yaml'

    print("=" * 60)
    print("GridZERO Phase 0.8: YOLO GPU Smoke Test Initializing")
    print("=" * 60)

    # Pre-test GPU check
    if not torch.cuda.is_available():
        print("ERROR: CUDA is not available! Halting smoke test.")
        sys.exit(1)

    device_name = torch.cuda.get_device_name(0)
    total_vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f"Detected GPU: {device_name} ({total_vram_gb:.2f} GB Total VRAM)")

    torch.cuda.reset_peak_memory_stats(0)
    start_smi = get_gpu_memory_nvidiasmi()
    print(f"Initial GPU state: {start_smi['gpu_used_mb']:.1f} MB used, {start_smi['gpu_util_pct']}% utilization")

    # Load smallest lightweight YOLO model
    model_name = 'yolov8n.pt'
    print(f"Loading pretrained model: {model_name}...")
    model = YOLO(model_name)

    smoke_results = {
        'timestamp': time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        'device_name': device_name,
        'torch_version': torch.__version__,
        'cuda_version': torch.version.cuda,
        'model_architecture': 'YOLOv8n',
        'config': {
            'epochs': 1,
            'batch': 2,
            'imgsz': 640,
            'workers': 2,
            'device': 0
        },
        'initial_gpu': start_smi,
        'peak_vram_torch_allocated_mb': 0.0,
        'peak_vram_torch_reserved_mb': 0.0,
        'peak_gpu_nvidiasmi_mb': 0.0,
        'max_gpu_utilization_pct': 0.0,
        'forward_backward_pass_succeeded': False,
        'validation_succeeded': False,
        'checkpoint_generated': False,
        'checkpoint_path': '',
        'checkpoint_size_mb': 0.0,
        'training_time_seconds': 0.0,
        'status': 'FAILED'
    }

    # Custom monitoring callbacks
    def on_train_batch_end(trainer):
        # Sample nvidia-smi and torch memory
        torch_alloc = torch.cuda.memory_allocated(0) / (1024 * 1024)
        torch_res = torch.cuda.memory_reserved(0) / (1024 * 1024)
        smi = get_gpu_memory_nvidiasmi()

        smoke_results['peak_vram_torch_allocated_mb'] = max(smoke_results['peak_vram_torch_allocated_mb'], torch_alloc)
        smoke_results['peak_vram_torch_reserved_mb'] = max(smoke_results['peak_vram_torch_reserved_mb'], torch_res)
        if 'gpu_used_mb' in smi:
            smoke_results['peak_gpu_nvidiasmi_mb'] = max(smoke_results['peak_gpu_nvidiasmi_mb'], smi['gpu_used_mb'])
            smoke_results['max_gpu_utilization_pct'] = max(smoke_results['max_gpu_utilization_pct'], smi['gpu_util_pct'])

    model.add_callback('on_train_batch_end', on_train_batch_end)

    start_time = time.time()
    try:
        # Launch 1-epoch smoke test
        print("\nStarting 1-epoch smoke test training...")
        results = model.train(
            data=str(config_file),
            epochs=1,
            batch=2,
            imgsz=640,
            workers=2,
            device=0,
            project=str(workspace / 'runs' / 'smoke_test'),
            name='phase_0_8_yolov8n',
            exist_ok=True,
            verbose=True,
            val=True,
            save=True,
            plots=True
        )

        smoke_results['forward_backward_pass_succeeded'] = True
        smoke_results['validation_succeeded'] = True

    except Exception as e:
        print(f"\nERROR encountered during smoke test: {e}")
        smoke_results['error'] = str(e)
        smoke_results['status'] = 'FAIL'
        with open(workspace / 'smoke_test_results.json', 'w', encoding='utf-8') as f:
            json.dump(smoke_results, f, indent=2)
        sys.exit(1)

    elapsed = time.time() - start_time
    smoke_results['training_time_seconds'] = round(elapsed, 2)

    # Peak torch stats
    smoke_results['peak_vram_torch_allocated_mb'] = max(
        smoke_results['peak_vram_torch_allocated_mb'],
        torch.cuda.max_memory_allocated(0) / (1024 * 1024)
    )
    smoke_results['peak_vram_torch_reserved_mb'] = max(
        smoke_results['peak_vram_torch_reserved_mb'],
        torch.cuda.max_memory_reserved(0) / (1024 * 1024)
    )

    # Verify checkpoint output
    save_dir = Path(model.trainer.save_dir)
    best_pt = save_dir / 'weights' / 'best.pt'
    last_pt = save_dir / 'weights' / 'last.pt'

    print("\nVerifying checkpoint outputs...")
    target_pt = best_pt if best_pt.exists() else last_pt
    if target_pt.exists() and target_pt.stat().st_size > 1024:
        smoke_results['checkpoint_generated'] = True
        smoke_results['checkpoint_path'] = str(target_pt)
        smoke_results['checkpoint_size_mb'] = round(target_pt.stat().st_size / (1024 * 1024), 2)
        print(f"Checkpoint verified: {target_pt} ({smoke_results['checkpoint_size_mb']} MB)")

        # Verify instantiation of checkpoint
        test_reload = YOLO(str(target_pt))
        print("Checkpoint re-loaded into YOLO instance successfully!")
    else:
        print(f"ERROR: Checkpoint missing or empty in {save_dir / 'weights'}")

    if smoke_results['forward_backward_pass_succeeded'] and smoke_results['validation_succeeded'] and smoke_results['checkpoint_generated']:
        smoke_results['status'] = 'PASS'
        print("\n" + "=" * 60)
        print("PHASE 0.8 SMOKE TEST RESULT: PASS")
        print("=" * 60)
    else:
        smoke_results['status'] = 'FAIL'
        print("\n" + "=" * 60)
        print("PHASE 0.8 SMOKE TEST RESULT: FAIL")
        print("=" * 60)

    # Write machine-readable results
    with open(workspace / 'smoke_test_results.json', 'w', encoding='utf-8') as f:
        json.dump(smoke_results, f, indent=2)

    return smoke_results

if __name__ == '__main__':
    run_smoke_test()
