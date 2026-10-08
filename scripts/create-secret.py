#!/usr/bin/env python3
"""Generate a Kubernetes Secret manifest once; stdout contains secret material."""
import argparse
import base64
import json
import secrets

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--name', default='overleaf-secrets')
parser.add_argument('--namespace', required=True)
args = parser.parse_args()
values = {key: secrets.token_urlsafe(32) for key in (
    'OVERLEAF_INVITE_TOKEN_SECRET', 'WEB_API_PASSWORD', 'STAGING_PASSWORD',
    'CRYPTO_RANDOM', 'OT_JWT_AUTH_KEY')}
values['V1_HISTORY_PASSWORD'] = values['STAGING_PASSWORD']
print(json.dumps({
    'apiVersion': 'v1', 'kind': 'Secret', 'type': 'Opaque',
    'metadata': {'name': args.name, 'namespace': args.namespace},
    'data': {k: base64.b64encode(v.encode()).decode() for k, v in values.items()},
}, indent=2))
