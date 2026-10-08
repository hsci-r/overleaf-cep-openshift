"""Adapt the pinned CE+ image at build time, retaining its shipped service scripts."""
import os
import re
from pathlib import Path

# Upstream service, migration, admin and shutdown helpers call setuser www-data.
# All already run as the SCC-selected UID, so no uid/gid switch is necessary.
Path('/sbin/setuser').write_text('''#!/bin/sh
set -eu
[ "$1" = www-data ] || { echo "Only www-data passthrough is supported" >&2; exit 1; }
shift
exec "$@"
''')
os.chmod('/sbin/setuser', 0o755)

# Runtime chown and /etc/hosts writes require privileges. SCC/CSI supplies PVC
# permissions; CE uses localhost service URLs and never needs dockerhost.
p = Path('/etc/my_init.d/100_make_overleaf_data_dirs.sh')
p.write_text('\n'.join(line for line in p.read_text().splitlines()
                       if not line.startswith('chown ')) + '\n')
for name in ('100_generate_secrets.sh', '100_set_docker_host_ipaddress.sh',
             '200_nginx_config_template.sh', '00_regen_ssh_host_keys.sh',
             '10_syslog-ng.init'):
    Path('/etc/my_init.d', name).unlink()

for name in ('crontab-history', 'crontab-deletion'):
    os.chmod(Path('/etc/cron.d', name), 0o644)

# Preserve every upstream location, especially socket.io and CLSI PDF ranges.
p = Path('/etc/nginx/templates/overleaf.conf.template')
config = p.read_text()
if len(re.findall(r'listen\s+80;', config)) != 1:
    raise RuntimeError('Unexpected Overleaf nginx config: review image adaptation')
config = re.sub(r'listen\s+80;', 'listen 8088;', config)
config = config.replace('proxy_set_header X-Forwarded-Proto $scheme;',
                        'proxy_set_header X-Forwarded-Proto $overleaf_forwarded_proto;')
config = config.replace('proxy_set_header X-Forwarded-Host $host;',
                        'proxy_set_header X-Forwarded-Host $host;\n'
                        '\t\tproxy_set_header X-Forwarded-Proto $overleaf_forwarded_proto;')
# Avoid adding the same header twice in socket.io's block.
config = config.replace('\t\tproxy_set_header X-Forwarded-Proto $overleaf_forwarded_proto;\n'
                        '\t\tproxy_set_header X-Forwarded-Proto $overleaf_forwarded_proto;',
                        '\t\tproxy_set_header X-Forwarded-Proto $overleaf_forwarded_proto;')
# Docker's resolver is unavailable on Kubernetes. Resolve optional integrations
# through the pod's nameserver, supplied by the entrypoint at startup.
config = config.replace('resolver 127.0.0.11', 'resolver ${NGINX_RESOLVER}')
p.write_text(config)

p = Path('/etc/nginx/templates/nginx.conf.template')
config = p.read_text().replace('user www-data;', '').replace('pid /run/nginx.pid;',
                                                          'pid /tmp/nginx.pid;')
config = config.replace('http {', '''http {
    # The edge Route sets X-Forwarded-Proto. Requests come only via its Service.
    map $http_x_forwarded_proto $overleaf_forwarded_proto {
        default $scheme;
        https https;
    }
    client_body_temp_path /tmp/nginx/client;
    proxy_temp_path /tmp/nginx/proxy;
    fastcgi_temp_path /tmp/nginx/fastcgi;
    uwsgi_temp_path /tmp/nginx/uwsgi;
    scgi_temp_path /tmp/nginx/scgi;''')
config = config.replace('/var/log/nginx/access.log', '/dev/stdout').replace(
    '/var/log/nginx/error.log', '/dev/stderr')
p.write_text(config)

# CE+ v5.1's public signup helper omits the upstream-required analyticsId.
# Keep the fix bounded to the pinned helper and fail if its source changes.
p = Path('/overleaf/services/web/modules/registration-page/app/src/UserRegistrationHandler.mjs')
source = p.read_text()
old = 'registerNewUser({ ...userData, password })'
if source.count(old) != 1:
    raise RuntimeError('Review the CE+ registration analyticsId compatibility fix')
p.write_text(source.replace(old,
    'registerNewUser({ ...userData, password, analyticsId: userData.analyticsId || crypto.randomUUID() })'))

# OpenShift arbitrary-UID image convention: the process belongs to group 0.
# Do not make application source or binaries writable by the runtime user.
for root in ('/etc/service', '/etc/overleaf', '/etc/nginx',
             '/etc/container_environment', '/var/log/overleaf', '/var/lib/overleaf'):
    Path(root).mkdir(parents=True, exist_ok=True)
    for base, dirs, files in os.walk(root):
        for name in [base] + [str(Path(base, x)) for x in dirs + files]:
            if not Path(name).is_symlink():
                os.chown(name, -1, 0)
                os.chmod(name, os.stat(name).st_mode | 0o070)
# These files are read by upstream recovery/shutdown and cron scripts.
for name in ('/etc/container_environment.sh', '/etc/container_environment.json'):
    Path(name).touch(exist_ok=True)
    os.chown(name, -1, 0)
    os.chmod(name, 0o660)
