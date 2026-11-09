import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

path = Path(__file__).resolve().parents[1] / 'scripts/configure-nango-oauth.py'
spec = importlib.util.spec_from_file_location('configure_oauth', path)
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class ConfigureNangoOAuthTests(unittest.TestCase):
    def test_apply_configures_github_credentials_without_printing_them(self):
        config = configure.settings()
        metadata = {'unique_key': 'github', 'provider': 'github', 'missing_fields': []}
        output = io.StringIO()
        with patch.object(configure, 'read_secret', side_effect=['test-api-key', 'test-client-secret']) as secret, \
             patch.object(configure, 'nango_request', side_effect=[metadata, metadata, metadata]) as request, \
             patch('sys.argv', ['configure', '--provider', 'github', '--apply']), contextlib.redirect_stdout(output):
            try:
                configure.main()
            except SystemExit as error:
                self.fail(f'GitHub provider option is missing: {error}')
        self.assertEqual(secret.call_args_list[1].args[1:],
                         (config['GITHUB_CLIENT_SECRET_NAME'], config['GITHUB_CLIENT_SECRET_VERSION']))
        self.assertEqual(request.call_args_list[0].kwargs, {'integration_id': 'github'})
        self.assertEqual(request.call_args_list[1].args[2]['credentials'], {
            'type': 'OAUTH2', 'client_id': config['GITHUB_CLIENT_ID'],
            'client_secret': 'test-client-secret', 'scopes': 'read:user',
        })
        self.assertEqual(request.call_args_list[1].kwargs, {'integration_id': 'github'})
        self.assertNotIn('test-api-key', output.getvalue())
        self.assertNotIn('test-client-secret', output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['provider'], 'github')

    def test_github_check_does_not_read_github_secret_or_modify_nango(self):
        metadata = {'unique_key': 'github', 'provider': 'github', 'missing_fields': []}
        with patch.object(configure, 'read_secret', return_value='test-api-key') as secret, \
             patch.object(configure, 'nango_request', return_value=metadata) as request, \
             patch('sys.argv', ['configure', '--provider', 'github']), contextlib.redirect_stdout(io.StringIO()):
            try:
                configure.main()
            except SystemExit as error:
                self.fail(f'GitHub provider option is missing: {error}')
        self.assertEqual(secret.call_count, 1)
        request.assert_called_once_with('test-api-key', 'GET', integration_id='github')

    def test_apply_transfers_credentials_without_printing_them(self):
        config = configure.settings()
        metadata = {'unique_key': 'linkedin', 'provider': 'linkedin', 'missing_fields': []}
        output = io.StringIO()
        with patch.object(configure, 'read_secret', side_effect=['test-api-key', 'test-client-secret']), \
             patch.object(configure, 'nango_request', side_effect=[metadata, metadata, metadata]) as request, \
             patch('sys.argv', ['configure', '--apply']), contextlib.redirect_stdout(output):
            configure.main()
        payload = request.call_args_list[1].args[2]
        self.assertEqual(payload['credentials']['client_id'], config['LINKEDIN_CLIENT_ID'])
        self.assertEqual(payload['credentials']['client_secret'], 'test-client-secret')
        self.assertEqual(payload['credentials']['scopes'], 'openid,profile')
        self.assertNotIn('test-api-key', output.getvalue())
        self.assertNotIn('test-client-secret', output.getvalue())
        self.assertTrue(json.loads(output.getvalue())['applied'])

    def test_linkedin_check_does_not_read_its_secret_or_modify_nango(self):
        metadata = {'unique_key': 'linkedin', 'provider': 'linkedin', 'missing_fields': []}
        with patch.object(configure, 'read_secret', return_value='test-api-key') as secret, \
             patch.object(configure, 'nango_request', return_value=metadata) as request, \
             patch('sys.argv', ['configure']), contextlib.redirect_stdout(io.StringIO()):
            configure.main()
        self.assertEqual(secret.call_count, 1)
        request.assert_called_once_with('test-api-key', 'GET', integration_id='linkedin')

    def test_provider_errors_do_not_expose_credentials(self):
        error = urllib.error.HTTPError('https://api.nango.dev/integrations/linkedin', 400,
                                      'test-client-secret', {}, io.BytesIO(b'test-client-secret'))
        with patch.object(configure.urllib.request, 'urlopen', side_effect=error):
            with self.assertRaises(RuntimeError) as caught:
                configure.nango_request('test-api-key', 'PATCH', {'credentials': {}})
        self.assertNotIn('test-client-secret', str(caught.exception))
        self.assertIn('HTTP 400', str(caught.exception))

    def test_wrong_provider_is_never_updated(self):
        with patch.object(configure, 'read_secret', return_value='test-api-key'), \
             patch.object(configure, 'nango_request', return_value={'provider': 'github'}) as request, \
             patch('sys.argv', ['configure', '--apply']):
            with self.assertRaisesRegex(RuntimeError, 'non-LinkedIn'):
                configure.main()
        self.assertEqual(request.call_count, 1)


if __name__ == '__main__':
    unittest.main()
