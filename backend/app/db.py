from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# create_engine is lazy: no connection is made until first use.
engine = create_engine(
    settings.database_url, connect_args={"connect_timeout": 2}, pool_pre_ping=True
)


class Base(DeclarativeBase):
    pass
