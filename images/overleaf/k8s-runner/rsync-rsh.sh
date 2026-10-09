#!/bin/sh
set -eu
# Rsync supplies the pod name, then its remote executable and server arguments.
pod=$1
shift 2
exec kubectl --namespace "$RUNNER_NAMESPACE" exec -i "$pod" -c compiler -- \
  python3 /opt/overleaf-runner/worker.py rsync "$RUNNER_REQUEST_TIMEOUT_SECONDS" "$@"
