import importlib
import unittest

CONFIG='server {\n listen 443 ssl;\n server_name professional-dismanager.net;\n location / { proxy_pass http://127.0.0.1:3001; }\n}\nserver { listen 80; }'
class InstallTest(unittest.TestCase):
    def module(self):
        try: return importlib.import_module('deploy.install_vps')
        except ModuleNotFoundError: self.fail('Installer missing')
    def test_nginx_additive_idempotent_and_existing_routes_preserved(self):
        fn=self.module().nginx_config
        value=fn(CONFIG)
        self.assertIn('proxy_pass http://127.0.0.1:3001;',value)
        self.assertEqual(fn(value),value)
        self.assertEqual(value.count('location ^~ /hajime-remote/'),1)
        self.assertIn('8798',value)
    def test_unknown_site_fails_without_modifying(self):
        with self.assertRaises(ValueError): self.module().nginx_config('server { listen 80; }')
