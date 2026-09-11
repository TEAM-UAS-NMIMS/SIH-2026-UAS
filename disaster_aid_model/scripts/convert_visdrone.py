#!/usr/bin/env python3
"""
GridZERO Dataset Preprocessing: VisDrone2019-DET -> YOLO Person
Converts VisDrone pedestrian (1) and people (2) to unified class 0 (person).
Generates clean YOLO-format images and labels in datasets/processed/visdrone_person/
Preserves raw data untouched.
"""

import os
import sys
import json
from pathlib import Path
from PIL import Image

def convert_visdrone(raw_dir: Path, out_dir: Path):
    splits = {
        'train': raw_dir / 'VisDrone2019-DET-train',
        'val': raw_dir / 'VisDrone2019-DET-val'
    }

    stats = {
        'dataset': 'VisDrone2019-DET',
        'splits': {}
    }

    for split_name, source_path in splits.items():
        if not source_path.exists():
            print(f"Error: Source directory {source_path} does not exist!")
            sys.exit(1)

        raw_images_dir = source_path / 'images'
        raw_ann_dir = source_path / 'annotations'

        out_images_dir = out_dir / 'images' / split_name
        out_labels_dir = out_dir / 'labels' / split_name
        out_images_dir.mkdir(parents=True, exist_ok=True)
        out_labels_dir.mkdir(parents=True, exist_ok=True)

        raw_images = sorted(list(raw_images_dir.glob('*.jpg')))
        print(f"Processing VisDrone [{split_name}]: {len(raw_images)} images found...")

        split_stats = {
            'total_images': len(raw_images),
            'images_with_persons': 0,
            'empty_background_images': 0,
            'total_person_boxes': 0,
            'pedestrian_boxes': 0,
            'people_boxes': 0,
            'ignored_boxes_dropped': 0,
            'non_human_boxes_dropped': 0,
            'malformed_lines': 0,
            'resolutions': {},
            'bbox_widths': [],
            'bbox_heights': [],
            'bbox_areas': []
        }

        for img_path in raw_images:
            stem = img_path.stem
            ann_path = raw_ann_dir / f"{stem}.txt"

            # Create symlink for images in processed directory (saves disk space & preserves raw)
            out_img_link = out_images_dir / img_path.name
            if not out_img_link.exists():
                os.symlink(img_path.resolve(), out_img_link)

            # Get image resolution
            with Image.open(img_path) as img:
                w_img, h_img = img.size

            res_key = f"{w_img}x{h_img}"
            split_stats['resolutions'][res_key] = split_stats['resolutions'].get(res_key, 0) + 1

            dw = 1.0 / w_img
            dh = 1.0 / h_img

            yolo_lines = []
            if ann_path.exists():
                with open(ann_path, 'r', encoding='utf-8') as f:
                    for line_num, line in enumerate(f, 1):
                        parts = line.strip().split(',')
                        if len(parts) < 8:
                            # Try space separated if comma didn't split
                            parts = line.strip().split()
                        if len(parts) < 8:
                            split_stats['malformed_lines'] += 1
                            continue

                        try:
                            bbox_left = float(parts[0])
                            bbox_top = float(parts[1])
                            bbox_w = float(parts[2])
                            bbox_h = float(parts[3])
                            score = int(parts[4])
                            category = int(parts[5])
                        except ValueError:
                            split_stats['malformed_lines'] += 1
                            continue

                        # Filter: score must be 1 (not ignored)
                        if score != 1:
                            split_stats['ignored_boxes_dropped'] += 1
                            continue

                        # Filter: category must be 1 (pedestrian) or 2 (people)
                        if category == 1:
                            split_stats['pedestrian_boxes'] += 1
                        elif category == 2:
                            split_stats['people_boxes'] += 1
                        else:
                            split_stats['non_human_boxes_dropped'] += 1
                            continue

                        # Boundary checks & clipping
                        x1 = max(0.0, min(bbox_left, float(w_img)))
                        y1 = max(0.0, min(bbox_top, float(h_img)))
                        x2 = max(0.0, min(bbox_left + bbox_w, float(w_img)))
                        y2 = max(0.0, min(bbox_top + bbox_h, float(h_img)))

                        box_w = x2 - x1
                        box_h = y2 - y1

                        if box_w <= 1.0 or box_h <= 1.0:
                            # degenerate box
                            continue

                        # Convert to normalized YOLO format
                        x_center = (x1 + box_w / 2.0) * dw
                        y_center = (y1 + box_h / 2.0) * dh
                        norm_w = box_w * dw
                        norm_h = box_h * dh

                        # Validate [0, 1]
                        x_center = max(0.0, min(1.0, x_center))
                        y_center = max(0.0, min(1.0, y_center))
                        norm_w = max(0.0, min(1.0, norm_w))
                        norm_h = max(0.0, min(1.0, norm_h))

                        # Class 0: person
                        yolo_lines.append(f"0 {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}\n")

                        split_stats['bbox_widths'].append(round(box_w, 1))
                        split_stats['bbox_heights'].append(round(box_h, 1))
                        split_stats['bbox_areas'].append(round(box_w * box_h, 1))

            # Write label file (even if empty, representing background)
            out_label_path = out_labels_dir / f"{stem}.txt"
            with open(out_label_path, 'w', encoding='utf-8') as f_out:
                f_out.writelines(yolo_lines)

            if len(yolo_lines) > 0:
                split_stats['images_with_persons'] += 1
                split_stats['total_person_boxes'] += len(yolo_lines)
            else:
                split_stats['empty_background_images'] += 1

        # Summary percentiles for bbox sizes
        import numpy as np
        if split_stats['bbox_widths']:
            w_arr = np.array(split_stats['bbox_widths'])
            h_arr = np.array(split_stats['bbox_heights'])
            a_arr = np.array(split_stats['bbox_areas'])
            split_stats['bbox_summary'] = {
                'width_mean': float(np.mean(w_arr)),
                'width_median': float(np.median(w_arr)),
                'height_mean': float(np.mean(h_arr)),
                'height_median': float(np.median(h_arr)),
                'area_mean': float(np.mean(a_arr)),
                'area_median': float(np.median(a_arr)),
                'small_objects_area_pct': float(np.mean(a_arr < (32 * 32)) * 100.0)
            }
        # Remove full lists from json to keep report clean
        del split_stats['bbox_widths']
        del split_stats['bbox_heights']
        del split_stats['bbox_areas']

        split_stats['boxes_per_image_mean'] = round(split_stats['total_person_boxes'] / split_stats['total_images'], 2)
        stats['splits'][split_name] = split_stats

    # Save summary stats
    out_json = out_dir / 'visdrone_person_stats.json'
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(stats, f, indent=2)

    print(f"VisDrone conversion complete! Summary written to {out_json}")
    return stats

if __name__ == '__main__':
    workspace = Path('/home/adi/workspace/hackathons/sih-26/disaster_aid_model')
    raw = workspace / 'datasets' / 'raw' / 'visdrone'
    processed = workspace / 'datasets' / 'processed' / 'visdrone_person'
    convert_visdrone(raw, processed)
