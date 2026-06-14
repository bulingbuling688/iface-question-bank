# iFace Question Bank

## Online URL

https://iface-question-bank.chatapi.fun

## Overview

iFace Question Bank is a browser-based interview practice tool for reviewing technical interview questions, tracking practice progress, and using an AI assistant while preparing answers.

This published version is for personal learning and interview preparation. It includes the original iFace question bank plus focused Agent interview preparation content.

Current capabilities:

- Practice built-in interview questions by category, module, difficulty, and status.
- Review detailed answers with Markdown rendering.
- Track progress in the browser's local storage.
- Import custom JSON question sets.
- Configure an AI assistant provider in the browser settings.

## Features

- Built-in question banks for frontend, Java, Golang, AI Agent topics, and Agent interview core topics.
- Local-only progress and settings storage.
- Import/export workflow for custom question data.
- Progressive Web App assets and service worker support.
- Static Nginx deployment on the VPS.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19 + TypeScript |
| Backend framework | Not used for the VPS static deployment |
| Database | Browser local storage / IndexedDB |
| Build tool | Vite + Bun |
| Deployment style | Static files served by Nginx on VPS |

## Local Development

Install dependencies:

```bash
bun install
```

Start the development server:

```bash
bun run dev
```

Local URL:

```text
http://localhost:5173
```

Build production assets:

```bash
bun run build
```

Validate bundled question files:

```bash
bun run check:questions
```

## Environment Variables

The static VPS deployment does not require server-side secrets.

| Name | Purpose | Required | Example |
|---|---|---|---|
| VITE_GITHUB_CLIENT_ID | Optional GitHub OAuth client ID exposed to the browser at build time | No | your_github_oauth_app_client_id |
| IFACE_AI_API_KEY | Optional local smoke-test API key for CLI checks only | No | sk-*** |
| IFACE_AI_BASE_URL | Optional local smoke-test AI base URL for CLI checks only | No | https://api.example.com/v1 |
| IFACE_AI_MODEL | Optional local smoke-test model name for CLI checks only | No | gpt-example |
| IFACE_GIST_TOKEN | Optional local smoke-test token for Gist sync checks only | No | ghp_*** |

Do not commit real keys. Runtime API keys entered in the app are stored in the user's browser.

## Deployment

Project slug:

```text
iface-question-bank
```

GitHub repo:

```text
https://github.com/bulingbuling688/iface-question-bank
```

VPS:

```text
34.81.224.158
```

VPS path:

```text
/opt/apps/iface-question-bank
```

Runtime:

```text
Static files served by Nginx
```

Build command:

```bash
bun run build
```

Start command:

```text
Not applicable
```

Internal port:

```text
Not applicable
```

Public domain:

```text
https://iface-question-bank.chatapi.fun
```

Nginx config:

```text
/etc/nginx/sites-available/iface-question-bank.conf
/etc/nginx/sites-enabled/iface-question-bank.conf
```

Cloudflare DNS:

```text
A iface-question-bank -> 34.81.224.158, proxied
```

Environment file:

```text
Not applicable
```

## Directory Structure

```text
.
├── api/                 # Vercel serverless auth function from the upstream app
├── public/questions/    # Built-in question JSON files
├── scripts/             # Validation and smoke-check scripts
├── src/                 # React application source
├── dist/                # Production build output, generated locally
├── package.json         # Scripts and dependencies
├── vite.config.ts       # Vite and PWA configuration
└── vercel.json          # Upstream Vercel rewrite config
```

## Common Commands

Check Nginx status on the VPS:

```bash
ssh new 'sudo systemctl status nginx --no-pager'
```

Validate and reload Nginx:

```bash
ssh new 'sudo nginx -t && sudo systemctl reload nginx'
```

View Nginx logs:

```bash
ssh new 'sudo tail -n 100 /var/log/nginx/iface-question-bank.access.log'
ssh new 'sudo tail -n 100 /var/log/nginx/iface-question-bank.error.log'
```

Redeploy static files:

```bash
bun run build
scp tmp/iface-question-bank-dist.zip new:/tmp/iface-question-bank-dist.zip
ssh new 'cd /opt/apps/iface-question-bank && unzip -oq /tmp/iface-question-bank-dist.zip -d dist'
```

## Maintenance Notes

- The VPS deployment is static. The upstream `api/auth.js` Vercel function is not active in this Nginx-only deployment.
- GitHub login and Gist backup require a compatible server-side OAuth callback before they should be considered production-ready on this domain.
- The app itself remains usable for local question practice without GitHub login.
- Do not modify the protected production subdomains `api.chatapi.fun`, `cpa.chatapi.fun`, `helper.chatapi.fun`, or `grok.chatapi.fun` for this project.
