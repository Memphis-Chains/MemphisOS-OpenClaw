# Install OpenClaw Through MemphisOS

## Prerequisites

- Linux host
- Node `22.16+` available to MemphisOS
- `npm`
- `git`
- `systemctl` user-service support
- `OPENCLAW_GATEWAY_TOKEN` set for non-interactive onboarding

## Inspect The Manifest

```bash
cd /home/memphis_ai_brain_on_chain/MemphisOS
npm run -s cli -- apps show openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --json
```

## Plan The Install

```bash
npm run -s cli -- apps install openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --json
```

## Run The Install

```bash
export OPENCLAW_GATEWAY_TOKEN='your-token-here'
npm run -s cli -- apps install openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --apply --json
```

## Manage The Service

```bash
npm run -s cli -- apps status openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --apply --json
npm run -s cli -- apps start openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --apply --json
npm run -s cli -- apps stop openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --apply --json
npm run -s cli -- apps restart openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --apply --json
npm run -s cli -- apps doctor openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --apply --json
npm run -s cli -- apps dashboard openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --apply
```
