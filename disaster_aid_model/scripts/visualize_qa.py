#!/usr/bin/env python3
"""
GridZERO Visual QA Generator
Draws YOLO normalized bounding boxes on sampled converted images
and outputs annotated QA images to verify bounding-box alignment and coordinate sanity.
"""

import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def generate_visual_qa(dataset_dir: Path, out_qa_dir: Path, num_samples: int = 5):
    out_qa_dir.mkdir(parents=True, exist_ok=True)
    images_dir = dataset_dir / 'images' / 'val'
    labels_dir = dataset_dir / 'labels' / 'val'

    # Find non-empty label files
    candidates = [p for p in labels_dir.glob('*.txt') if p.stat().st_size > 50]
    random.seed(42)
    sample_lbls = random.sample(candidates, min(num_samples, len(candidates)))

    print(f"Generating {len(sample_lbls)} visual QA samples to {out_qa_dir}...")

    for lbl_path in sample_lbls:
        img_path = images_dir / f"{lbl_path.stem}.jpg"
        if not img_path.exists():
            continue

        with Image.open(img_path) as img:
            draw_img = img.convert('RGB')
            w_px, h_px = draw_img.size
            draw = ImageDraw.Draw(draw_img)

            with open(lbl_path, 'r') as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) == 5:
                        cls_id, xc, yc, w, h = map(float, parts)
                        x1 = (xc - w / 2.0) * w_px
                        y1 = (yc - h / 2.0) * h_px
                        x2 = (xc + w / 2.0) * w_px
                        y2 = (yc + h / 2.0) * h_px

                        # Draw bounding box in bright green
                        draw.rectangle([x1, y1, x2, y2], outline=(0, 255, 0), width=2)

            out_sample_path = out_qa_dir / f"qa_annotated_{img_path.name}"
            draw_img.save(out_sample_path, quality=90)
            print(f"  Saved QA image: {out_sample_path.name} ({w_px}x{h_px})")

if __name__ == '__main__':
    workspace = Path('/home/adi/workspace/hackathons/sih-26/disaster_aid_model')
    visdrone_dir = workspace / 'datasets' / 'processed' / 'visdrone_person'
    qa_dir = visdrone_dir / 'qa_samples'
    generate_visual_qa(visdrone_dir, qa_dir, num_samples=3)
