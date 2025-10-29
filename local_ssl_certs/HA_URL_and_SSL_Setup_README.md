# Home Assistant URL Access and Local SSL Setup

## Overview
This setup provides a clean, secure way to reach Home Assistant (HA) both **inside** and **outside** your network using a single domain:

| Context | URL | Behavior |
|----------|-----|-----------|
| **Inside LAN** | https://art-manager.ancwbfw.com | Resolved by UniFi DNS → NGINX Proxy Manager → Home Assistant via local SSL |
| **Outside LAN** | https://art-manager.ancwbfw.com | GoDaddy forwards (302) → Nabu Casa remote URL |

The same URL therefore “just works” at home and remotely.

## Architecture Summary
```
┌──────────────┐        (LAN DNS override)
│  Laptop      │  art-manager.ancwbfw.com → 192.168.x.x
└─────┬────────┘
      │ HTTPS
┌─────▼─────────────────────┐
│ NGINX Proxy Manager (HAOS)│  Terminate TLS using mkcert cert
│  - 302 → /e2a3b0cb_frame_art_manager │
│  - Proxies to homeassistant:8123     │
└─────┬─────────────────────┘
      ▼
┌──────────────┐
│ Home Assistant│
└──────────────┘
```
Off-LAN: GoDaddy DNS + forwarding sends traffic to  
https://kmxagapau1yzoflurif8li6nmfqbzeje.ui.nabu.casa/e2a3b0cb_frame_art_manager.

## Components
- **GoDaddy DNS / Forwarding** – Handles public access with a *temporary (302)* redirect to Nabu Casa.
- **UniFi Local DNS Override** – Maps the same hostname to the HA IP for LAN users.
- **NGINX Proxy Manager Add-on** – Provides internal reverse-proxy, HTTPS termination, and redirect to the HA subpath.
- **mkcert** – Generates a locally-trusted certificate for the LAN domain.

## SSL and Certificates

| File | Purpose | Git policy |
|-------|----------|------------|
| art-manager.ancwbfw.com.pem | Public server certificate | ✅ Commit OK |
| art-manager.ancwbfw.com-key.pem | Private key used by NPM | ❌ Never commit |
| rootCA.pem | Public mkcert CA (trust on other devices) | ✅ Commit OK |
| rootCA-key.pem | mkcert CA private key | ❌ Never commit |

## How Local HTTPS Works
- The mkcert CA is installed and trusted on each LAN device.
- NGINX Proxy Manager uses the mkcert-issued cert to terminate HTTPS.
- Browsers see a valid padlock when connecting to https://art-manager.ancwbfw.com.
- Internally, NGINX proxies unencrypted traffic to homeassistant:8123.

## Security Model
| Scope | Risk | Mitigation |
|--------|------|-------------|
| **Public Internet** | None—HA not exposed externally | GoDaddy only redirects to Nabu Casa |
| **Local LAN** | Low risk of key exposure; could allow impersonation if attacker already on LAN | Keep private key off GitHub; store in 1Password |
| **Data in GitHub** | GitHub auto-scans for keys | Only commit public certs / scripts |

**Private key storage:** keep in 1Password (or any password manager) as an attached file or secure note.  
**Never push private keys or mkcert CA keys to Git.**

## Trusted-Device Setup
### macOS
```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain rootCA.pem
```

### iOS / iPadOS
1. Convert: `openssl x509 -in rootCA.pem -outform der -out rootCA.cer`
2. AirDrop/email rootCA.cer to device
3. Settings → Profile Downloaded → Install
4. Settings → General → About → Certificate Trust Settings → Enable Full Trust

## Maintenance
- **Renew local cert** anytime via  
  ```bash
  mkcert art-manager.ancwbfw.com
  ```
- **Re-upload** to NGINX Proxy Manager → select new cert → restart add-on.
- **No public renewal needed**—Nabu Casa manages its own certs.

## Summary
You now have:
- Split-horizon DNS for a unified HA domain
- Seamless LAN vs. WAN routing
- Local HTTPS with mkcert-trusted certs
- Secure handling of private keys outside Git
- GitHub limited to public certs + trust-install scripts
