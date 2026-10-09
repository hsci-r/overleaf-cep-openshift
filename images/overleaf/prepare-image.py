"""Adapt CE+ for arbitrary UIDs, retaining its shipped service scripts."""
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
    Path('/etc/my_init.d', name).unlink(missing_ok=True)

# Run upstream cron commands as the runtime UID using a standard cron scheduler.
crontab = ''.join(p.read_text() for p in Path('/etc/cron.d').glob('crontab-*'))
crontab = re.sub(r'^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+root\s+', r'\1 ', crontab, flags=re.MULTILINE)
Path('/etc/overleaf/crontab').write_text(crontab)
Path('/etc/service/cron').mkdir(parents=True, exist_ok=True)
Path('/etc/service/cron/run').write_text('#!/bin/sh\nexec supercronic -quiet /etc/overleaf/crontab\n')
os.chmod('/etc/service/cron/run', 0o755)
# Let upstream init supervise the application and rootless cron, with unrelated
# privileged services disabled.
for service in Path('/etc/service').iterdir():
    if not (service.name.endswith('-overleaf') or service.name in ('nginx', 'cron')):
        (service / 'down').touch()

# Preserve every upstream location, especially socket.io and CLSI PDF ranges.
p = Path('/etc/nginx/templates/overleaf.conf.template')
config = p.read_text()
if len(re.findall(r'listen\s+80;', config)) != 1:
    raise RuntimeError('Unexpected Overleaf nginx config: review image adaptation')
config = re.sub(r'listen\s+80;', 'listen 8088;', config)
config = re.sub(
    r'(proxy_set_header X-Forwarded-Host \$host;)(?:\s*proxy_set_header X-Forwarded-Proto \$scheme;)?',
    r'\1\n\t\tproxy_set_header X-Forwarded-Proto $overleaf_forwarded_proto;', config)
# The Git bridge shares the pod network and uses a numeric loopback address.
config = config.replace("\t\tresolver_timeout 2s;\n"
                        "\t\tresolver 127.0.0.11 valid=10s;\n", "")
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

# Supply analyticsId when CE+'s signup helper omits it; skip when upstream fixes it.
p = Path('/overleaf/services/web/modules/registration-page/app/src/UserRegistrationHandler.mjs')
source = p.read_text()
old = 'registerNewUser({ ...userData, password })'
p.write_text(source.replace(old,
    'registerNewUser({ ...userData, password, analyticsId: userData.analyticsId || crypto.randomUUID() })'))

# Select the isolated backend without enabling the Docker socket/host-path setup.
p = Path('/overleaf/services/clsi/app/js/CommandRunner.js')
old = "if ((Settings.clsi != null ? Settings.clsi.dockerRunner : undefined) === true) {"
source = p.read_text()
if source.count(old) != 1:
    raise RuntimeError('Review upstream CLSI command runner selection')
p.write_text(source.replace(old, "if (process.env.KUBERNETES_RUNNER === 'true') {\n"
    "  commandRunnerPath = './OverleafKubernetesRunner.mjs'\n} else " + old))
p = Path('/overleaf/services/clsi/config/settings.defaults.cjs')
with p.open('a') as dest:
    dest.write('''
// Commands and SyncTeX use the runner workspace at /compile.
if (process.env.KUBERNETES_RUNNER === 'true') {
  // Match Docker's setting: skip application-side PDF optimisation.
  module.exports.clsi ||= {}
  module.exports.clsi.optimiseInDocker = true
  module.exports.path.synctexBaseDir = () => '/compile'
}
''')

# Startup/transfers can exceed Docker's fixed HTTP/lock allowance. Preserve the
# old defaults when Kubernetes is disabled; configure matching budgets otherwise.
for filename, old, new in (
    ('services/clsi/app.js', 'const TIMEOUT = 630 * 1000',
     'const TIMEOUT = Number(process.env.KUBERNETES_REQUEST_TIMEOUT_SECONDS || 630) * 1000'),
    ('services/web/app/src/Features/Compile/ClsiManager.mjs',
     'const COMPILE_REQUEST_TIMEOUT_MS = 12 * 60 * 1000',
     'const COMPILE_REQUEST_TIMEOUT_MS = Number(process.env.KUBERNETES_REQUEST_TIMEOUT_SECONDS || 720) * 1000'),
    ('services/clsi/app/js/LockManager.js',
     'const LOCK_TIMEOUT_MS = RequestParser.MAX_TIMEOUT * 1000 + 120000',
     'const LOCK_TIMEOUT_MS = Number(process.env.KUBERNETES_REQUEST_TIMEOUT_SECONDS || RequestParser.MAX_TIMEOUT) * 1000 + 120000'),
):
    p = Path('/overleaf', filename)
    source = p.read_text()
    if source.count(old) != 1:
        raise RuntimeError(f'Review upstream timeout in {filename}')
    p.write_text(source.replace(old, new))

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
