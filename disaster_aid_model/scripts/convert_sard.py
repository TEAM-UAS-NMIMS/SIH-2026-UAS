#!/usr/bin/env python3
"""
GridZERO Dataset Preprocessing: SARD -> YOLO Person
Converts SARD human/casualty annotations to unified class 0 (person).
Enforces STRICT sequence-level train/val splitting to eliminate temporal leakage.
Preserves raw data untouched and saves split_manifest.json.
"""

import os
import sys
import json
import re
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image

HUMAN_CLASSES = {
    'person', 'human', 'pedestrian', 'people',
    'standing', 'walking', 'sitting', 'lying', 'lying_down', 'crawling', 'casualty'
}

def extract_sequence_id(filename_or_path: Path) -> str:
    """
    Extracts video sequence identifier from filename or parent folder.
    Examples:
      - 'seq01_frame_0042.jpg' -> 'seq01'
      - 'video_03/frame_123.jpg' -> 'video_03'
      - 'sard_clip5_0012.jpg' -> 'sard_clip5'
    """
    # Check parent folder name first
    parent_name = filename_or_path.parent.name
    if re.search(r'(seq|video|clip|run|flight)[\-_]?\d+', parent_name, re.I):
        return parent_name

    stem = filename_or_path.stem
    # Match sequence prefix pattern
    match = re.match(r'^(seq[\-_]?\d+|video[\-_]?\d+|clip[\-_]?\d+|[A-Za-z]+[\-_]?\d+)', stem, re.I)
    if match:
        return match.group(1).lower()

    # Fallback to leading numeric or underscore chunk
    parts = re.split(r'[_\-]', stem)
    if len(parts) > 1:
        return parts[0].lower()
    return 'seq_default'

def convert_sard(raw_dir: Path, out_dir: Path, val_seq_ratio: float = 0.2):
    print(f"Scanning raw SARD directory: {raw_dir}...")

    # Find all image files
    image_exts = {'.jpg', '.jpeg', '.png', '.bmp'}
    raw_images = [p for p in raw_dir.rglob('*') if p.suffix.lower() in image_exts]

    if not raw_images:
        print(f"Warning: No raw images found in {raw_dir}. Script is ready to run once data archive is placed.")
        # Create empty template manifest to document structure
        manifest = {
            'status': 'Awaiting raw data extraction in datasets/raw/sard',
            'train_sequences': [],
            'validation_sequences': [],
            'train_images': 0,
            'val_images': 0,
            'train_person_boxes': 0,
            'val_person_boxes': 0
        }
        out_dir.mkdir(parents=True, exist_ok=True)
        with open(out_dir / 'split_manifest.json', 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2)
        return manifest

    print(f"Found {len(raw_images)} raw SARD images. Grouping by sequence...")

    # Group by sequence
    seq_groups = {}
    for img_path in raw_images:
        seq_id = extract_sequence_id(img_path)
        if seq_id not in seq_groups:
            seq_groups[seq_id] = []
        seq_groups[seq_id].append(img_path)

    sorted_seqs = sorted(seq_groups.keys())
    print(f"Detected {len(sorted_seqs)} unique sequences: {sorted_seqs}")

    # Sequence-level split (deterministic)
    num_val_seqs = max(1, int(round(len(sorted_seqs) * val_seq_ratio)))
    # Pick every Nth sequence or tail sequence to preserve diversity
    val_seqs = set(sorted_seqs[-num_val_seqs:])
    train_seqs = set(sorted_seqs[:-num_val_seqs])
    if not train_seqs:
        train_seqs = {sorted_seqs[0]}
        val_seqs = set(sorted_seqs[1:]) if len(sorted_seqs) > 1 else set()

    print(f"Train sequences ({len(train_seqs)}): {sorted(list(train_seqs))}")
    print(f"Validation sequences ({len(val_seqs)}): {sorted(list(val_seqs))}")

    manifest = {
        'train_sequences': sorted(list(train_seqs)),
        'validation_sequences': sorted(list(val_seqs)),
        'train_images': 0,
        'val_images': 0,
        'train_person_boxes': 0,
        'val_person_boxes': 0,
        'sequence_details': {}
    }

    for split_name in ['train', 'val']:
        (out_dir / 'images' / split_name).mkdir(parents=True, exist_ok=True)
        (out_dir / 'labels' / split_name).mkdir(parents=True, exist_ok=True)

    for seq_id, img_list in seq_groups.items():
        split_name = 'val' if seq_id in val_seqs else 'train'
        out_images_dir = out_dir / 'images' / split_name
        out_labels_dir = out_dir / 'labels' / split_name

        seq_box_count = 0
        for img_path in img_list:
            # Create symlink in processed directory
            out_img_link = out_images_dir / img_path.name
            if not out_img_link.exists():
                os.symlink(img_path.resolve(), out_img_link)

            with Image.open(img_path) as img:
                w_img, h_img = img.size

            dw = 1.0 / w_img
            dh = 1.0 / h_img

            yolo_lines = []

            # Check for XML annotation (Pascal VOC)
            xml_path = img_path.with_suffix('.xml')
            if not xml_path.exists():
                # Check parent or sibling annotations folder
                candidate = img_path.parent.parent / 'annotations' / f"{img_path.stem}.xml"
                if candidate.exists():
                    xml_path = candidate

            txt_path = img_path.with_suffix('.txt')
            if not txt_path.exists():
                candidate = img_path.parent.parent / 'labels' / f"{img_path.stem}.txt"
                if candidate.exists():
                    txt_path = candidate

            if xml_path.exists():
                try:
                    tree = ET.parse(xml_path)
                    root = tree.getroot()
                    for obj in root.findall('object'):
                        name = obj.find('name').text.strip().lower()
                        if name in HUMAN_CLASSES or 'person' in name or 'human' in name:
                            bnd = obj.find('bndbox')
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
                except Exception as e:
                    print(f"Error parsing XML {xml_path}: {e}")

            elif txt_path.exists():
                with open(txt_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        parts = line.strip().split()
                        if len(parts) >= 5:
                            # Map any class index in SARD person single/multi-class to 0
                            xc, yc, nw, nh = map(float, parts[1:5])
                            yolo_lines.append(f"0 {xc:.6f} {yc:.6f} {nw:.6f} {nh:.6f}\n")

            # Write label file (even if empty)
            out_label = out_labels_dir / f"{img_path.stem}.txt"
            with open(out_label, 'w', encoding='utf-8') as f:
                f.writelines(yolo_lines)

            seq_box_count += len(yolo_lines)
            if split_name == 'train':
                manifest['train_images'] += 1
                manifest['train_person_boxes'] += len(yolo_lines)
            else:
                manifest['val_images'] += 1
                manifest['val_person_boxes'] += len(yolo_lines)

        manifest['sequence_details'][seq_id] = {
            'split': split_name,
            'image_count': len(img_list),
            'person_boxes': seq_box_count
        }

    manifest_file = out_dir / 'split_manifest.json'
    with open(manifest_file, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    print(f"SARD conversion completed! Split manifest saved to: {manifest_file}")
    return manifest

if __name__ == '__main__':
    workspace = Path('/home/adi/workspace/hackathons/sih-26/disaster_aid_model')
    raw = workspace / 'datasets' / 'raw' / 'sard'
    processed = workspace / 'datasets' / 'processed' / 'sard_person'
    convert_sard(raw, processed)
