#!/usr/bin/env python3
"""Reuse take-controlish packaging with only the injected personal voice/key.

Dry-run is free. Paid rendering additionally requires a root-authored authorization
record and an exclusive reservation. No Claude files or skill sources are changed.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
VOICE = "yBC2mYQTcyyzcXPWTrFD"
MODEL = "eleven_flash_v2_5"
MAX_USD = 0.55
CONSERVATIVE_USD_PER_1000_CHAR = 0.30
REPORTS = ROOT / "sources" / "reports"
sys.dont_write_bytecode = True

def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()

def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default=str(REPORTS / "epic-chess-video-spec.json"))
    ap.add_argument("--out", default=str(ROOT / "docs" / "reports" / "epic-chess-take-control.mp4"))
    ap.add_argument("--execute-paid", action="store_true")
    args = ap.parse_args()
    spec_path = Path(args.spec).resolve()
    raw = json.loads(spec_path.read_text(encoding="utf-8"))
    narration = [scene.get("narration", "").strip() for scene in raw["scenes"]]
    assert [scene["kind"] for scene in raw["scenes"]] == ["title", "objective", "phases", "judge", "contract", "status"]
    assert len(narration) == 6 and all(narration)
    chars = sum(map(len, narration))
    reserve = math.ceil(chars * CONSERVATIVE_USD_PER_1000_CHAR / 1000 * 1_000_000) / 1_000_000
    if reserve > MAX_USD:
        raise SystemExit(f"Report narration exceeds personal budget: {chars} characters, reservation USD{reserve:.6f} > USD{MAX_USD:.2f}")
    if not args.execute_paid:
        print(json.dumps({"mode": "FREE_DRY_RUN", "characters": chars, "words": sum(len(text.split()) for text in narration), "reservationUSD": reserve, "ceilingUSD": MAX_USD, "voiceId": VOICE, "model": MODEL}))
        return
    authorization = json.loads((REPORTS / "render-authorization.json").read_text(encoding="utf-8"))
    if authorization.get("approvedBy") != "root" or authorization.get("ready") is not True or authorization.get("ceilingUSD") != MAX_USD:
        raise SystemExit("Root voice/deployment readiness authorization missing; no paid request made")
    if not os.environ.get("ELEVENLABS_API_KEY"):
        raise SystemExit("Personal ELEVENLABS_API_KEY must be injected in the process; no fallback credential search")
    skill = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "skills" / "take-controlish"
    package_path = skill / "scripts" / "package.py"
    if not (skill / "remotion" / "node_modules").is_dir():
        raise SystemExit("Existing Remotion dependencies missing; no automatic installation")
    for executable in ("ffmpeg", "ffprobe", "node", "npx"):
        if not shutil.which(executable):
            raise SystemExit(f"Required executable missing: {executable}")
    REPORTS.mkdir(parents=True, exist_ok=True)
    reservation = REPORTS / "report-reservation.json"
    with reservation.open("x", encoding="utf-8") as handle:
        json.dump({"startedAt": stamp(), "maximumUSD": reserve, "ceilingUSD": MAX_USD, "characters": chars, "personalOnly": True, "specSha256": hashlib.sha256(spec_path.read_bytes()).hexdigest(), "automaticRetry": False}, handle, indent=2)
    module_spec = importlib.util.spec_from_file_location("take_control_package", package_path)
    package = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(package)
    package.resolve_key = lambda: os.environ["ELEVENLABS_API_KEY"].strip()
    package.resolve_voice = lambda: (VOICE, MODEL)
    spec = package.load_spec(spec_path)
    spec = package.resolve_scenes(spec, True, package.resolve_key())
    audio_dir = REPORTS / "audio"
    audio_dir.mkdir(exist_ok=True)
    for audio in package.PUBLIC.glob("vo-*.mp3"):
        shutil.copy2(audio, audio_dir / audio.name)
    total_frames = sum(scene["frames"] for scene in spec["scenes"])
    # The six scene timings are measured from actual narration. Only quiet tail
    # time is extended if speech is brisk; no speed changes or truncated speech.
    if total_frames < 90 * package.FPS:
        spec["scenes"][-1]["frames"] += 90 * package.FPS - total_frames
    if sum(scene["frames"] for scene in spec["scenes"]) > 150 * package.FPS:
        raise SystemExit("Measured narration exceeds 150 seconds; paid audio retained, no automatic retry")
    spec = package.install_bgm(spec, "tech")
    if spec.get("bgm") != "bgm-tech.mp3":
        raise SystemExit("Required existing tech music missing; no silent substitution")
    spec = package.install_screens(spec)
    output = Path(args.out).resolve()
    package.render(spec, output)
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(output)], text=True))
    seconds = float(probe["format"]["duration"])
    if not 90 <= seconds <= 150 or not any(s["codec_type"] == "audio" for s in probe["streams"]):
        raise SystemExit("Rendered video failed duration/audio validation")
    write_json(REPORTS / "video-render.json", {"renderedAt": stamp(), "videoPath": output.relative_to(ROOT).as_posix(), "videoSha256": hashlib.sha256(output.read_bytes()).hexdigest(), "durationSeconds": seconds, "voiceId": VOICE, "model": MODEL, "voiced": True, "sceneCount": 6, "bgm": "tech", "characters": chars, "reservedUSD": reserve, "personalOnly": True, "pipeline": "Existing Codex take-controlish package.py reused without source changes", "opened": False})
    write_json(REPORTS / "resolved-video-spec.json", spec)
    print(json.dumps({"result": "PERSONAL_VIDEO_RENDERED", "seconds": seconds, "sceneCount": 6, "reservedUSD": reserve, "opened": False}))

if __name__ == "__main__":
    main()
