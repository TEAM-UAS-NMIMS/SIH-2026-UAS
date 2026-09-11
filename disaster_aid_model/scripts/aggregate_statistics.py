#!/usr/bin/env python3
"""
GridZERO Dataset Statistics Aggregator
Compiles complete dataset statistics into machine-readable dataset_statistics.json
"""

import json
from pathlib import Path

def aggregate_statistics(workspace: Path):
    stats = {
        'phase': 'Phase 0.7 - Dataset Acquisition & Preprocessing Setup',
        'datasets': {},
        'system_status': {
            'storage_raw_gb': 3.1,
            'storage_processed_mb': 54.0,
            'storage_available_gb': 387.0
        }
    }

    # 1. VisDrone
    visdrone_stats_file = workspace / 'datasets' / 'processed' / 'visdrone_person' / 'visdrone_person_stats.json'
    if visdrone_stats_file.exists():
        with open(visdrone_stats_file, 'r', encoding='utf-8') as f:
            stats['datasets']['visdrone_person'] = json.load(f)

    # 2. SARD
    sard_manifest_file = workspace / 'datasets' / 'processed' / 'sard_person' / 'split_manifest.json'
    if sard_manifest_file.exists():
        with open(sard_manifest_file, 'r', encoding='utf-8') as f:
            stats['datasets']['sard_person'] = json.load(f)

    # 3. HERIDAL
    heridal_manifest_file = workspace / 'datasets' / 'external' / 'heridal_person' / 'heridal_benchmark_manifest.json'
    if heridal_manifest_file.exists():
        with open(heridal_manifest_file, 'r', encoding='utf-8') as f:
            stats['datasets']['heridal_person'] = json.load(f)

    # 4. QC Verification
    qc_file = workspace / 'qc_verification_report.json'
    if qc_file.exists():
        with open(qc_file, 'r', encoding='utf-8') as f:
            stats['quality_control'] = json.load(f)

    out_file = workspace / 'dataset_statistics.json'
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(stats, f, indent=2)

    print(f"Aggregated statistics written to: {out_file}")

if __name__ == '__main__':
    workspace = Path('/home/adi/workspace/hackathons/sih-26/disaster_aid_model')
    aggregate_statistics(workspace)
