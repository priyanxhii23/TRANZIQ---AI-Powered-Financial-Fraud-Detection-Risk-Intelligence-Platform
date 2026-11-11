"""Application settings, read from environment variables (see .env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    app_name: str = "TRANZIQ"
    tagline: str = "Intelligence Behind Every Transaction."
    database_url: str = os.getenv("TRANZIQ_DATABASE_URL", f"sqlite:///{(ROOT_DIR / 'data' / 'tranziq.db').as_posix()}")
    cors_origins: list[str] = field(default_factory=lambda: [
        o.strip() for o in os.getenv(
            "TRANZIQ_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",") if o.strip()
    ])
    auto_seed: bool = _bool("TRANZIQ_AUTO_SEED", True)
    seed_legit_sample: int = int(os.getenv("TRANZIQ_SEED_LEGIT_SAMPLE", "4000"))
    seed_synthetic_count: int = int(os.getenv("TRANZIQ_SEED_SYNTHETIC", "300"))
    max_upload_rows: int = int(os.getenv("TRANZIQ_MAX_UPLOAD_ROWS", "5000"))


settings = Settings()
