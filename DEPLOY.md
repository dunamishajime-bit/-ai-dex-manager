# Deployment Guide

## 1. Prerequisites
- Vercel Account (https://vercel.com/signup)
- Vercel CLI installed (`npm i -g vercel`)

## 2. Deploy to Vercel
Run the following command in your terminal:

```bash
vercel
```

Follow the prompts:
1. `Set up and deploy?` -> `y`
2. `Which scope?` -> Select your account
3. `Link to existing project?` -> `n`
4. `Project name?` -> `ai-dex-manager` (or default)
5. `Directory?` -> `./`
6. `Want to modify settings?` -> `n`

## 3. Environment Variables
After deployment, go to your Vercel Project Settings > Environment Variables and add:
- `GEMINI_API_KEY`: Your Google Gemini API Key

## 4. Redeploy
If you added environment variables, redeploy for them to take effect:

```bash
vercel --prod
```
