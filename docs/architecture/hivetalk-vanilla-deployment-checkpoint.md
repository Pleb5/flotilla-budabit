# HiveTalk Vanilla Deployment Checkpoint

## Status

Execution began on 2026-07-18. The public direct service was deployed and validated across desktop and mobile
networks on 2026-07-23. The embedded widget was validated and its BudaBit server default was published. Staged
capacity and long-duration testing remain outstanding.

## VPS Audit

| Item                     | Result                                                       |
| ------------------------ | ------------------------------------------------------------ |
| Host                     | `ubuntu-anchor-4gb-nbg1-1`                                   |
| Public IPv4              | `116.203.126.94`                                             |
| OS                       | Ubuntu 24.04.3 LTS                                           |
| Kernel after maintenance | `6.8.0-136-generic`                                          |
| CPU                      | 2 shared Intel Xeon vCPUs                                    |
| Memory                   | 3.7 GiB total, 3.2 GiB available at audit                    |
| Swap                     | None                                                         |
| Disk                     | 38 GiB root filesystem, 29 GiB free at audit                 |
| Existing proxy           | Nginx with Certbot                                           |
| Existing service         | `anchor.service`, proxied as `alerts.budabit.club`           |
| Anchor source state      | Clean `master` at `5ea53c6e503a17e053ee788385af195529aae275` |
| Cloud firewall           | None                                                         |
| Initial host firewall    | None                                                         |

The existing Anchor service binds port `4738` on all interfaces. Enabling UFW closed direct public access while
preserving access through Nginx on `alerts.budabit.club`.

## VPS Changes

- Created root-only backup `/root/backups/pre-hivetalk-20260718T112924Z`.
- Backup archive SHA-256: `1dc8a1ac04d29a55ac6d7e15bb0c38eb5d1c81a5f0257bbd048c17ffdc7edf35`.
- User declined a Hetzner snapshot.
- Installed pending system updates and rebooted from kernel `6.8.0-90` to `6.8.0-136`.
- Verified Nginx, SSH, Anchor, and `https://alerts.budabit.club` after the reboot.
- Enabled UFW with inbound TCP `22`, `80`, `443`, TCP `40000-40100`, and UDP `40000-40100`.
- Installed Ubuntu packages Docker `29.1.3`, Compose `2.40.3`, Buildx `0.30.1`, and containerd `2.2.1`.
- Cloned `https://github.com/Pleb5/hivetalksfu.git` to `/srv/hivetalk-vanilla`.
- Added `https://github.com/HiveTalk/hivetalksfu.git` as `upstream`.
- Confirmed `origin/main` and `upstream/main` were identical at `88efa79e239ad25d7ec9d0322310020d9c18cb42`.
- Deployed the clean `budabit-production` branch through Docker Compose using an external root-only environment.
- Published a DNS-only IPv4 `A` record for `calls.budabit.club`; no native `AAAA` record is present.
- Installed the tracked Nginx TLS reverse proxy without changing the existing Alerts virtual host.
- Issued a Let's Encrypt certificate for `calls.budabit.club`, valid through 2026-10-21.
- Verified the enabled twice-daily Certbot timer, staging renewal, deploy hook, Nginx validation, and automatic reload.

## Source Baseline

The public `budabit-production` branch is published at
`cdaffa92ab1c959f6a56e4bb350c2d8bd3a8c1c4`. The deployed application image is built from
`6810f80adee5a164e96509ad352145685d23d1fb`; the later commit changes only the tracked Nginx policy.
The production branch contains:

