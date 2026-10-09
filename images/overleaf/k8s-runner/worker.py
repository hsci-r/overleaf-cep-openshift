"""Tokenless compiler lifecycle and command wrapper; rsync handles file transfer."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

MAX_LOG = 2 * 1024 * 1024
ACTIVITY = Path(os.environ.get('RUNNER_ACTIVITY', '/tmp/overleaf-runner.activity'))
IDLE = float(os.environ.get('RUNNER_IDLE_SECONDS', '600'))
WORKSPACE = Path(os.environ.get('RUNNER_WORKSPACE', '/compile')).resolve()


def rsync_server():
    activity(float(sys.argv[2]))
    try:
        result = subprocess.run(['rsync', *sys.argv[3:]])
        return result.returncode
    finally:
        activity()


def activity(busy_seconds=0):
    pending = ACTIVITY.with_suffix('.tmp')
    pending.write_text(str(time.monotonic() + max(IDLE, busy_seconds)))
    pending.replace(ACTIVITY)


def serve():
    """PID 1; exec sessions extend a bounded expiry timestamp."""
    os.umask(0o007)
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    Path(os.environ.get('HOME', '/tmp/home')).mkdir(parents=True, exist_ok=True)
    activity()
    while time.monotonic() < float(ACTIVITY.read_text()):
        # PID 1 reaps exited children; this is not a process sweep.
        try:
            while os.waitpid(-1, os.WNOHANG)[0]:
                pass
        except ChildProcessError:
            pass
        time.sleep(min(1, IDLE))


def invoke():
    request = json.loads(sys.stdin.buffer.readline(1024 * 1024))
    timeout = float(request['timeoutSeconds'])
    activity(timeout)
    try:
        cwd = WORKSPACE / request.get('cwd', '')
        env = dict(os.environ)
        env.update({str(k): str(v) for k, v in request.get('environment', {}).items()})
        result = {'stdout': '', 'stderr': '', 'exitCode': None}
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            process = subprocess.Popen(request['command'], cwd=cwd, env=env,
                                       stdin=subprocess.DEVNULL, stdout=stdout,
                                       stderr=stderr, start_new_session=True)
            try:
                result['exitCode'] = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                # Keep the wrapper alive for bounded collection; the app then
                # deletes the entire Job, disposing of every remaining process.
                process.kill()
                process.wait()
                result['timedout'] = True
            for name, stream in (('stdout', stdout), ('stderr', stderr)):
                stream.seek(0)
                data = stream.read(MAX_LOG + 1)
                result[name] = data[:MAX_LOG].decode('utf-8', errors='replace')
                if len(data) > MAX_LOG:
                    result[name] += '\n(...truncated at 2MB...)'
        sys.stdout.buffer.write(json.dumps(result).encode() + b'\n')
        sys.stdout.buffer.flush()
    finally:
        activity()


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'serve':
        serve()
    elif mode == 'invoke':
        invoke()
    elif mode == 'rsync':
        sys.exit(rsync_server())
    else:
        raise ValueError('Unknown runner operation')
