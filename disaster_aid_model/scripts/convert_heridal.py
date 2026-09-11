#!/usr/bin/env python3
"""
GridZERO Benchmark Preprocessing: HERIDAL Full-Frame -> YOLO Person Benchmark
Converts HERIDAL full-frame 12MP images to a frozen external evaluation set.
Strictly quarantines HERIDAL in datasets/external/heridal_person/
DO NOT USE THIS DATA FOR TRAINING, HYPERPARAMETER TUNING, OR CHECKPOINT SELECTION.
"""

import os
import sys
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image

def convert_heridal_benchmark(raw_dir: Path, out_dir: Path):
    print(f"Scanning raw HERIDAL directory: {raw_dir}...")

    image_exts = {'.jpg', '.jpeg', '.png', '.bmp'}
    # Only full-frame images (ignore any patches directory)
    raw_images = [
        p for p in raw_dir.rglob('*')
        if p.suffix.lower() in image_exts and 'patch' not in str(p).lower()
    ]

    out_images_dir = out_dir / 'images'
    out_labels_dir = out_dir / 'labels'
    out_images_dir.mkdir(parents=True, exist_ok=True)
    out_labels_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        'benchmark_dataset': 'HERIDAL Full-Frame (Frozen External Benchmark)',
        'role': 'ZERO-SHOT EXTERNAL SAR EVALUATION ONLY',
        'total_images': len(raw_images),
        'images_with_persons': 0,
        'empty_background_images': 0,
        'total_person_boxes': 0,
        'resolutions': {},
        'bbox_widths': [],
        'bbox_heights': [],
        'bbox_areas': []
    }

    if not raw_images:
        print(f"Warning: No raw full-frame HERIDAL images found in {raw_dir}. Script is ready to run once data archive is placed.")
        with open(out_dir / 'heridal_benchmark_manifest.json', 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2)
        return manifest

    print(f"Processing {len(raw_images)} full-frame HERIDAL images for external benchmark...")

    for img_path in raw_images:
        # Create symlink
        out_img_link = out_images_dir / img_path.name
        if not out_img_link.exists():
            os.symlink(img_path.resolve(), out_img_link)

        with Image.open(img_path) as img:
            w_img, h_img = img.size

        res_key = f"{w_img}x{h_img}"
        manifest['resolutions'][res_key] = manifest['resolutions'].get(res_key, 0) + 1

        dw = 1.0 / w_img
        dh = 1.0 / h_img

        yolo_lines = []
        xml_path = img_path.with_suffix('.xml')
        if not xml_path.exists():
            candidate = img_path.parent / 'annotations' / f"{img_path.stem}.xml"
            if candidate.exists():
                xml_path = candidate

        if xml_path.exists():
            try:
                tree = ET.parse(xml_path)
                root = tree.getroot()
                for obj in root.findall('object'):
                    bnd = obj.find('bndbox')
                    if bnd is not None:
                        xmin = float(bnd.find('xmin').text)
                        ymin = float(bnd.find('ymin').text)
                        xmax = float(bnd.find('xmax').text)
                        ymax = float(bnd.find('ymax').text)

                        x1 = max(0.0, min(xmin, float(w_img)))
                        y1 = max(0.0, min(ymin, float(h_img)))
                        x2 = max(0.0, min(xmax, float(w_img)))
                        y2 = max(0.0, min(ymax, float(h_img)))

                        bw = x2 - x1
                        bh = y2 - y1
                        if bw > 1.0 and bh > 1.0:
                            xc = (x1 + bw / 2.0) * dw
                            yc = (y1 + bh / 2.0) * dh
                            nw = bw * dw
                            nh = bh * dh
                            yolo_lines.append(f"0 {xc:.6f} {yc:.6f} {nw:.6f} {nh:.6f}\n")

                            manifest['bbox_widths'].append(round(bw, 1))
                            manifest['bbox_heights'].append(round(bh, 1))
                            manifest['bbox_areas'].append(round(bw * bh, 1))
            except Exception as e:
                print(f"Error parsing XML {xml_path}: {e}")

        # Write label file
        out_label = out_labels_dir / f"{img_path.stem}.txt"
        with open(out_label, 'w', encoding='utf-8') as f:
            f.writelines(yolo_lines)

        if len(yolo_lines) > 0:
            manifest['images_with_persons'] += 1
            manifest['total_person_boxes'] += len(yolo_lines)
        else:
            manifest['empty_background_images'] += 1

    import numpy as np
    if manifest['bbox_widths']:
        w_arr = np.array(manifest['bbox_widths'])
        h_arr = np.array(manifest['bbox_heights'])
        a_arr = np.array(manifest['bbox_areas'])
        manifest['bbox_summary'] = {
            'width_mean': float(np.mean(w_arr)),
            'width_median': float(np.median(w_arr)),
            'height_mean': float(np.mean(h_arr)),
            'height_median': float(np.median(h_arr)),
            'area_mean': float(np.mean(a_arr)),
            'area_median': float(np.median(a_arr)),
            'small_objects_area_pct': float(np.mean(a_arr < (32 * 32)) * 100.0)
        }
    del manifest['bbox_widths']
    del manifest['bbox_heights']
    del manifest['bbox_areas']

    manifest_file = out_dir / 'heridal_benchmark_manifest.json'
    with open(manifest_file, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    print(f"HERIDAL benchmark conversion completed! Saved to: {manifest_file}")
    return manifest

if __name__ == '__main__':
    workspace = Path('/home/adi/workspace/hackathons/sih-26/disaster_aid_model')
    raw = workspace / 'datasets' / 'raw' / 'heridal'
    external = workspace / 'datasets' / 'external' / 'heridal_person'
    convert_heridal_benchmark(raw, external)
