# MemphisOS OpenClaw Integration Pack

This repo is the downstream integration layer for running OpenClaw under MemphisOS.

MemphisOS `main` keeps only the generic managed-app framework. Vendor-specific manifests, secrets guidance, and lifecycle conventions live here.

## Contents

- `manifests/openclaw.manifest.json`: OpenClaw managed-app manifest for MemphisOS
- `docs/INSTALL.md`: install and lifecycle instructions

## Use With MemphisOS

From the MemphisOS repo:

```bash
npm run -s cli -- apps show openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --json
npm run -s cli -- apps install openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --json
```

To execute a real install:

```bash
export OPENCLAW_GATEWAY_TOKEN='your-token-here'
npm run -s cli -- apps install openclaw --file ../MemphisOS-OpenClaw/manifests/openclaw.manifest.json --apply --json
```

## Why This Repo Exists

- keeps MemphisOS core clean
- lets OpenClaw evolve independently
- makes it easy to publish or replace the integration without polluting `main`
