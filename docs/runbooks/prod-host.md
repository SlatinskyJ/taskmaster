# Production host: auto-deploy of main

Every green push to `main` ends with CI job `deploy prod`: it rolls the image `publish` just
pushed (`ghcr.io/slatinskyj/taskmaster:sha-<sha7>`) out to production. This runbook is generic on
purpose: host names, addresses and ports live in private notes, never in the repo.

## How it works

- Like previews ([preview-host.md](preview-host.md)), CI joins the tailnet as an ephemeral node
  and logs in over Tailscale SSH as the `deploy` user. No SSH keys exist anywhere.
- Unlike previews, production has its **own** tag `tag:tm-cd-prod` and its own Tailscale OAuth
  client. Its secrets (`TS_PROD_OAUTH_CLIENT_ID`, `TS_PROD_OAUTH_SECRET`) live only in the GitHub
  environment `production`, whose deployment branch rule admits only `main`. A pull request run
  uses its branch's own workflow, so it must never be able to reach production. The preview
  secret (`tag:tm-ci`) reaches only the preview container.
- `deploy`'s login shell is [`deploy/prod/tm-prod`](../../deploy/prod/tm-prod), so CI can run only
  `deploy <sha7>`, `status` and `version`.
- `deploy` pulls the sha image, makes an online copy of the SQLite file (`$DATA_DIR/backups/pre-*.db`,
  newest 5 kept), pins the image in `compose.override.yaml`, restarts the app and waits up to 90 s
  for the image's own HEALTHCHECK. If it doesn't turn healthy, it keeps the app's log on the host
  (`~deploy/logs/`, not in CI: CI logs are public), stops the app, puts the DB copy back (a
  migration may have run) and starts the previous image again. CI then fails.
- After a good deploy it removes older `sha-*` images, keeping the current and the previous one.
- The job runs only when the repository variable `PROD_HOST` (the host's tailnet name) is set.
  Unset it to pause auto-deploys. It is not a required check.

## Tailnet policy

```jsonc
"tagOwners": {"tag:tm-cd-prod": ["autogroup:owner"]},
"grants": [{"src": ["tag:tm-cd-prod"], "dst": ["tag:tm-prod"], "ip": ["tcp:22"]}],
"ssh": [{"action": "accept", "src": ["tag:tm-cd-prod"], "dst": ["tag:tm-prod"], "users": ["deploy"]}],
"tests": [
  {"src": "tag:tm-cd-prod", "accept": ["tag:tm-prod:22"], "deny": ["tag:tm-prod:3000", "tag:tm-preview:22"]},
  {"src": "tag:tm-ci", "deny": ["tag:tm-prod:22"]},
],
```

## GitHub (once)

1. Tailscale admin console → Settings → OAuth clients → new client with scope `auth_keys`
   (write) limited to tag `tag:tm-cd-prod`.
2. Repository → Settings → Environments → `production`: deployment branches **Selected
   branches: `main`**. Add the environment secrets `TS_PROD_OAUTH_CLIENT_ID` and
   `TS_PROD_OAUTH_SECRET` there, not as repository secrets.
3. Repository variable `PROD_HOST` = the production container's tailnet name.

## Host setup (once)

The app runs from Docker Compose in `/opt/taskmaster` (`compose.yaml` with
`image: ghcr.io/slatinskyj/taskmaster:main`, `.env`, volume `taskmaster_tm-data`). The controller
writes the pinned image to `compose.override.yaml` next to it. Compose reads that file on its own,
so a hand-run `docker compose up -d` there keeps the deployed image.

Copy the controller in and create the `deploy` user (it needs Docker, read access to the Compose
files and write access to the override):

```bash
incus file push deploy/prod/tm-prod <container>/usr/local/bin/tm-prod --mode 0755 --uid 0 --gid 0
incus exec <container> -- bash -euxc '
  grep -qx /usr/local/bin/tm-prod /etc/shells || echo /usr/local/bin/tm-prod >> /etc/shells
  id deploy || useradd --create-home --shell /usr/local/bin/tm-prod --groups docker deploy
  cd /opt/taskmaster
  touch compose.override.yaml
  chgrp deploy . compose.yaml .env compose.override.yaml
  chmod 750 .; chmod 640 compose.yaml .env; chmod 660 compose.override.yaml
'
incus exec <container> -- tailscale set --ssh
```

`docker` group membership is root on that container. That is the same trust CI already has on
the preview host, and the forced shell plus the policy is what limits it. Tailscale SSH serves
SFTP itself in some versions without going through the login shell. After setup, check that
`sftp deploy@<container>` from a `tag:tm-cd-prod` node is refused, or accept that SFTP gives the
same access as `deploy`.

## Check it works

```bash
incus exec <container> -- su -s /bin/bash deploy -c '/usr/local/bin/tm-prod status'
incus exec <container> -- su -s /bin/bash deploy -c '/usr/local/bin/tm-prod deploy <sha7 of main>'
```

`version` must match `sha256sum deploy/prod/tm-prod | cut -c1-12`.

## Updating the controller script

It is copied in by hand (above), so a change to `deploy/prod/tm-prod` needs a fresh
`incus file push` after it merges, to the production host **and** the demo host, which runs it
under `tm-demo` ([demo-host.md](demo-host.md)). CI never changes either host.

## Recovery

- A bad deploy rolls itself back. Its app log is in `~deploy/logs/pre-<time>-<sha>.log`.
- To go back further: `tm-prod deploy <older sha7>` (only the current and previous images are
  kept locally; older ones are pulled again). The DB stays on the newer schema unless you also
  copy a `pre-*.db` backup back with the app stopped.
- Broken container: restore its latest Incus snapshot.
