"""Fast readiness: local services plus Mongo reachability and Redis PING."""
import os
import socket
import urllib.request
from urllib.parse import urlsplit

for port in (8088, 3010, 3013, 3016, 3003, 3009, 3100, 3042, 3054, 3026, 3000, 4000):
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/status', timeout=2) as response:
        if response.status != 200:
            raise RuntimeError(f'Unhealthy service: {port}')
mongo = urlsplit(os.environ['OVERLEAF_MONGO_URL'])
with socket.create_connection((mongo.hostname, mongo.port or 27017), timeout=2):
    pass
with socket.create_connection((os.environ['OVERLEAF_REDIS_HOST'],
                               int(os.environ['OVERLEAF_REDIS_PORT'])), timeout=2) as connection:
    connection.sendall(b'*1\r\n$4\r\nPING\r\n')
    if connection.recv(64) != b'+PONG\r\n':
        raise RuntimeError('Redis is not ready')