- Upstream PR `#164` commit `3820a5eb3ebcea9a244eea76cffe335e1d0d45f9`.
- Upstream PR `#165` commit `2bbf1e5a502491c225e92ca5f0f57f097da2885b`.
- Deterministic multi-stage Node 22 build using `npm ci` and the committed lockfile.
- A 189 MB non-root, read-only runtime image with bounded logs.
- A loopback-only HTTP backend with upstream development TLS keys excluded from the image.
- Host networking with application bind `127.0.0.1:3010` and explicit announced address `116.203.126.94`.
- Two mediasoup workers and TCP/UDP media range `40000-40100`.
- Disabled public room pages, REST API, recording, RTMP, zap goals, payments, AI, analytics, geolocation, and external notifications.
- Anonymous widget joins restricted to the `budabit-` room prefix.
- Socket.IO origin enforcement and one-room-per-socket resource controls.
- Server-side locked-room authorization before peer admission or media allocation.
- Presenter authority bound to server-side socket identity rather than client-supplied names.
- Query-secret log redaction, a pilot privacy notice, and an exact-revision AGPL source route.
- Tracked bootstrap and production Nginx configurations under `deploy/nginx`.
- Removal of the obsolete paid-lock announcement from the join flow.
- Production BudaBit iframe ancestors plus explicit localhost development ancestors.

## Verification Evidence

- Exact VPS image built from revision `6810f80adee5a164e96509ad352145685d23d1fb`.
- Unit suite: 51 passing.
- Production audit gate: zero findings after lockfile-compatible dependency updates.
- Runtime user: `node`.
- Local health endpoint: HTTP 204.
- Local listener: `127.0.0.1:3010` only.
- Locked-room protocol test denied media allocation before password acceptance and allowed it after acceptance.
- Socket test rejected an untrusted origin, rejected non-`budabit-` rooms, limited a socket to one room, rejected
  presenter-name spoofing, and cleaned abandoned empty rooms.
- Browser test joined anonymously with audio and video disabled without page errors.
- Two-browser test joined a password-protected room without invoking the removed payment flow.
- Bootstrap and final Nginx files passed `nginx -t` in Nginx 1.28.0.
- Reverse-proxy test returned the expected CSP, Permissions Policy, referrer policy, and no-sniff headers.
- Public HTTP redirects to HTTPS, and the public revision endpoint reports the exact deployed commit.
- Public certificate subject, issuer, and validity were verified; simulated renewal and deploy-hook execution passed.
- Desktop and mobile participants on separate networks exchanged audio and video successfully without TURN.
- Nginx, Anchor, and the Certbot timer remained active after deployment.
- The local BudaBit nested widget loaded `calls.budabit.club`, propagated permissions and a room password, connected
  two members with audio and video, and reconnected after leaving the outer widget iframe.
- Community Call widget release `0.1.1` at commit `111a3b1a1dff1af3309b955fef365a66d9d8d100` passed Svelte
  typechecking and its production Vite build.
- The signed GRASP repository state and `main` ref both resolve to widget commit `111a3b1a1dff1af3309b955fef365a66d9d8d100`.
- Widget artifact `9b8804fced7dfd9e7e6f36ffb15e04351f5e21ed32ebb3618c52c1611c53b404` is present on
  `blossom.budabit.club`.
- Kind `30033` event `0cea59c00b81f51445f96a7f6110db9c22f26771900dad7303713c2d943c646a` was verified on the
  BudaBit widget relay, `relay.damus.io`, and `nos.lol`.
- After applying widget `0.1.1`, a newly created call selected `calls.budabit.club` without an Advanced Settings
  override.
- Widget chat and screen-share start/stop were verified between participants.

## Remaining Gates

1. Inspect the selected ICE candidate and complete a 30-minute stability check.
2. Run staged 5, 10, 15, and 20 participant capacity tests.
3. Configure public health and resource alerts before broader rollout.

## Residual Risks

- TURN remains deferred, so restrictive networks may fail until coturn is added.
- The room UI still loads pinned libraries from third-party CDNs; the pilot privacy notice discloses this.
- The deprecated `fluent-ffmpeg` package remains installed by upstream code, although RTMP is disabled.
- The selected shared-CPU VPS is not guaranteed to sustain 20 simultaneous HD cameras.
- The deployment is single-host and active calls end on host, proxy, container, or network failure.
