# BudaBit HiveTalk Vanilla Architecture

## Purpose

This document defines the target architecture for a BudaBit-operated HiveTalk Vanilla instance. The initial deployment supports occasional community calls with at most 20 participants and remains compatible with the existing Community Call widget's direct `/join` URL.

The first deployment target is:

| Property             | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| Public hostname      | `calls.budabit.club`                                              |
| VPS                  | `ubuntu-anchor-4gb-nbg1-1`                                        |
| VPS class            | Hetzner CX23, shared CPU                                          |
| Capacity             | 2 vCPU, 4 GB RAM, 40 GB disk                                      |
| Included egress      | 20 TB per month                                                   |
| Source               | Public BudaBit fork of `HiveTalk/hivetalksfu`                     |
| Runtime              | Docker Compose image built from source with Linux host networking |
| Initial access model | Anonymous direct joins with pilot hardening                       |
| TURN                 | Deferred until connectivity testing demonstrates a need           |

## Scope

The pilot provides:

- Embedded audio and video calls.
- Screen sharing.
- Basic chat and participant controls.
- Optional room passwords supplied by the widget.
- Source-controlled BudaBit configuration and branding.
- Reproducible builds and commit-based rollback.

The pilot does not provide:

- Signed BudaBit membership tokens.
- A general public room-creation service.
- Public active-room discovery.
- Server-side recording or RTMP streaming.
- AI, geolocation, analytics, advertising, or upstream funding gates.
- Guaranteed connectivity through networks that require TURN.
- High availability or horizontal scaling.

## Topology

```text
                         HTTPS application traffic
+------------------+    and WebSocket signaling     +-----------------------+
| BudaBit web app  | ------------------------------> | calls.budabit.club:443 |
| and call widget  |                                 +-----------+-----------+
+------------------+                                             |
                                                                 | TLS termination
                                                                 | and reverse proxy
                                                                 v
                                                     +-----------------------+
                                                     | HiveTalk container    |
                                                     | local port 3010       |
                                                     +-----------+-----------+
                                                                 |
                                                                 | mediasoup workers
                                                                 v
                                                     +-----------------------+
                                                     | 2 shared VPS vCPUs    |
                                                     +-----------------------+

Participant browsers ----------------------------------------------+
       UDP/TCP media to VPS ports 40000-40100                       |
                                                                   v
                                                     +-----------------------+
                                                     | mediasoup transports  |
                                                     +-----------------------+
```

The widget itself is hosted in a BudaBit-controlled iframe and creates a nested iframe for `calls.budabit.club`. The HiveTalk response must therefore permit framing and must not emit `X-Frame-Options: DENY` or an incompatible Content Security Policy `frame-ancestors` directive.

The container uses host networking to avoid creating a Docker forwarding rule for every media port. HiveTalk binds its application listener to `127.0.0.1:3010`, while mediasoup binds the host's TCP and UDP media range directly. UFW is therefore the network enforcement boundary for media exposure.

## Request And Media Paths

Application and signaling traffic follows this path:

1. A member opens the BudaBit Community Call widget.
2. The widget embeds `https://calls.budabit.club/join?...`.
3. The reverse proxy terminates public TLS on port 443.
4. The proxy forwards HTTP and Socket.IO WebSocket traffic to the HiveTalk service on local port 3010.
5. HiveTalk creates or joins the named mediasoup room.

Media traffic follows a separate path:

1. HiveTalk returns ICE candidates containing the VPS public IPv4 address.
2. Browsers connect directly to mediasoup over UDP ports `40000-40100` when possible.
3. Browsers fall back to TCP in the same port range when UDP is unavailable.
4. A later coturn deployment may relay media for networks that cannot reach either path.

The application hostname must remain DNS-only. A conventional HTTP CDN or proxy cannot carry the mediasoup UDP path.

## Network Exposure

|        Port | Protocol | Exposure                                  | Purpose                            |
| ----------: | -------- | ----------------------------------------- | ---------------------------------- |
|          22 | TCP      | Existing restricted administration policy | SSH                                |
|          80 | TCP      | Public                                    | ACME validation and HTTPS redirect |
|         443 | TCP      | Public                                    | HTTPS and WebSocket signaling      |
|        3010 | TCP      | Local only                                | HiveTalk application upstream      |
| 40000-40100 | UDP      | Public                                    | Preferred WebRTC media             |
| 40000-40100 | TCP      | Public                                    | WebRTC media fallback              |

The initial DNS configuration publishes only an IPv4 `A` record. IPv6 is added only after its ICE candidates and firewall behavior have been tested end to end.

## Source And Runtime Layout

The expected VPS layout is:

```text
/srv/hivetalk-vanilla/               Public BudaBit Git checkout
/srv/hivetalk-vanilla/docker-compose.yml   Tracked deployment definition
/srv/hivetalk-vanilla/deploy/        Tracked non-secret deployment assets
/etc/hivetalk-vanilla/hivetalk.env   Runtime secrets, mode 0600
/srv/hivetalk-vanilla/app/src/config.js    Tracked non-secret runtime configuration
```

Git remotes are:

| Remote     | Purpose                                       |
| ---------- | --------------------------------------------- |
| `origin`   | Public BudaBit fork and production branch     |
| `upstream` | `https://github.com/HiveTalk/hivetalksfu.git` |

Production runs only from a clean committed revision. Images are tagged with the Git commit SHA, and at least the previous two images remain available for rollback.

## Build Model

The image is built on the selected VPS from the checked-out source. The BudaBit Dockerfile must:

