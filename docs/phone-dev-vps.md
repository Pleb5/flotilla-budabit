# Phone Testing via VPS Tunnel

This guide exposes your local Budabit dev server to a phone browser through a VPS, while keeping the app itself running on your laptop.

It also adds remote browser debugging (console/network) using Chii.

## Topology

- Laptop runs Budabit: `pnpm dev` (`localhost:1847`)
- SSH reverse tunnel publishes laptop dev server on VPS localhost: `127.0.0.1:31847`
- Caddy serves HTTPS endpoints on VPS:
  - `budabit-dev.example.com` -> `127.0.0.1:31847`
  - `budabit-debug.example.com` -> `127.0.0.1:9222` (Chii)

## 1) DNS

Create A/AAAA records for:

- `budabit-dev.example.com`
- `budabit-debug.example.com`

Point both to your VPS public IP.

## 2) VPS: install Caddy and Chii

```bash
sudo apt update
sudo apt install -y caddy npm
sudo npm install -g chii
```

## 3) VPS: Caddy config

Create `/etc/caddy/Caddyfile` entries for both subdomains (or merge into your existing file):

```caddyfile
budabit-dev.example.com {
  basicauth {
    dev $2a$14$REPLACE_WITH_BCRYPT_HASH
  }

  reverse_proxy 127.0.0.1:31847
}

budabit-debug.example.com {
  basicauth {
    dev $2a$14$REPLACE_WITH_BCRYPT_HASH
  }

  reverse_proxy 127.0.0.1:9222
}
```

Generate hash for `basicauth` password:

```bash
caddy hash-password --plaintext 'change-me'
```

Apply config:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 4) VPS: run Chii as a service

Create `/etc/systemd/system/chii.service`:

```ini
[Unit]
Description=Chii remote debugging server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env chii start -p 9222 -d budabit-debug.example.com
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chii
sudo systemctl status chii
```

## 5) Laptop: dedicated tunnel key (no passphrase)

Create a dedicated key that systemd can use unattended:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/ocmux_tunnel_auto -N ""
```

Add the new public key to `/home/ocjump/.ssh/authorized_keys` on VPS.

## 6) Laptop: tunnel setup

Vite is commonly bound to IPv6 loopback (`[::1]`), so use `localhost:1847` as the tunnel target.

Option A: plain SSH config

```sshconfig
Host my-vps
  HostName your.vps.ip.or.name
  User ubuntu
  IdentityFile ~/.ssh/your_key
  ExitOnForwardFailure yes
  ServerAliveInterval 30
  ServerAliveCountMax 3
  RemoteForward 127.0.0.1:31847 localhost:1847
```

Then run or restart your existing tunnel process:

```bash
ssh -N my-vps
```

Option B: ocmux profile (if you already use ocmux)

Create `~/.config/opencode/ocmux-tunnels/budabit.conf`:

```ini
jump_host=178.104.89.98
jump_user=ocjump
jump_port=22
bind_addr=127.0.0.1
remote_port=31847
local_host=localhost
local_port=1847
key_path=/home/<you>/.ssh/ocmux_tunnel_auto
target_user=<you>
```

Start the profile:

```bash
ocmux tunnel start budabit
ocmux tunnel status
```

Option C: persistent user services (recommended)

Create `~/.config/systemd/user/ocmux-tunnel-default.service`:

```ini
[Unit]
Description=OpenCode reverse SSH tunnel (default)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -NT -i %h/.ssh/ocmux_tunnel_auto -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes -o StrictHostKeyChecking=accept-new -R 127.0.0.1:22022:127.0.0.1:22 ocjump@178.104.89.98
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Create `~/.config/systemd/user/ocmux-tunnel-budabit.service`:

```ini
[Unit]
Description=OpenCode reverse SSH tunnel (budabit dev)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -NT -i %h/.ssh/ocmux_tunnel_auto -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes -o StrictHostKeyChecking=accept-new -R 127.0.0.1:31847:localhost:1847 ocjump@178.104.89.98
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ocmux-tunnel-default.service
systemctl --user enable --now ocmux-tunnel-budabit.service
systemctl --user status ocmux-tunnel-default.service
systemctl --user status ocmux-tunnel-budabit.service
```

Optional shell-only SSH alias to avoid tunnel collisions:

```sshconfig
Host ocmux-shell
  HostName 178.104.89.98
  User root
  IdentityFile ~/.ssh/ocmux_tunnel
  IdentitiesOnly yes
  ClearAllForwardings yes
```

## 7) Local project env

Set these in `.env` on your laptop to permit proxied host and stable HMR:

```env
VITE_DEV_ALLOWED_HOSTS=budabit-dev.example.com
VITE_DEV_HMR_PROTOCOL=wss
VITE_DEV_HMR_HOST=budabit-dev.example.com
VITE_DEV_HMR_CLIENT_PORT=443
VITE_DEV_CHII_TARGET_URL=https://budabit-debug.example.com/target.js
```

Start dev server:

```bash
pnpm dev
```

## 8) Verify app from phone

Open:

- `https://budabit-dev.example.com`

If HMR does not reconnect, confirm the HMR env values and that your proxy allows websocket upgrades.

## 9) Remote console/network debugging from phone

Recommended flow (no bookmarklet needed):

1. On phone, open `https://budabit-debug.example.com` once and complete basic auth
2. Open `https://budabit-dev.example.com/?chii=1`
3. On desktop/laptop, open `https://budabit-debug.example.com` and click Inspect on the phone target row

Disable auto-injection later with `https://budabit-dev.example.com/?chii=0`.

Bookmarklet fallback:

On phone, open Budabit page and inject Chii target script via bookmarklet:

```javascript
javascript:(function(){var s=document.createElement('script');s.src='https://budabit-debug.example.com/target.js';document.body.appendChild(s)})();
```

On desktop/laptop, open:

- `https://budabit-debug.example.com`

Select your phone page and inspect console/network/elements live.

## Notes

- Keep Budabit dev server bound to localhost; do not expose `1847` directly on the internet.
- This setup does not replace your existing tmux/opencode tunnel; it adds separate subdomains and ports.
- If your VPS already uses a different reverse proxy, translate the same upstream mapping there instead of Caddy.
- If SSH forwards fail for `ocjump`, ensure SSHD permits both ports via `PermitListen 127.0.0.1:22022 127.0.0.1:31847`.
