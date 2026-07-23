# BudaBit HiveTalk Vanilla Deployment Plan

## Goal

Build and deploy a BudaBit-operated HiveTalk Vanilla instance at `https://calls.budabit.club` on `ubuntu-anchor-4gb-nbg1-1`, while preserving the existing anchor notification service and maintaining compatibility with the current Community Call widget.

The target system design is documented in `docs/architecture/hivetalk-vanilla-architecture.md`.

## Execution Rules

- Run the deployment as a sequence of reviewed command sessions, not one unattended script.
- Begin every phase by reading this plan and the architecture document.
- Stop before any destructive command, firewall replacement, DNS cutover, or existing-service restart.
- Do not modify or restart the anchor notification service unless a reviewed integration step requires it.
- Do not expose HiveTalk publicly until dependency fixes, tests, configuration hardening, and local health checks pass.
- Do not store credentials, room passwords, private keys, or tokens in Git or shell history.
- Deploy only a clean committed production revision.
- Record verification evidence and deviations in a deployment checkpoint document when execution begins.

## Fixed Decisions

| Decision           | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| VPS                | `ubuntu-anchor-4gb-nbg1-1`                                |
| Hostname           | `calls.budabit.club`                                      |
| Source ownership   | Public BudaBit fork                                       |
| Runtime            | Docker Compose, local source build, Linux host networking |
| Pilot access       | Anonymous widget-compatible joins                         |
| TURN               | Deferred until testing                                    |
| Maximum pilot room | 20 participants                                           |

## Phase 1: Read-Only VPS Audit

### Purpose

Identify the existing operating environment and prove there is sufficient capacity without changing the server.

### Checks

- OS version, architecture, kernel, uptime, and pending reboot state.
- CPU count, CPU model, load, and recent Hetzner CPU graphs.
- Available RAM, swap use, disk use, inode use, and filesystem layout.
- Listening TCP and UDP ports.
- Running systemd services and containers.
- Docker Engine and Docker Compose availability and versions.
- Reverse proxy ownership of ports 80 and 443.
- Current Caddy, Nginx, Traefik, Apache, or container proxy configuration.
- Host firewall, Docker firewall behavior, and Hetzner Cloud Firewall attachment.
- Anchor notification-service process, container, files, environment, and restart mechanism.
- Existing backup and monitoring configuration.

### Expected command families

```bash
uname -a
lsb_release -a
nproc
lscpu
free -h
swapon --show
df -h
df -i
ss -lntup
systemctl --type=service --state=running
docker version
docker compose version
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
```

Firewall and proxy commands will be selected only after identifying the installed tools.

### Gate

Proceed only if:

- At least 2 GB RAM is normally available.
- At least 15 GB disk is free.
- Baseline CPU is comfortably below 20 percent.
- Ports 3010 and `40000-40100` are available.
- The reverse proxy can add `calls.budabit.club` without disrupting existing hosts.
- The anchor service has a known recovery and restart path.

## Phase 2: Back Up Existing State

### Actions

- Export or copy the active reverse-proxy configuration.
- Record current firewall and container state.
- Back up the anchor service's deployment configuration and environment without displaying secrets.
- Create a Hetzner snapshot if the current disk state is not otherwise reproducible.
- Confirm a rollback path before package installation or network changes.

### Gate

Proceed only after the current service can be restored without relying on memory or undocumented commands.

## Phase 3: Create And Clone The BudaBit Fork

### Repository preparation

1. Create a public fork of `HiveTalk/hivetalksfu` under the BudaBit GitHub owner.
2. Clone the fork into `/srv/hivetalk-vanilla` using a non-root deployment account where practical.
3. Add `https://github.com/HiveTalk/hivetalksfu.git` as the `upstream` remote.
4. Create a `budabit-production` branch from the reviewed upstream commit.
5. Record the upstream commit SHA in the deployment checkpoint.
6. Configure a write-enabled deploy key limited to this repository only if VPS-side pushes are required.

### Source workflow

- `origin/budabit-production` is the deployed branch.
- Upstream changes enter through explicit reviewed merges.
- Production builds require an empty `git status --porcelain` result.
- Production releases receive a BudaBit tag that identifies the deployed revision.

## Phase 4: Apply The BudaBit Baseline Patch

### Dependency and build fixes

