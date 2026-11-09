#!/usr/bin/env python3
"""Check or configure LinkedIn in the environment selected by the deployed Nango key.

Secrets are read through gcloud and sent to Nango in memory, never printed or
written to a file. Run with --apply to update the integration; default is read-only.
"""
import argparse
import json
from pathlib import Path
import ssl
import subprocess
import urllib.error
import urllib.request


def settings():
    path = Path(__file__).resolve().parents[1] / 'deploy' / 'production.env'
    return dict(line.split('=', 1) for raw in path.read_text().splitlines()
                if (line := raw.strip()) and not line.startswith('#'))


def read_secret(config, name, version):
    result = subprocess.run([
        'gcloud', 'secrets', 'versions', 'access', version,
        '--secret=' + name, '--project=' + config['PROJECT_ID'],
    ], capture_output=True)
    if result.returncode:
        raise RuntimeError('Cannot access secret ' + name + '; provider output suppressed')
    try:
        value = result.stdout.decode().strip()
    except UnicodeError:
        raise RuntimeError('Secret is not valid text: ' + name) from None
    if not value:
        raise RuntimeError('Secret is empty: ' + name)
    return value


def nango_request(api_key, method, payload=None):
    headers = {'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'}
    request = urllib.request.Request(
        'https://api.nango.dev/integrations/linkedin',
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=headers, method=method,
    )
    # Use the system trust store on macOS installations with an unconfigured
    # Python certificate bundle. Certificate verification remains enabled.
    system_ca = Path('/etc/ssl/cert.pem')
    context = ssl.create_default_context(cafile=str(system_ca) if system_ca.exists() else None)
    try:
        with urllib.request.urlopen(request, context=context, timeout=30) as response:
            return json.load(response)['data']
    except urllib.error.HTTPError as error:
        raise RuntimeError('Nango ' + method + ' failed with HTTP ' + str(error.code)
                           + '; response suppressed to protect credentials') from None
    except (urllib.error.URLError, ValueError, KeyError):
        raise RuntimeError('Nango request failed; details suppressed to protect credentials') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='copy the configured LinkedIn credentials into Nango')
    args = parser.parse_args()
    config = settings()
    api_key = read_secret(config, config['NANGO_API_KEY_SECRET_NAME'], config['NANGO_API_KEY_SECRET_VERSION'])
    integration = nango_request(api_key, 'GET')
    if integration.get('provider') != 'linkedin':
        raise RuntimeError('Refusing to update a non-LinkedIn integration')
    if args.apply:
        secret = read_secret(config, config['LINKEDIN_CLIENT_SECRET_NAME'], config['LINKEDIN_CLIENT_SECRET_VERSION'])
        nango_request(api_key, 'PATCH', {'credentials': {
            'type': 'OAUTH2', 'client_id': config['LINKEDIN_CLIENT_ID'],
            'client_secret': secret, 'scopes': 'openid,profile',
        }})
        integration = nango_request(api_key, 'GET')
    missing = integration.get('missing_fields', [])
    print(json.dumps({'integration': integration.get('unique_key'),
                      'provider': integration.get('provider'), 'missing_fields': missing,
                      'updated_at': integration.get('updated_at'), 'applied': args.apply}))
    if missing:
        raise RuntimeError('LinkedIn still requires developer-app configuration')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
