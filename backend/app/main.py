from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import text

from app.cache import redis_client
from app.db import engine
from app.fingerspell import router as fingerspell_router

app = FastAPI(title="SignBridge API")
app.include_router(fingerspell_router)
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


class Health(BaseModel):
    status: str
    db: bool
    redis: bool


def check_db() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def check_redis() -> bool:
    try:
        return bool(redis_client.ping())
    except Exception:
        return False


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok", db=check_db(), redis=check_redis())
