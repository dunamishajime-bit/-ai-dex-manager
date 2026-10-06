import base64
import hashlib
import hmac
import re
import secrets
from urllib.parse import urlparse, urlencode


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Auth:
    def __init__(self, store, public_url):
        self.store = store
        self.base = public_url.rstrip('/')
        self.resource = self.base + '/mcp'

    def register(self, data):
        redirects = data.get('redirect_uris')
        if not isinstance(redirects, list) or not 1 <= len(redirects) <= 5:
            raise ValueError('INVALID_REDIRECT_URI')
        for url in redirects:
            p = urlparse(url)
            if p.scheme != 'https' or p.hostname not in ('chatgpt.com', 'chat.openai.com', 'platform.openai.com') or p.username or p.password or p.fragment or p.port not in (None, 443):
                raise ValueError('INVALID_REDIRECT_URI')
        if data.get('token_endpoint_auth_method', 'none') != 'none':
            raise ValueError('ONLY_PUBLIC_PKCE_CLIENT_SUPPORTED')
        with self.store.lock:
            active = self.store.db.execute("SELECT COUNT(*) FROM auth_items WHERE kind='client' AND expires>strftime('%s','now')").fetchone()[0]
            if active >= 100:
                raise ValueError('CLIENT_REGISTRATION_LIMIT')
            client = {'client_id': secrets.token_urlsafe(24), 'redirect_uris': redirects,
                      'token_endpoint_auth_method': 'none', 'grant_types': ['authorization_code', 'refresh_token'],
                      'response_types': ['code']}
            self.store.put('client', client['client_id'], client, 30 * 86400)
            return client

    def pair(self, device):
        pin = str(secrets.randbelow(100_000_000)).zfill(8)
        self.store.put('pair', device, {'hash': digest(pin), 'tries': 0}, 180)
        return pin

    def begin(self, client_id, redirect_uri, challenge, resource, state):
        client = self.store.get('client', client_id)
        if not client or redirect_uri not in client['redirect_uris'] or resource != self.resource:
            raise ValueError('INVALID_CLIENT_REDIRECT_OR_RESOURCE')
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', challenge or ''):
            raise ValueError('PKCE_S256_REQUIRED')
        if not isinstance(state, str) or len(state) > 2048:
            raise ValueError('INVALID_STATE')
        ticket = secrets.token_urlsafe(32)
        self.store.put('ticket', digest(ticket), {'client': client_id, 'redirect': redirect_uri,
                       'challenge': challenge, 'resource': resource, 'state': state}, 300)
        return ticket

    def approve(self, ticket, pin):
        with self.store.lock:
            data = self.store.get('ticket', digest(ticket))
            if not data:
                raise ValueError('AUTHORIZATION_EXPIRED')
            rows = self.store.db.execute("SELECT id FROM auth_items WHERE kind='pair'").fetchall()
            owner = None
            for row in rows:
                pair = self.store.get('pair', row['id'])
                if not pair or pair['tries'] >= 5:
                    continue
                # Update attempts without extending the expiry.
                pair['tries'] += 1
                import json
                self.store.db.execute("UPDATE auth_items SET data=? WHERE kind='pair' AND id=?", (json.dumps(pair), row['id']))
                self.store.db.commit()
                if hmac.compare_digest(pair['hash'], digest(str(pin))):
                    owner = row['id']
            if not owner:
                raise ValueError('PAIR_CODE_INVALID_OR_EXPIRED')
            self.store.remove('pair', owner)
            self.store.remove('ticket', digest(ticket))
            code = secrets.token_urlsafe(32)
            self.store.put('code', digest(code), {**data, 'device': owner}, 60)
            separator = '&' if '?' in data['redirect'] else '?'
            return data['redirect'] + separator + urlencode({'code': code, 'state': data['state']})

    def issue(self, client, device, family=None):
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
        family=family or secrets.token_urlsafe(24)
        data = {'client': client, 'device': device, 'resource': self.resource, 'family':family}
        self.store.put('access', digest(access), data, 3600)
        self.store.put('refresh', digest(refresh), data, 30 * 86400)
        return {'access_token': access, 'refresh_token': refresh, 'token_type': 'Bearer',
                'expires_in': 3600, 'scope': 'desktop'}

    def exchange(self, data):
        with self.store.lock:
            if data.get('resource') != self.resource:
                raise ValueError('INVALID_RESOURCE')
            if data.get('grant_type') == 'authorization_code':
                key = digest(str(data.get('code', '')))
                code = self.store.get('code', key)
                verifier = str(data.get('code_verifier', ''))
                if not re.fullmatch(r'[A-Za-z0-9._~-]{43,128}', verifier):
                    raise ValueError('INVALID_PKCE_VERIFIER')
                challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
                if not code or code['client'] != data.get('client_id') or code['redirect'] != data.get('redirect_uri') or not hmac.compare_digest(code['challenge'], challenge):
                    raise ValueError('INVALID_GRANT')
                self.store.remove('code', key)
                return self.issue(code['client'], code['device'])
            if data.get('grant_type') == 'refresh_token':
                key = digest(str(data.get('refresh_token', '')))
                spent = self.store.get('spent_refresh', key)
                if spent and spent['client']==data.get('client_id'):
                    self.store.put('revoked_family',spent['family'],{},31*86400)
                    raise ValueError('REFRESH_REUSE_REAUTHORIZE')
                refresh = self.store.get('refresh', key)
                if not refresh or refresh['client'] != data.get('client_id'):
                    raise ValueError('INVALID_GRANT')
                if self.store.get('revoked_family',refresh.get('family','')) is not None: raise ValueError('INVALID_GRANT')
                self.store.remove('refresh', key)
                self.store.put('spent_refresh',key,refresh,31*86400)
                return self.issue(refresh['client'], refresh['device'],refresh['family'])
            raise ValueError('UNSUPPORTED_GRANT_TYPE')

    def validate(self, token):
        data = self.store.get('access', digest(token))
        if not data or data['resource'] != self.resource or self.store.get('revoked_family',data.get('family','')) is not None:
            raise ValueError('INVALID_OR_EXPIRED_TOKEN')
        return data['device']

    def metadata(self):
        return {'issuer': self.base, 'authorization_endpoint': self.base + '/authorize',
                'token_endpoint': self.base + '/token', 'registration_endpoint': self.base + '/register',
                'response_types_supported': ['code'], 'grant_types_supported': ['authorization_code', 'refresh_token'],
                'token_endpoint_auth_methods_supported': ['none'], 'code_challenge_methods_supported': ['S256'],
                'scopes_supported': ['desktop']}
