"""(Re)build the demo database.

    python backend/scripts/seed_database.py          # seed only if empty
    python backend/scripts/seed_database.py --reset  # delete ALL stored transactions/alerts, then seed

--reset is destructive for the local demo DB (data/tranziq.db). It never
touches the Kaggle CSV or the trained models.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base, SessionLocal, engine, init_db  # noqa: E402
from app.services.model_registry import registry  # noqa: E402
from app.services.seed_service import seed_if_empty  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="drop and recreate all tables first")
    args = ap.parse_args()
    if not registry.artifacts_present():
        sys.exit("[TRANZIQ] Train the models first: python backend/scripts/train_models.py")
    if args.reset:
        answer = input("This deletes all stored transactions, predictions and alerts. Type 'yes' to continue: ")
        if answer.strip().lower() != "yes":
            sys.exit("Aborted.")
        Base.metadata.drop_all(engine)
    init_db()
    with SessionLocal() as db:
        print("[TRANZIQ]", seed_if_empty(db))
