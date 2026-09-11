#!/usr/bin/env python3
"""
GridZERO Phase 0.10A: D-AID v1 Demo Video Inference Runner
Processes three aerial disaster videos with D-AID v1 (YOLOv8n VisDrone baseline).
Videos: earthquake.mp4, flood_navigation.mp4, ruins_navigation.mp4
Outputs annotated videos, detections JSON, summary metrics, and qualitative frame captures.
"""

import os
import sys
import time
import json
import subprocess
import argparse
from pathlib import Path
import cv2
import numpy as np
import torch
from ultralytics import YOLO

def process_video(video_path: Path, model: YOLO, output_dir: Path, conf_thresh=0.25, imgsz=640, device=0, show=False, no_save=False):
    video_name = video_path.stem
    print(f"\n==================================================")
    print(f"Processing Video: {video_path.name}")
    print(f"Output Directory: {output_dir}")
    print(f"Live Preview (--show): {'Enabled' if show else 'Disabled'}")
    print(f"Save Video Output: {'Disabled (--no-save)' if no_save else 'Enabled'}")
    print(f"==================================================")

    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration_s = total_frames / fps if fps > 0 else 0.0

    print(f"Properties: {width}x{height} | {fps:.2f} FPS | {total_frames} frames | {duration_s:.2f}s")

    # Temporary intermediate raw output path before ffmpeg remux
    raw_annotated_path = output_dir / "annotated_raw.mp4"
    final_annotated_path = output_dir / "annotated.mp4"

    out = None
    if not no_save:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(str(raw_annotated_path), fourcc, fps, (width, height))

    detections_data = []
    frame_det_counts = []
    all_confidences = []
    all_box_sizes = []
    frame_inference_times = []

    # Candidates for qualitative captures:
    # (frame_idx, raw_frame, annotated_frame, metadata)
    max_conf_candidate = None   # (conf, frame_idx, raw, ann, det_info)
    median_conf_candidate = None # will select after run
    weak_conf_candidate = None  # min conf candidate
    empty_candidate = None      # candidate with 0 detections in middle of video
    multi_person_candidate = None

    t0_video = time.time()
    frame_idx = 0

    win_name = f"D-AID v1 Preview: {video_path.name} (Press 'q' to stop)"
    show_gui = False
    if show:
        try:
            cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
            cv2.resizeWindow(win_name, 1280, 720)
            show_gui = True
        except cv2.error as e:
            print("\n" + "!" * 65)
            print("[WARNING] Live preview window unavailable:")
            print("OpenCV is installed as a headless build (no GTK/Qt/X11 GUI support).")
            print("To enable GUI windows on Linux, run:")
            print("  pip uninstall -y opencv-python-headless && pip install opencv-python")
            print("Proceeding with full GPU inference in headless mode (video will be saved).")
            print("!" * 65 + "\n")
            show_gui = False

    print("Beginning frame-by-frame inference on GPU...")

    # We will buffer sample frames for qualitative selection
    saved_candidates = {}

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        raw_frame = frame.copy()
        t_start = time.perf_counter()

        # Run model prediction on GPU
        # classes=[0] for person only, conf=conf_thresh, imgsz=imgsz
        results = model.predict(
            source=frame,
            imgsz=imgsz,
            conf=conf_thresh,
            classes=[0],
            device=device,
            verbose=False
        )[0]

        t_infer = time.perf_counter() - t_start
        frame_inference_times.append(t_infer)

        frame_dets = []
        if results.boxes is not None and len(results.boxes) > 0:
            xyxy = results.boxes.xyxy.cpu().numpy()
            confs = results.boxes.conf.cpu().numpy()
            for b, c in zip(xyxy, confs):
                x1, y1, x2, y2 = float(b[0]), float(b[1]), float(b[2]), float(b[3])
                bw = max(0.0, x2 - x1)
                bh = max(0.0, y2 - y1)
                side = np.sqrt(bw * bh)
                conf_val = float(c)
                all_confidences.append(conf_val)
                all_box_sizes.append(side)

                frame_dets.append({
                    "box_xyxy": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                    "box_normalized": [
                        round((x1 + bw/2) / width, 5),
                        round((y1 + bh/2) / height, 5),
                        round(bw / width, 5),
                        round(bh / height, 5)
                    ],
                    "width_px": round(bw, 1),
                    "height_px": round(bh, 1),
                    "sqrt_area_px": round(side, 1),
                    "confidence": round(conf_val, 4)
                })

        num_dets = len(frame_dets)
        frame_det_counts.append(num_dets)

        # Drawing HUD annotations
        ann_frame = frame.copy()

        # Draw bounding boxes
        for det in frame_dets:
            bx = det["box_xyxy"]
            c_val = det["confidence"]
            x1, y1, x2, y2 = int(bx[0]), int(bx[1]), int(bx[2]), int(bx[3])

            # Color gradient based on confidence: Yellow (low) to Cyan/Bright Green (high)
            color = (0, int(255 * min(1.0, c_val / 0.8)), int(255 * (1.0 - c_val / 1.0)))
            cv2.rectangle(ann_frame, (x1, y1), (x2, y2), (0, 230, 255), 2)

            # Label banner
            label = f"person {c_val:.2f}"
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            cv2.rectangle(ann_frame, (x1, max(0, y1 - lh - 6)), (x1 + lw + 6, max(lh + 6, y1)), (0, 230, 255), -1)
            cv2.putText(ann_frame, label, (x1 + 3, max(lh + 2, y1 - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

        # HUD Top Banner
        hud_h = 50
        cv2.rectangle(ann_frame, (0, 0), (width, hud_h), (20, 20, 20), -1)
        cv2.line(ann_frame, (0, hud_h), (width, hud_h), (0, 230, 255), 2)

        current_time_s = frame_idx / fps if fps > 0 else 0.0
        hud_text_left = f"GridZERO | D-AID v1 (YOLOv8n VisDrone) | {video_name}.mp4"
        hud_text_mid = f"Frame {frame_idx:04d}/{total_frames:04d} ({current_time_s:05.1f}s)"
        hud_text_right = f"Persons: {num_dets:02d}"

        cv2.putText(ann_frame, hud_text_left, (15, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 2)
        cv2.putText(ann_frame, hud_text_mid, (width // 2 - 140, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        status_color = (0, 255, 0) if num_dets > 0 else (120, 120, 120)
        cv2.putText(ann_frame, hud_text_right, (width - 200, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, status_color, 2)

        if out is not None:
            out.write(ann_frame)

        # Live preview display if --show is enabled and GUI supported
        if show_gui:
            try:
                cv2.imshow(win_name, ann_frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    print(f"\n[Preview] 'q' key pressed by user on frame {frame_idx}/{total_frames}. Stopping early...")
                    break
            except cv2.error:
                show_gui = False

        # Record detections
        detections_data.append({
            "frame_idx": frame_idx,
            "timestamp_seconds": round(current_time_s, 3),
            "person_count": num_dets,
            "detections": frame_dets
        })

        # Track qualitative candidates
        if num_dets > 0:
            max_c_frame = max(d["confidence"] for d in frame_dets)
            min_c_frame = min(d["confidence"] for d in frame_dets)

            if max_conf_candidate is None or max_c_frame > max_conf_candidate["max_conf"]:
                max_conf_candidate = {
                    "max_conf": max_c_frame,
                    "frame_idx": frame_idx,
                    "raw": raw_frame.copy(),
                    "ann": ann_frame.copy(),
                    "num_dets": num_dets,
                    "conf": max_c_frame
                }

            if weak_conf_candidate is None or min_c_frame < weak_conf_candidate["min_conf"]:
                weak_conf_candidate = {
                    "min_conf": min_c_frame,
                    "frame_idx": frame_idx,
                    "raw": raw_frame.copy(),
                    "ann": ann_frame.copy(),
                    "num_dets": num_dets,
                    "conf": min_c_frame
                }

            if multi_person_candidate is None or num_dets > multi_person_candidate["num_dets"]:
                multi_person_candidate = {
                    "frame_idx": frame_idx,
                    "raw": raw_frame.copy(),
                    "ann": ann_frame.copy(),
                    "num_dets": num_dets,
                    "conf": max_c_frame
                }

            # Buffer sample frames for median candidate selection later
            if frame_idx % 25 == 0:
                saved_candidates[frame_idx] = (raw_frame.copy(), ann_frame.copy(), frame_dets)
        else:
            # 0 detections candidate (pick one near 25% or 50% of the video)
            if empty_candidate is None or abs(frame_idx - total_frames // 2) < abs(empty_candidate["frame_idx"] - total_frames // 2):
                empty_candidate = {
                    "frame_idx": frame_idx,
                    "raw": raw_frame.copy(),
                    "ann": ann_frame.copy(),
                    "num_dets": 0
                }

        frame_idx += 1
        if frame_idx % 200 == 0 or frame_idx == total_frames:
            elapsed = time.time() - t0_video
            fps_proc = frame_idx / elapsed
            print(f"  Frame {frame_idx}/{total_frames} ({frame_idx/total_frames*100:5.1f}%) | Processing Speed: {fps_proc:5.1f} FPS | Persons so far: {len(all_confidences)}")

    cap.release()
    if out is not None:
        out.release()
    if show_gui:
        try:
            cv2.destroyAllWindows()
        except Exception:
            pass

    if frame_idx == 0:
        print("No frames were processed.")
        if raw_annotated_path.exists():
            raw_annotated_path.unlink()
        return {}
    total_time_s = time.time() - t0_video
    avg_infer_ms = np.mean(frame_inference_times) * 1000.0 if frame_inference_times else 0.0
    overall_fps = frame_idx / total_time_s if total_time_s > 0 else 0.0

    print(f"Inference complete: {frame_idx} frames in {total_time_s:.2f}s ({overall_fps:.1f} FPS)")

    if not no_save:
        # Transcode raw mp4v to H.264 MP4 with ffmpeg for universal compatibility
        print("Transcoding annotated video to standard H.264 MP4 via ffmpeg...")
        try:
            cmd = [
                "ffmpeg", "-y",
                "-i", str(raw_annotated_path),
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "22",
                "-pix_fmt", "yuv420p",
                str(final_annotated_path)
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            if final_annotated_path.exists() and final_annotated_path.stat().st_size > 0:
                raw_annotated_path.unlink()
                print(f"  Final H.264 video saved: {final_annotated_path} ({final_annotated_path.stat().st_size / (1024**2):.2f} MB)")
        except Exception as e:
            print(f"  Warning: ffmpeg transcoding failed ({e}); falling back to raw output.")
            if raw_annotated_path.exists():
                raw_annotated_path.rename(final_annotated_path)

    # Calculate comprehensive metrics
    total_dets = len(all_confidences)
    frames_with_dets = sum(1 for c in frame_det_counts if c > 0)
    detection_coverage_pct = (frames_with_dets / frame_idx * 100.0) if frame_idx > 0 else 0.0

    # Confidence statistics
    mean_conf = float(np.mean(all_confidences)) if all_confidences else 0.0
    median_conf = float(np.median(all_confidences)) if all_confidences else 0.0
    min_conf = float(np.min(all_confidences)) if all_confidences else 0.0
    max_conf = float(np.max(all_confidences)) if all_confidences else 0.0

    # Bins
    bin_25_40 = sum(1 for c in all_confidences if 0.25 <= c < 0.40)
    bin_40_60 = sum(1 for c in all_confidences if 0.40 <= c < 0.60)
    bin_60_80 = sum(1 for c in all_confidences if 0.60 <= c < 0.80)
    bin_80_100 = sum(1 for c in all_confidences if 0.80 <= c <= 1.00)

    # Box size statistics
    mean_size = float(np.mean(all_box_sizes)) if all_box_sizes else 0.0
    median_size = float(np.median(all_box_sizes)) if all_box_sizes else 0.0

    # Temporal stability metrics
    # Frame-to-frame diff variance
    frame_diffs = np.abs(np.diff(frame_det_counts)) if len(frame_det_counts) > 1 else [0]
    jitter_std = float(np.std(frame_diffs)) if len(frame_diffs) > 0 else 0.0
    # Flickering transitions (0 -> >0 or >0 -> 0)
    binary_det = [1 if c > 0 else 0 for c in frame_det_counts]
    flicker_transitions = sum(1 for i in range(len(binary_det)-1) if binary_det[i] != binary_det[i+1])

    # Find typical/median candidate
    if all_confidences and saved_candidates:
        target_med = median_conf
        best_cand = None
        best_diff = 999.0
        for f_idx, (r_img, a_img, dets) in saved_candidates.items():
            f_med = np.median([d["confidence"] for d in dets])
            diff = abs(f_med - target_med)
            if diff < best_diff:
                best_diff = diff
                best_cand = (f_idx, r_img, a_img, dets)
        if best_cand:
            median_conf_candidate = {
                "frame_idx": best_cand[0],
                "raw": best_cand[1],
                "ann": best_cand[2],
                "num_dets": len(best_cand[3]),
                "conf": float(np.median([d["confidence"] for d in best_cand[3]]))
            }

    # Save qualitative image files
    print("\nSaving representative qualitative frame evidence...")
    # A. Strong detection
    if max_conf_candidate:
        f_idx = max_conf_candidate["frame_idx"]
        cv2.imwrite(str(frames_dir / "A_strong_detection_raw.jpg"), max_conf_candidate["raw"])
        cv2.imwrite(str(frames_dir / "A_strong_detection_annotated.jpg"), max_conf_candidate["ann"])
        print(f"  Saved Strong Detection Frame {f_idx} (conf: {max_conf_candidate['conf']:.3f}, dets: {max_conf_candidate['num_dets']})")

    # B. Typical detection
    if median_conf_candidate:
        f_idx = median_conf_candidate["frame_idx"]
        cv2.imwrite(str(frames_dir / "B_typical_detection_raw.jpg"), median_conf_candidate["raw"])
        cv2.imwrite(str(frames_dir / "B_typical_detection_annotated.jpg"), median_conf_candidate["ann"])
        print(f"  Saved Typical Detection Frame {f_idx} (conf: {median_conf_candidate['conf']:.3f}, dets: {median_conf_candidate['num_dets']})")
    elif max_conf_candidate:
        cv2.imwrite(str(frames_dir / "B_typical_detection_raw.jpg"), max_conf_candidate["raw"])
        cv2.imwrite(str(frames_dir / "B_typical_detection_annotated.jpg"), max_conf_candidate["ann"])

    # C. Weak detection
    if weak_conf_candidate:
        f_idx = weak_conf_candidate["frame_idx"]
        cv2.imwrite(str(frames_dir / "C_weak_detection_raw.jpg"), weak_conf_candidate["raw"])
        cv2.imwrite(str(frames_dir / "C_weak_detection_annotated.jpg"), weak_conf_candidate["ann"])
        print(f"  Saved Weak Detection Frame {f_idx} (conf: {weak_conf_candidate['conf']:.3f}, dets: {weak_conf_candidate['num_dets']})")

    # D. Miss / Failure / Empty example
    if empty_candidate:
        f_idx = empty_candidate["frame_idx"]
        cv2.imwrite(str(frames_dir / "D_miss_failure_raw.jpg"), empty_candidate["raw"])
        cv2.imwrite(str(frames_dir / "D_miss_failure_annotated.jpg"), empty_candidate["ann"])
        print(f"  Saved Miss/Empty Frame {f_idx} (dets: 0)")

    # Save detections JSON
    det_json_path = output_dir / "detections.json"
    with open(det_json_path, "w") as f:
        json.dump(detections_data, f, indent=2)
    print(f"Detections JSON saved: {det_json_path} ({len(detections_data)} frames)")

    # Summary payload
    summary_payload = {
        "video_name": video_name,
        "video_file": video_path.name,
        "resolution": f"{width}x{height}",
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "duration_seconds": round(duration_s, 2),
        "total_frames": total_frames,
        "frames_processed": frame_idx,
        "total_inference_time_seconds": round(total_time_s, 2),
        "avg_inference_time_per_frame_ms": round(avg_infer_ms, 2),
        "processing_fps": round(overall_fps, 2),
        "total_person_detections": total_dets,
        "avg_person_detections_per_frame": round(float(np.mean(frame_det_counts)), 3) if frame_det_counts else 0.0,
        "median_person_detections_per_frame": float(np.median(frame_det_counts)) if frame_det_counts else 0.0,
        "max_person_detections_per_frame": int(np.max(frame_det_counts)) if frame_det_counts else 0,
        "frames_with_at_least_one_person": frames_with_dets,
        "detection_coverage_pct": round(detection_coverage_pct, 2),
        "confidence_statistics": {
            "mean": round(mean_conf, 4),
            "median": round(median_conf, 4),
            "min": round(min_conf, 4),
            "max": round(max_conf, 4)
        },
        "confidence_distribution": {
            "range_0_25_to_0_40": bin_25_40,
            "range_0_40_to_0_60": bin_40_60,
            "range_0_60_to_0_80": bin_60_80,
            "range_0_80_to_1_00": bin_80_100
        },
        "bounding_box_size_statistics_sqrt_area_px": {
            "mean": round(mean_size, 2),
            "median": round(median_size, 2)
        },
        "temporal_stability": {
            "frame_to_frame_jitter_std": round(jitter_std, 3),
            "flicker_transitions": flicker_transitions
        },
        "annotated_video_path": str(final_annotated_path) if not no_save else None
    }

    summary_json_path = output_dir / "summary.json"
    with open(summary_json_path, "w") as f:
        json.dump(summary_payload, f, indent=2)
    print(f"Summary JSON saved: {summary_json_path}")

    return summary_payload

def main():
    parser = argparse.ArgumentParser(description="GridZERO Phase 0.10A: D-AID V1 Demo Video Inference Runner")
    parser.add_argument("--video", type=str, default=None, help="Specific video to run (e.g. videos/earthquake.mp4 or earthquake)")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold (default: 0.25)")
    parser.add_argument("--device", type=str, default="0", help="Device index (default: '0' for GPU 0, or 'cpu')")
    parser.add_argument("--show", action="store_true", help="Display live annotated video preview in an OpenCV window")
    parser.add_argument("--no-save", action="store_true", help="Do not write or save the annotated output video to disk")
    args = parser.parse_args()

    workspace = Path("/home/adi/workspace/hackathons/sih-26/disaster_aid_model")
    video_dir = workspace / "videos"
    model_path = workspace / "models" / "d_aid_v1" / "best.pt"
    base_output_dir = workspace / "runs" / "demo_inference" / "d_aid_v1"

    print("==================================================")
    print("PHASE 0.10A: D-AID V1 DEMO VIDEO INFERENCE")
    print(f"Model Checkpoint: {model_path}")
    print("==================================================")

    if not model_path.exists():
        print(f"ERROR: Model checkpoint not found: {model_path}")
        sys.exit(1)

    device_str = args.device
    if device_str != "cpu" and not torch.cuda.is_available():
        print("ERROR: CUDA GPU is not available!")
        sys.exit(1)

    if device_str != "cpu":
        device_idx = int(device_str) if device_str.isdigit() else 0
        device_name = torch.cuda.get_device_name(device_idx)
        print(f"CUDA Device: {device_name} (GPU {device_idx})")
        target_device = device_idx
    else:
        print("Using CPU")
        target_device = "cpu"

    print(f"Loading D-AID v1 model...")
    model = YOLO(str(model_path))

    if args.video:
        candidate = Path(args.video)
        if candidate.exists():
            target_p = candidate
        elif (video_dir / args.video).exists():
            target_p = video_dir / args.video
        elif (video_dir / f"{args.video}.mp4").exists():
            target_p = video_dir / f"{args.video}.mp4"
        elif (workspace / args.video).exists():
            target_p = workspace / args.video
        else:
            print(f"ERROR: Video file not found: {args.video}")
            sys.exit(1)
        video_files = [target_p]
    else:
        video_files = [
            video_dir / "earthquake.mp4",
            video_dir / "flood_navigation.mp4",
            video_dir / "ruins_navigation.mp4"
        ]

    try:
        all_summaries = {}
        for vp in video_files:
            if not vp.exists():
                print(f"ERROR: Video not found: {vp}")
                sys.exit(1)
            video_out_dir = base_output_dir / vp.stem
            summary = process_video(vp, model, video_out_dir, conf_thresh=args.conf, imgsz=640, device=target_device, show=args.show, no_save=args.no_save)
            all_summaries[vp.stem] = summary

        # Load existing summaries if available to merge
        combined_json_path = base_output_dir / "demo_inference_results.json"
        workspace_json_path = workspace / "demo_inference_results.json"
        existing_summaries = {}
        if combined_json_path.exists():
            try:
                with open(combined_json_path, "r") as f:
                    existing_summaries = json.load(f)
            except Exception:
                existing_summaries = {}

        existing_summaries.update(all_summaries)

        with open(combined_json_path, "w") as f:
            json.dump(existing_summaries, f, indent=2)
        print(f"\nUpdated video summaries saved to: {combined_json_path}")

        with open(workspace_json_path, "w") as f:
            json.dump(existing_summaries, f, indent=2)

        print("\nPhase 0.10A inference processing complete.")
    except KeyboardInterrupt:
        print("\n[Terminated] Inference process interrupted by user (Ctrl+C). Exiting cleanly.")
        try:
            cv2.destroyAllWindows()
        except Exception:
            pass
        sys.exit(0)

if __name__ == "__main__":
    main()
