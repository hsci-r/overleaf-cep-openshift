"""Prepare non-root nginx and environment, then use upstream init unchanged."""
import os
import re
import subprocess
from pathlib import Path


def initialize():
    if os.getuid() == 0:
        raise RuntimeError('This image must run as a non-root UID')
    for name in ('SANDBOXED_COMPILES', 'SANDBOXED_COMPILES_SIBLING_CONTAINERS', 'DOCKER_RUNNER'):
        if os.environ.get(name) == 'true':
            raise RuntimeError('Docker-based sandboxed compiles are unavailable in this CE image')
    os.umask(0o007)
    # Leave room for compile response processing beyond COMPILE_TIMEOUT.
    # Render the upstream location directives without duplicating its vhost.
    proxy_timeout = int(os.environ.get('NGINX_PROXY_TIMEOUT_SECONDS', '600'))
    if proxy_timeout <= 0:
        raise RuntimeError('NGINX_PROXY_TIMEOUT_SECONDS must be positive')
    for name, default in (
            ('MAX_UPLOAD_SIZE', '50'),
            ('GIT_BRIDGE_PORT', '8000'), ('GIT_BRIDGE_REPOSTORE_MAX_FILE_SIZE', '52428800')):
        os.environ.setdefault(name, default)
    nginx_site = Path('/etc/nginx/sites-enabled/overleaf.conf')
    site_template = Path('/etc/nginx/templates/overleaf.conf.template').read_text()
    site_template = re.sub(
        r'(proxy_(?:read|send)_timeout)\s+\S+;',
        lambda match: f'{match.group(1)} {proxy_timeout}s;',
        site_template)
    # Substitute only explicit environment placeholders; preserve nginx's $vars.
    site_config = re.sub(r'\$\{([A-Z_]+)\}',
                         lambda match: os.environ[match.group(1)], site_template)
    if os.environ.get('GIT_BRIDGE_ENABLED') != 'true':
        site_config = re.sub(r'location \^~ /git/ \{[^}]*\}',
                             'location ^~ /git/ { return 404; }', site_config)
    nginx_site.write_text(site_config)
    for path in (os.environ['HOME'], os.environ['XDG_CACHE_HOME'],
                 '/tmp/nginx/client', '/tmp/nginx/proxy', '/tmp/nginx/fastcgi',
                 '/tmp/nginx/uwsgi', '/tmp/nginx/scgi'):
        Path(path).mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('ENABLE_CRON_RESOURCE_DELETION', 'false')
    # Upstream init excludes HOME from export, but reloads it after each init script.
    Path('/etc/container_environment/HOME').write_text(os.environ['HOME'])
    # Import loopback addresses into the environment of all services/history-v1.
    result = subprocess.check_output(
        ['bash', '-c', 'source /etc/overleaf/env.sh; env -0'])
    os.environ.update(dict(item.decode().split('=', 1)
                           for item in result.split(b'\0') if item))
    subprocess.run(['sh', '-c', "envsubst '${NGINX_KEEPALIVE_TIMEOUT} ${NGINX_WORKER_CONNECTIONS} ${NGINX_WORKER_PROCESSES} ${MAX_UPLOAD_SIZE}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf"], check=True)
    subprocess.run(['nginx', '-t'], check=True)


def main():
    os.environ.setdefault('NGINX_KEEPALIVE_TIMEOUT', '65')
    os.environ.setdefault('NGINX_WORKER_CONNECTIONS', '768')
    os.environ.setdefault('NGINX_WORKER_PROCESSES', '1')
    initialize()
    # Upstream init manages startup, runit, adopted children and graceful flushes.
    # Its main command streams application logs and exits with the container.
    logs = Path('/var/log/overleaf')
    for service in Path('/etc/service').iterdir():
        if service.name.endswith('-overleaf'):
            (logs / f'{service.name.removesuffix("-overleaf")}.log').touch(exist_ok=True)
    os.execv('/sbin/my_init', ['my_init', '--', 'tail', '-n', '0', '-F'] +
             [str(path) for path in logs.glob('*.log')])


if __name__ == '__main__':
    main()
