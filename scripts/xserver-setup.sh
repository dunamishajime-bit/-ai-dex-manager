#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/deploy/ai-dex-manager"
ARCHIVE="${ARCHIVE:-/root/xserver-deploy-prebuilt.tar.gz}"

mkdir -p "$APP_DIR/data"
if [ -f "$APP_DIR/.env.local" ]; then
  cp -a "$APP_DIR/.env.local" /tmp/disdex-env.local.bak
fi
if [ -f "$APP_DIR/data/users.json" ]; then
  cp -a "$APP_DIR/data/users.json" /tmp/users.json.bak
fi
if [ -f "$APP_DIR/data/operational-wallets.json" ]; then
  cp -a "$APP_DIR/data/operational-wallets.json" /tmp/operational-wallets.json.bak
fi
if [ -f "$APP_DIR/data/operational-wallet-vault.key" ]; then
  cp -a "$APP_DIR/data/operational-wallet-vault.key" /tmp/operational-wallet-vault.key.bak
fi
if [ -f "$APP_DIR/data/auto-trade-history.json" ]; then
  cp -a "$APP_DIR/data/auto-trade-history.json" /tmp/auto-trade-history.json.bak
fi
if [ -f "$APP_DIR/data/trade-ledger.json" ]; then
  cp -a "$APP_DIR/data/trade-ledger.json" /tmp/trade-ledger.json.bak
fi

rm -rf "${APP_DIR:?}/"*
rm -rf "$APP_DIR/.next" "$APP_DIR/.vercel"
tar -xzf "$ARCHIVE" -C "$APP_DIR"

mkdir -p "$APP_DIR/data"
if [ -f /tmp/disdex-env.local.bak ]; then
  mv /tmp/disdex-env.local.bak "$APP_DIR/.env.local"
fi
if [ -f /tmp/users.json.bak ]; then
  mv /tmp/users.json.bak "$APP_DIR/data/users.json"
fi
if [ -f /tmp/operational-wallets.json.bak ]; then
  mv /tmp/operational-wallets.json.bak "$APP_DIR/data/operational-wallets.json"
fi
if [ -f /tmp/operational-wallet-vault.key.bak ]; then
  mv /tmp/operational-wallet-vault.key.bak "$APP_DIR/data/operational-wallet-vault.key"
fi
if [ -f /tmp/auto-trade-history.json.bak ]; then
  mv /tmp/auto-trade-history.json.bak "$APP_DIR/data/auto-trade-history.json"
fi
if [ -f /tmp/trade-ledger.json.bak ]; then
  mv /tmp/trade-ledger.json.bak "$APP_DIR/data/trade-ledger.json"
fi
chown -R deploy:deploy /home/deploy

su - deploy -c "cd $APP_DIR && npm install"
if [ ! -f "$APP_DIR/.next/BUILD_ID" ]; then
  su - deploy -c "cd $APP_DIR && npx next build"
fi
su - deploy -c "cd $APP_DIR && pm2 delete all || true"
su - deploy -c "cd $APP_DIR && pm2 start ecosystem.config.cjs"
su - deploy -c "pm2 save"

# Keep existing nginx/certbot-managed config.
# Bootstrap only when config file does not exist yet.
if [ ! -f /etc/nginx/sites-available/dis-dex-manager ]; then
cat >/etc/nginx/sites-available/dis-dex-manager <<'EOF'
server {
    listen 80;
    listen [::]:80;
server_name professional-dismanager.net www.professional-dismanager.net;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
fi

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/dis-dex-manager /etc/nginx/sites-enabled/dis-dex-manager
nginx -t
systemctl restart nginx

curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1
