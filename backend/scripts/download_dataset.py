"""Download the Kaggle Credit Card Fraud dataset (creditcard.csv, ~144 MB).

The official page is https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud
(requires a free Kaggle login). For convenience this script fetches the
identical public copy used in the TensorFlow documentation. If the download
fails, download manually from Kaggle and place the file at
data/raw/creditcard.csv.
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml import config  # noqa: E402

EXPECTED_ROWS = 284_807


def main() -> None:
    dest = config.RAW_DATA_PATH
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        print(f"[TRANZIQ] Dataset already present at {dest}")
    else:
        print(f"[TRANZIQ] Downloading {config.DATASET_MIRROR_URL}\n          -> {dest}")
        tmp = dest.with_suffix(".part")

        def progress(blocks, bs, total):
            if total > 0:
                pct = min(100, blocks * bs * 100 // total)
                print(f"\r          {pct:3d}%", end="", flush=True)

        urllib.request.urlretrieve(config.DATASET_MIRROR_URL, tmp, reporthook=progress)
        tmp.replace(dest)
        print()
    with open(dest, "rb") as fh:
        rows = sum(1 for _ in fh) - 1
    sha = hashlib.sha256(dest.read_bytes()).hexdigest()
    print(f"[TRANZIQ] Rows: {rows:,} (expected {EXPECTED_ROWS:,})  sha256: {sha[:16]}...")
    if rows != EXPECTED_ROWS:
        print("[TRANZIQ] WARNING: unexpected row count - is this the right file?")


if __name__ == "__main__":
    main()