- Copy both `package.json` and `package-lock.json`.
- Install dependencies with `npm ci`.
- Build the pinned mediasoup worker required by the HiveTalk fork.
- Use a pinned Node 22 image compatible with all locked dependency engine requirements.
- Copy application and public assets only after dependency installation.
- Avoid pulling or tagging an unrelated `mirotalk/sfu:latest` image.
- Run as the unprivileged `node` user with a read-only root filesystem.

The first build is CPU-intensive because mediasoup may compile native code. Later source-only changes should reuse Docker's dependency layers.

## Application Configuration

The production configuration is source-controlled where it is non-secret and reads secrets from the external environment file.

| Capability                        | Initial setting                   |
| --------------------------------- | --------------------------------- |
| Anonymous direct `/join`          | Enabled                           |
| Host protection and OIDC          | Disabled                          |
| Public active-room listing        | Blocked at proxy                  |
| Public `/newroom` page            | Blocked at proxy                  |
| REST API                          | Disabled and blocked at proxy     |
| Recording                         | Disabled                          |
| RTMP and FFmpeg streaming         | Disabled                          |
| ChatGPT and VideoAI               | Disabled                          |
| Sentry and analytics              | Disabled                          |
| Email, Slack, Discord, Mattermost | Disabled                          |
| Geolocation                       | Disabled                          |
| Paid room locking                 | Disabled                          |
| Upstream zap-goal gate            | Disabled                          |
| mediasoup workers                 | 2                                 |
| Maximum incoming bitrate          | 1.5 Mbps                          |
| Debug logging                     | Disabled                          |
| CORS origin                       | `https://calls.budabit.club`      |
| Socket.IO origin allowlist        | `https://calls.budabit.club` only |
| Accepted room prefix              | `budabit-`                        |

The server's announced media address is configured explicitly. It must not depend on public IP autodetection from inside a container.

## Security And Trust Model

### Pilot Access

The current widget does not issue HiveTalk JWTs. The pilot therefore allows anonymous direct joins so that the existing widget works without a code change.

Pilot controls are:

- Block public active-room and room-creation pages.
- Restrict both HTTP and Socket.IO room creation to the widget's `budabit-` prefix.
- Require server-side password authorization before a locked guest becomes a room peer or can allocate media transports.
- Apply generous request and WebSocket connection limits that still allow 20 users behind one NAT address.
- Encourage a room password for every call.
- Require the moderator to join first because Vanilla grants presenter status to the first participant.
- Alert on abnormal traffic and cost growth.

These controls reduce accidental discovery and simple abuse but are not authorization. An attacker can imitate a room prefix and consume server resources. Signed membership-bound JWTs are the target security model after the pilot.

### Logging

Room passwords are present in the direct-join query string. Reverse-proxy access logs must omit query strings, and HiveTalk debug logging must remain disabled. Runtime secrets must never be written to Git or command history.

### Public Metadata

The upstream repository contains HiveTalk-controlled Nostr and LNURL records under `public/.well-known`. The BudaBit host must block or replace them rather than publish upstream identities beneath `budabit.club`.

### Supply Chain

The public service must not deploy known high- or critical-severity dependency findings. The BudaBit fork applies
the WebSocket dependency fix from upstream PR `#164` and the `form-data` update from PR `#165`, then runs tests and
a production dependency audit. Lockfile-compatible security updates are reviewed and committed when new advisories
appear. The deployed production lock currently audits with zero findings.

## Capacity Model

HiveTalk uses mediasoup as an SFU. It forwards encoded RTP rather than transcoding every stream, which keeps memory and CPU requirements moderate. A room normally belongs to one mediasoup worker and therefore one CPU core.

For a 20-person room:

| Usage                            | Approximate consumers |
| -------------------------------- | --------------------: |
| All participants receiving audio |                   380 |
| Audio plus 5 active cameras      |                   475 |
| Audio plus 10 active cameras     |                   570 |
| Audio plus 20 active cameras     |                   760 |

The selected CX23 is suitable for the pilot with a limited number of simultaneous cameras. Twenty simultaneous HD cameras are a load-test target, not a guaranteed operating mode. A single saturated media worker may appear as only about 50 percent aggregate CPU on a two-vCPU server, so monitoring must include individual worker processes.

Expected egress for a one-hour, 20-person call ranges from roughly 40 GB with a few SD cameras to roughly 320 GB in a conservative all-HD estimate. Occasional calls remain comfortably inside the included 20 TB monthly egress.

## Availability And Recovery

The pilot is a single-host service. VPS, reverse-proxy, container, or network failure ends active calls. Rooms are ephemeral and do not require a database restore.

Recovery assets are:

- Public BudaBit source and production tags.
- External runtime configuration and secrets backup.
- Reverse-proxy and firewall configuration backup.
- Commit-tagged current and previous container images.
- A root-only pre-deployment configuration backup; the operator declined a Hetzner snapshot.

Rollback checks out the prior production tag, starts its corresponding image, verifies local health, and then verifies the public direct-join URL.

## Observability

Initial monitoring covers:

- Public HTTPS health.
- Container restart count and logs.
- Aggregate and per-worker CPU.
- Memory, swap, and disk use.
- Network egress and Hetzner billing alerts.
- WebRTC connection quality during staged load tests.
- Response health of the existing anchor notification service.
- Certbot timer status, renewal logs, certificate expiry, and Nginx deploy-hook results.

Container logs use bounded rotation. Recording and RTMP directories are not mounted in the pilot.

## Evolution

The Community Call widget now defaults to `https://calls.budabit.club`. The remaining intended sequence is:

1. Add signed, short-lived JWT joins bound to BudaBit community membership and room identity.
2. Add coturn if restrictive-network tests fail.
3. Review and selectively enable Nostr-specific HiveTalk features.
4. Move to stronger dedicated CPU if one-room load tests saturate a shared vCPU.
5. Add a second SFU host only when usage requires room-level distribution or failover.
