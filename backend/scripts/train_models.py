"""Train all TRANZIQ models.

Usage (from the repository root, with the virtual environment active):
    python backend/scripts/train_models.py            # full training (~5-10 min)
    python backend/scripts/train_models.py --quick    # fast smoke run on 10% of legit rows
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ml.data_loader import DatasetNotFoundError  # noqa: E402
from ml.train import train  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train TRANZIQ fraud models")
    parser.add_argument("--quick", action="store_true", help="use all fraud + 10%% of legitimate rows")
    parser.add_argument("--no-plots", action="store_true", help="skip PNG figures")
    args = parser.parse_args()
    try:
        train(sample_frac=0.1 if args.quick else None, make_plots=not args.no_plots)
    except DatasetNotFoundError as exc:
        print(f"\n[TRANZIQ] {exc}\n")
        sys.exit(1)
