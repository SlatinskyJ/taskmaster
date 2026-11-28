# Demo host: auto-deploy and nightly reset

The public demo runs the production image with `TASKMASTER_ENV=demo` (spec
`docs/superpowers/specs/2026-11-27-demo-environment-design.md`). Every green push to `main` ends
with CI job `deploy demo`, right after `deploy prod`, and a host timer throws the demo data away
every night at 03:00 Prague. This runbook is generic on purpose: host names, addresses, ports and
container limits live in private notes, never in the repo.

## How it works

- `deploy`'s login shell on the demo host is [`deploy/demo/tm-demo`](../../deploy/demo/tm-demo).
  It hands `deploy <sha7>` and `status` to the production controller
  [`deploy/prod/tm-prod`](../../deploy/prod/tm-prod), installed next to it (same pull, backup,
  restart and rollback as production), and adds `reset`. The production host never gets
  `tm-demo`, so nothing there can wipe the family's data.
- `reset` takes the same lock as `tm-prod deploy` (`~deploy/.tm-prod.lock`), so a reset and a
  deploy never overlap: one waits for the other (up to 5 minutes). It removes the app container,
  deletes the data volume `taskmaster_tm-data` and starts the same pinned image again. The server
  migrates and seeds the empty DB on boot with fresh dates, and everyone is logged out. If the app
  is not healthy within 90 s, `reset` fails and keeps the app log in
  `~deploy/logs/reset-<time>.log` (never in the timer or CI log).
- If the volume cannot be removed (for example it is still in use), `reset` starts the app again
  on the old data and fails. A missing volume is fine: it starts on an empty one.
- `tm-demo-reset.timer` runs `tm-demo reset` at 03:00 Prague. A run missed while the host was
  down is not made up later.
- `deploy demo` needs `deploy prod`: when production rejects a build or is skipped, the demo keeps
  its image. It never blocks or rolls back production. It runs only when the repository variable
  `DEMO_HOST` (the demo container's tailnet name) is set; unset it to pause demo deploys. It is not
  a required check.
- A failed `deploy demo` turns the `main` run red, so red-main emails "main is broken" although
  production deployed. Check which job failed before you look for a broken build.

## Tailnet policy

```jsonc
"tagOwners": {"tag:tm-cd-demo": ["autogroup:owner"], "tag:tm-demo": ["autogroup:owner"]},
"grants": [{"src": ["tag:tm-cd-demo"], "dst": ["tag:tm-demo"], "ip": ["tcp:22"]}],
"ssh": [{"action": "accept", "src": ["tag:tm-cd-demo"], "dst": ["tag:tm-demo"], "users": ["deploy"]}],
"tests": [
  {"src": "tag:tm-cd-demo", "accept": ["tag:tm-demo:22"], "deny": ["tag:tm-demo:3000", "tag:tm-prod:22", "tag:tm-preview:22"]},
  {"src": "tag:tm-cd-prod", "deny": ["tag:tm-demo:22"]},
],
```

## GitHub (once)

1. Tailscale admin console → Settings → OAuth clients → new client with scope `auth_keys`
   (write) limited to tag `tag:tm-cd-demo`.
2. Repository → Settings → Environments → `demo`: deployment branches **Selected branches:
   `main`**. Add the environment secrets `TS_DEMO_OAUTH_CLIENT_ID` and `TS_DEMO_OAUTH_SECRET`
   there, not as repository secrets.
3. Repository variable `DEMO_HOST` = the demo container's tailnet name.

## Host setup (once)

The demo gets its own Incus container, tagged `tag:tm-demo` on the tailnet, with hard CPU,
memory, process and disk limits (values in private notes), so it cannot slow production down.
Inside it, Docker and Compose run the app from `/opt/taskmaster` exactly as on production
([prod-host.md](prod-host.md), Host setup), with `.env`:

```bash
TASKMASTER_ENV=demo
TRUST_PROXY=1
```

and none of `ADMIN_PASSWORD`, `SUGGESTIONS_GITHUB_TOKEN` or `WEBAUTHN_*` (the demo seed refuses
to run with `ADMIN_PASSWORD` set; passkeys stay off on the demo).

Block the container from private networks like previews ([preview-host.md](preview-host.md)): it
may reach the public internet (to pull images) but not the home LAN, other containers or the
tailnet beyond what the policy above grants.

Copy both controllers and the timer in, and create the `deploy` user with `tm-demo` as its shell:

```bash
incus file push deploy/prod/tm-prod <container>/usr/local/bin/tm-prod --mode 0755 --uid 0 --gid 0
incus file push deploy/demo/tm-demo <container>/usr/local/bin/tm-demo --mode 0755 --uid 0 --gid 0
incus file push deploy/demo/tm-demo-reset.service <container>/etc/systemd/system/tm-demo-reset.service --mode 0644 --uid 0 --gid 0
incus file push deploy/demo/tm-demo-reset.timer <container>/etc/systemd/system/tm-demo-reset.timer --mode 0644 --uid 0 --gid 0
incus exec <container> -- bash -euxc '
  grep -qx /usr/local/bin/tm-demo /etc/shells || echo /usr/local/bin/tm-demo >> /etc/shells
  id deploy || useradd --create-home --shell /usr/local/bin/tm-demo --groups docker deploy
  cd /opt/taskmaster
  touch compose.override.yaml
  chgrp deploy . compose.yaml .env compose.override.yaml
  chmod 750 .; chmod 640 compose.yaml .env; chmod 660 compose.override.yaml
  systemctl daemon-reload
  systemctl enable --now tm-demo-reset.timer
'
incus exec <container> -- tailscale set --ssh
```

As on production, check that `sftp deploy@<container>` from a `tag:tm-cd-demo` node is refused,
or accept that SFTP gives the same access as `deploy`.

## Web server

The host's Apache serves the demo on its own name (for example `demo.example.cz`) with its own
certificate, proxying to the container's app port. Two settings matter:

- `flushpackets=on` on the proxy line, so live changes (server-sent events) reach the browser
  at once.
- `X-Forwarded-For` set by Apache (`mod_proxy` does this), because the app trusts it with
  `TRUST_PROXY=1` for its per-IP login and stream caps. The app port must not be reachable
  other than through Apache, or a visitor could fake the header.

## Check it works

```bash
incus exec <container> -- su -s /bin/bash deploy -c '/usr/local/bin/tm-demo status'
incus exec <container> -- su -s /bin/bash deploy -c '/usr/local/bin/tm-demo deploy <sha7 of main>'
incus exec <container> -- su -s /bin/bash deploy -c '/usr/local/bin/tm-demo reset'
incus exec <container> -- systemctl list-timers tm-demo-reset.timer
```

`version` prints `tm-demo <hash> tm-prod <hash>`; the hashes must match
`sha256sum deploy/demo/tm-demo deploy/prod/tm-prod | cut -c1-12`.

## Updating the scripts

They are copied in by hand (above), so a change to `deploy/demo/` or `deploy/prod/tm-prod` needs
a fresh `incus file push` to the demo container after it merges (and `systemctl daemon-reload`
for the units). CI never changes the host.

## Recovery

- Wrong or broken data: `tm-demo reset` (or wait for the night).
- A bad deploy rolls itself back, as on production. Its app log is in
  `~deploy/logs/pre-<time>-<sha>.log`; a failed reset's in `~deploy/logs/reset-<time>.log`.
- Broken container: restore its latest Incus snapshot.
