import redis

from app.config import settings

redis_client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
