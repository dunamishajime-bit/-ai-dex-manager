# VPS Deployment

Target:
- ConoHa VPS
- Ubuntu 24.04.3 LTS
- App user: `deploy`

## 1. Install Node.js 20 and pm2

Recommended:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
node -v
npm -v
pm2 -v
```

## 2. Place the repository

```bash
cd /home/deploy
git clone <YOUR_REPO_URL> ai-dex-manager
cd ai-dex-manager
npm ci
```

## 3. Configure environment

Create `.env.local` in the project root and set at least:

- `NEXT_PUBLIC_APP_URL`
- `OPENAI_API_KEY`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `RPC_URL_BSC`
- `RPC_URL_ARBITRUM`
- `RPC_URL_BASE`
- `RPC_URL_POLYGON`
- `SOLANA_RPC_URL`
- `EXECUTION_PRIVATE_KEY`
- `TRADER_PRIVATE_KEY`
- `TRADER_ADDRESS`
Email notifications (choose one provider; never commit the secret):
- Gmail SMTP: `GMAIL_USER` + `GMAIL_APP_PASSWORD`
- or SendGrid: `SENDGRID_API_KEY`
- recipient: `DISDEX_ORDER_FILL_EMAIL` (optional `PENGU_ORDER_FILL_EMAIL`)

Important: linking Gmail to ChatGPT/Codex confirms the assistant can use Gmail, but it does not inject credentials into the VPS process. Configure the VPS independently. For Gmail, create a Google App Password and set it as `GMAIL_APP_PASSWORD`; never commit that value.

Example Gmail configuration:

```bash
DISDEX_ORDER_FILL_EMAIL=dunamis.hajime@gmail.com
GMAIL_USER=dunamis.hajime@gmail.com
GMAIL_APP_PASSWORD=<Google App Password>
```

SendGrid is an alternative; do not configure both unless you intentionally want Gmail priority.

## 4. Build

```bash
npm run build
```

## 5. Start with pm2

```bash
cp ecosystem.config.cjs /home/deploy/ai-dex-manager/ecosystem.config.cjs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

If you prefer systemd instead of pm2, create a unit that runs `npm run start` in the project directory.

## 6. Nginx

Copy the current production config to `/etc/nginx/sites-available/ai-dex-manager`, enable it, then reload nginx.

```bash
sudo cp deploy/professional-dismanager.nginx.conf /etc/nginx/sites-available/ai-dex-manager
sudo ln -sf /etc/nginx/sites-available/ai-dex-manager /etc/nginx/sites-enabled/ai-dex-manager
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Verify

```bash
curl -I http://127.0.0.1:3000
curl -I http://YOUR_SERVER_IP
pm2 status
sudo systemctl status nginx
```