- Apply the lockfile changes from upstream PR `#164` for the `ws`, `engine.io`, and `socket.io-adapter` memory-exhaustion fix.
- Apply the lockfile changes from upstream PR `#165` for `form-data`.
- Change the Dockerfile to copy `package-lock.json` and install with `npm ci`.
- Use an image name owned by BudaBit and tag images with the Git SHA.
- Add a health check and bounded Docker log rotation.
- Avoid the repository's interactive `install.sh` and the external `mirotalk/sfu:latest` image.

### Product hardening

- Make the upstream zap-goal middleware disabled by default and disable it for BudaBit.
- Disable the paid ZBD room-lock path and its UI for the pilot.
- Disable server recording, RTMP, AI integrations, geolocation, analytics, advertising, Sentry, bots, and email.
- Disable REST API operations and rotate all default API and JWT secrets anyway.
- Set debug logging to false.
- Change upstream absolute URLs and Open Graph values to `calls.budabit.club`.
- Block or replace upstream-owned `.well-known` Nostr and LNURL files.
- Add BudaBit source attribution and a truthful pilot privacy notice.
- Preserve the AGPLv3 license and upstream attribution.

### Deployment assets

- Add a tracked BudaBit Compose file.
- Add a tracked non-secret BudaBit configuration that reads required secrets from environment variables.
- Add an ignored external environment-file example.
- Keep the real environment under `/etc/hivetalk-vanilla` with mode `0600`.
- Configure two mediasoup workers and an explicit public IPv4 announced address.
- Keep the media range at TCP and UDP `40000-40100`.
- Use host networking, bind the application to `127.0.0.1:3010`, and let UFW control the media range.

## Phase 5: Verify Source Before Exposure

### Checks

- Install exactly locked dependencies in an isolated build context.
- Run the repository unit tests.
- Run `npm audit --omit=dev` and review every production finding.
- Fail the image build for high- or critical-severity production findings.
- Build the Docker image from source.
- Inspect the resulting image metadata and size.
- Start the application without public DNS routing.
- Verify a local health endpoint, `/brand`, static assets, and a sample `/join` response.
- Verify clean shutdown, restart, and bounded logs.
- Confirm the anchor service remains healthy during build and runtime.

### Gate

Do not expose the service if tests fail, a relevant high-severity production vulnerability remains, mediasoup cannot bind its ports, or the existing anchor service degrades.

## Phase 6: Configure Reverse Proxy And Abuse Controls

The exact configuration depends on the proxy discovered in Phase 1.

### Required proxy behavior

- Terminate TLS for `calls.budabit.club`.
- Proxy HTTP and Socket.IO WebSocket upgrades to local port 3010.
- Use long enough WebSocket read and send timeouts for calls.
- Keep local port 3010 unavailable from the public network.
- Do not emit framing headers that block the nested widget iframe.
- Omit query strings from access logs so room passwords are not logged.
- Apply request and connection limits that permit at least 20 users behind one NAT address.
- Block `/active`, `/newroom`, `/api/v1`, `/api/zapgoal`, `/zapgoal`, and `/rtmp`.
- Block upstream `.well-known` records until BudaBit-owned replacements exist.
- Restrict direct-join room names to the expected `budabit-` prefix where this does not break the widget flow.
- Enforce the same origin and room-prefix controls in Socket.IO rather than relying only on Nginx or HTTP routes.

### Verification

- Validate the proxy configuration before reload.
- Reload rather than restart when the installed proxy supports it.
- Verify all existing virtual hosts immediately after reload.
- Verify the blocked paths and query-free logging behavior.

## Phase 7: Configure DNS And Firewalls

### DNS

- Create an IPv4 `A` record for `calls.budabit.club` with a 300-second rollout TTL.
- Use DNS-only mode rather than a CDN proxy.
- Do not publish an `AAAA` record during the initial rollout.
- Confirm public DNS resolution before requesting the certificate.

### Firewall

- Preserve the existing SSH access policy.
- Permit public TCP ports 80 and 443.
- Permit public UDP ports `40000-40100`.
- Permit public TCP ports `40000-40100` as media fallback.
- Keep TCP port 3010 private.
- Apply equivalent rules in the Hetzner Cloud Firewall and host firewall where both are used.

### Gate

Verify that existing hosts and the anchor service remain reachable before continuing.

