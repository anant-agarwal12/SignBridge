from fastapi import FastAPI
from pydantic import BaseModel
from sqlalchemy import text

from app.cache import redis_client
from app.db import engine

app = FastAPI(title="SignBridge API")


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
