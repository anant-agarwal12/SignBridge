from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://signbridge:signbridge@localhost:5432/signbridge"
    redis_url: str = "redis://localhost:6379/0"


settings = Settings()
