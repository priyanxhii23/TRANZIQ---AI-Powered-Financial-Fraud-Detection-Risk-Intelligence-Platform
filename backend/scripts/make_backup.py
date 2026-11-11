"""Create and verify a ZIP backup of the TRANZIQ source code.

    python backend/scripts/make_backup.py                  # source only
    python backend/scripts/make_backup.py --with-artifacts # + trained models, reports, demo DB

Excludes .venv, node_modules, build output, caches and the 144 MB dataset.
The archive is written to backups/ and verified (CRC check + file count +
required files present) before the script reports success.
"""
import argparse
import hashlib
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCLUDE_DIRS = {".venv", "venv", "node_modules", "dist", "__pycache__", ".pytest_cache", ".git", "backups", ".idea"}
EXCLUDE_SUFFIX = {".pyc", ".zip", ".part"}
REQUIRED = ["README.md", "requirements.txt", "run_project.bat", "backend/app/main.py", "backend/ml/train.py",
            "frontend/package.json", "frontend/src/App.tsx"]


def wanted(p: Path, with_artifacts: bool) -> bool:
    rel = p.relative_to(ROOT)
    if any(part in EXCLUDE_DIRS for part in rel.parts) or p.suffix in EXCLUDE_SUFFIX:
        return False
    if rel.parts[:2] == ("data", "raw") and p.suffix == ".csv":
        return False  # never bundle the large Kaggle CSV
    if not with_artifacts and (rel.parts[0] == "artifacts" or p.suffix == ".db" or ".db-" in p.name):
        return False
    return p.is_file() and p.name != ".env"  # never bundle local secrets/config


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-artifacts", action="store_true")
    args = ap.parse_args()
    files = sorted(p for p in ROOT.rglob("*") if wanted(p, args.with_artifacts))
    out_dir = ROOT / "backups"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"tranziq_backup_{datetime.now():%Y%m%d_%H%M%S}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, Path("tranziq") / f.relative_to(ROOT))

    # ---- verification ----
    with zipfile.ZipFile(out) as z:
        bad = z.testzip()
        names = set(z.namelist())
    missing = [r for r in REQUIRED if f"tranziq/{r}" not in names]
    if bad or missing or len(names) != len(files):
        sys.exit(f"[TRANZIQ] Backup verification FAILED (corrupt={bad}, missing={missing})")
    sha = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"[TRANZIQ] Backup OK: {out}\n          files={len(names)} size={out.stat().st_size / 1e6:.2f} MB sha256={sha[:16]}...")


if __name__ == "__main__":
    main()