## Phase 8: Direct Functional Test

Use at least two participants on different networks.

### Test cases

- Direct join URL returns the HiveTalk room.
- Audio works in both directions.
- Video works in both directions.
- Camera and microphone permission prompts work.
- Screen sharing starts and stops.
- Chat works.
- Room password behavior works.
- Leave and rejoin works.
- WebSocket reconnection works after a brief network interruption.
- A 30-minute call does not show increasing memory or restart counts.
- Public active rooms and room creation remain blocked.

### Evidence

Record the deployed commit SHA, image tag, browser versions, networks used, selected ICE candidate types, CPU, memory, and egress.

## Phase 9: Embedded Widget Test

Start a new Community Call through the current widget and enter this server in Advanced Settings:

```text
https://calls.budabit.club
```

### Test cases

- The nested iframe loads instead of showing only the widget frame background.
- The top-level BudaBit host and widget iframe propagate camera and microphone permissions.
- The generated `/join` parameters are accepted unchanged.
- Two community members reach the same room.
- The moderator joins first and receives presenter controls.
- Copy-link behavior uses the BudaBit hostname.
- Leaving the iframe and rejoining works.

No widget default changes are made until this phase passes.

## Phase 10: Staged Capacity Test

Run staged calls with 5, 10, 15, and 20 participants.

### Monitor

- Individual mediasoup worker CPU.
- Aggregate VPS CPU and load.
- Container and host memory.
- Swap activity.
- Network ingress and egress.
- WebRTC quality, packet loss, and reconnects.
- Anchor notification-service health.

### Acceptance thresholds

- No worker remains above roughly 80-85 percent CPU.
- Total memory remains below roughly 3 GB.
- No active swapping occurs during calls.
- Audio remains intelligible and stable.
- Video degrades adaptively rather than disconnecting.
- The anchor service remains responsive.
- A typical 20-person call works with a limited number of active cameras.

Twenty simultaneous HD cameras are a stress test. Failure in that mode alone does not fail the small-community pilot, but it establishes the upgrade boundary.

## Phase 11: Pilot Rollout

- Document that moderators must select `calls.budabit.club` in Advanced Settings.
- Require a room password during the anonymous pilot as an operating policy.
- Require the moderator to join before sharing the call broadly.
- Enable public HTTPS, container, CPU, memory, disk, and egress monitoring.
- Enable Hetzner traffic and billing alerts.
- Retain the previous two commit-tagged images.
- Schedule upstream dependency review and maintenance restarts.

## Phase 12: Widget And Security Follow-Up

After successful pilot validation:

1. Change the widget default from the unavailable upstream Vanilla host to `https://calls.budabit.club`.
2. Publish and verify the updated widget.
3. Design short-lived JWT joins bound to community, room, viewer, and presenter role.
4. Remove anonymous arbitrary room creation after JWT support ships.
5. Add coturn if mobile, corporate, or restrictive-network tests fail.
6. Review which Nostr-specific HiveTalk features should be enabled.

## Rollback

Rollback is required if public health checks fail, existing services regress, media cannot connect reliably, or the container repeatedly restarts.

Rollback procedure:

1. Stop routing `calls.budabit.club` to the failing container.
2. Restore the prior reverse-proxy and firewall configuration if those changes caused the failure.
3. Start the previous commit-tagged image and configuration if the regression is application-specific.
4. Verify all pre-existing VPS services.
5. Remove or revert DNS only after preserving evidence needed for diagnosis.
6. Document the failed revision, logs, resource state, and recovery result.

No database rollback is necessary because pilot rooms are ephemeral.

## Final Acceptance Criteria

- `https://calls.budabit.club/join?...` loads over valid TLS.
- The service works through the nested BudaBit widget iframe.
- WebSocket signaling and UDP media work across separate networks.
- TCP media fallback is available.
- Public room listing, general creation, funding, RTMP, recording, and unused APIs are disabled or blocked.
- Query strings containing room passwords are absent from server access logs.
- No real secrets or upstream-owned `.well-known` identities are published from the BudaBit host.
- Source, deployment files, applied security patches, and AGPL notices are public in the BudaBit fork.
- The deployed image maps to a clean Git commit and has a tested rollback image.
- A staged 20-person typical call meets the resource and quality thresholds.
- The anchor notification service remains healthy throughout deployment and testing.
