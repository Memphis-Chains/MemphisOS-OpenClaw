# Install OpenClaw Through MemphisOS

## Prerequisites

- Linux host
- Node `22.16+` available to MemphisOS
- `npm`
- `git`
- `systemctl` user-service support
- Memphis vault initialized
- `OPENCLAW_GATEWAY_TOKEN` stored in the Memphis vault for non-interactive onboarding

## Prepare The Gateway Token

From the MemphisOS repo:

```bash
cd /home/memphis_ai_brain_on_chain/MemphisOS
npm run -s cli -- vault init --passphrase 'strong-passphrase' --recovery-question 'pet' --recovery-answer 'nori'
npm run -s cli -- vault add --key OPENCLAW_GATEWAY_TOKEN --value 'your-token-here'
```

MemphisOS will inject `OPENCLAW_GATEWAY_TOKEN` into the OpenClaw install action automatically.
If needed for debugging, a directly exported `OPENCLAW_GATEWAY_TOKEN` still overrides the vault lookup.

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
