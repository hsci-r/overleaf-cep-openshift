"""Non-root PID 1: upstream initialization, runit, cron and graceful flushes."""
import datetime
import json
import os
import re
import shlex
import signal
import subprocess
import time
from pathlib import Path

STOP = False
REQUIRED_SECRETS = ('OVERLEAF_INVITE_TOKEN_SECRET', 'WEB_API_PASSWORD',
                    'STAGING_PASSWORD', 'V1_HISTORY_PASSWORD',
                    'CRYPTO_RANDOM', 'OT_JWT_AUTH_KEY')


def request_stop(signum, frame):
    global STOP
    STOP = True


def run(command, **kwargs):
    print('Running ' + ' '.join(map(str, command)), flush=True)
    return subprocess.run(command, check=True, **kwargs)


def matches(field, value):
    if field == '*':
        return True
    if field.startswith('*/'):
        return value % int(field[2:]) == 0
    return value in [int(x) for x in field.split(',')]


def cron_commands(now):
    # Interpret the pinned image's simple crontabs, using UTC container time.
    for name in ('crontab-history', 'crontab-deletion'):
        for line in Path('/etc/cron.d', name).read_text().splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            minute, hour, day, month, weekday, user, command = line.split(None, 6)
            if all(matches(f, v) for f, v in zip(
                    (minute, hour, day, month, weekday),
                    (now.minute, now.hour, now.day, now.month, (now.weekday() + 1) % 7))):
                yield command


def initialize():
    if os.getuid() == 0:
        raise RuntimeError('This image must run as a non-root UID')
    for name in REQUIRED_SECRETS:
        if len(os.environ.get(name, '')) < 16:
            raise RuntimeError(f'{name} must be a persistent secret of at least 16 characters')
    if os.environ['STAGING_PASSWORD'] != os.environ['V1_HISTORY_PASSWORD']:
        raise RuntimeError('STAGING_PASSWORD and V1_HISTORY_PASSWORD must match')
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
            ('MAX_UPLOAD_SIZE', '50'), ('GIT_BRIDGE_HOST', '127.0.0.1'),
            ('GIT_BRIDGE_PORT', '8000'), ('GIT_BRIDGE_REPOSTORE_MAX_FILE_SIZE', '52428800')):
        os.environ.setdefault(name, default)
    nameservers = re.findall(r'^nameserver\s+(\S+)',
                             Path('/etc/resolv.conf').read_text(), re.MULTILINE)
    os.environ['NGINX_RESOLVER'] = nameservers[0] if nameservers else '127.0.0.1'
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
    # Phusion normally writes these; scripts require both the files and exports.
    valid = {k: v for k, v in os.environ.items()
             if re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', k)}
    Path('/etc/container_environment.sh').write_text(''.join(
        f'export {k}={shlex.quote(v)}\n' for k, v in valid.items()))
    Path('/etc/container_environment.json').write_text(json.dumps(valid))
    for key, value in valid.items():
        Path('/etc/container_environment', key).write_text(value)
    # Import loopback addresses into the environment of all services/history-v1.
    result = subprocess.check_output(
        ['bash', '-c', 'source /etc/overleaf/env.sh; env -0'])
    os.environ.update(dict(item.decode().split('=', 1)
                           for item in result.split(b'\0') if item))
    run(['sh', '-c', "envsubst '${NGINX_KEEPALIVE_TIMEOUT} ${NGINX_WORKER_CONNECTIONS} ${NGINX_WORKER_PROCESSES} ${MAX_UPLOAD_SIZE}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf"])
    run(['nginx', '-t'])
    for script in sorted(Path('/etc/my_init.d').iterdir()):
        if script.is_file() and os.access(script, os.X_OK):
            if STOP:
                return
            run([str(script)])


def shutdown(supervisor, jobs):
    # Keep services alive while the upstream helpers disconnect users and flush
    # pending editor changes/history. Each helper is bounded by the pod grace.
    for script in sorted(Path('/etc/my_init.pre_shutdown.d').iterdir()):
        if script.is_file() and os.access(script, os.X_OK):
            try:
                run([str(script)], timeout=55)
            except (subprocess.SubprocessError, OSError) as error:
                print(f'Shutdown helper failed: {script.name}: {error}', flush=True)
    subprocess.run(['sv', '-w', '20', 'force-stop'] +
                   [str(s) for s in Path('/tmp/overleaf-services').iterdir()], check=False)
    for process in [supervisor] + jobs:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
    time.sleep(1)
    for process in [supervisor] + jobs:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def main():
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    os.environ.setdefault('NGINX_KEEPALIVE_TIMEOUT', '65')
    os.environ.setdefault('NGINX_WORKER_CONNECTIONS', '768')
    os.environ.setdefault('NGINX_WORKER_PROCESSES', '1')
    initialize()
    if STOP:
        return
    # Only the application services are supervised, excluding sshd/syslog/cron.
    services = Path('/tmp/overleaf-services')
    services.mkdir(exist_ok=True)
    for service in Path('/etc/service').iterdir():
        if service.name.endswith('-overleaf') or service.name == 'nginx':
            link = services / service.name
            if not link.exists():
                link.symlink_to(service)
    supervisor = subprocess.Popen(['runsvdir', str(services)], start_new_session=True)
    # Ship Node service logs to the container log stream for oc logs.
    logs = Path('/var/log/overleaf')
    for service in services.iterdir():
        name = service.name.removesuffix('-overleaf')
        if name != 'nginx':
            (logs / f'{name}.log').touch(exist_ok=True)
    tail = subprocess.Popen(['tail', '-n', '0', '-F'] +
                            [str(p) for p in logs.glob('*.log')], start_new_session=True)
    jobs = [tail]
    last_minute = None
    try:
        while not STOP:
            if supervisor.poll() is not None:
                raise RuntimeError('runit supervisor exited')
            now = datetime.datetime.now(datetime.timezone.utc)
            minute = now.replace(second=0, microsecond=0)
            if minute != last_minute:
                for command in cron_commands(now):
                    jobs.append(subprocess.Popen(['bash', '-c', command], start_new_session=True))
                last_minute = minute
            jobs = [p for p in jobs if p.poll() is None]
            # PID 1 also reaps orphaned/background children (history recovery).
            while True:
                try:
                    pid, status = os.waitpid(-1, os.WNOHANG)
                    if not pid:
                        break
                    for process in [supervisor] + jobs:
                        if process.pid == pid:
                            process.returncode = os.waitstatus_to_exitcode(status)
                except ChildProcessError:
                    break
            time.sleep(1)
    finally:
        shutdown(supervisor, jobs)


if __name__ == '__main__':
    main()
