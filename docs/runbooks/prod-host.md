# Production host: auto-deploy of main

Every green push to `main` ends with CI job `deploy prod`: it rolls the image `publish` just
pushed (`ghcr.io/slatinskyj/taskmaster:sha-<sha7>`) out to production. This runbook is generic on
purpose: host names, addresses and ports live in private notes, never in the repo.

## How it works

- Same path as previews ([preview-host.md](preview-host.md)): CI joins the tailnet as an ephemeral
  `tag:tm-ci` node. The tailnet policy lets it reach the production host only on SSH, and
  Tailscale SSH lets it log in only as the `deploy` user. No SSH keys exist anywhere.
- `deploy`'s login shell is [`deploy/prod/tm-prod`](../../deploy/prod/tm-prod), so CI can run only
  `deploy <sha7>`, `status` and `version`.
- `deploy` pulls the sha image, makes an online copy of the SQLite file (`/data/backups/pre-*.db`,
  newest 5 kept), restarts the app on the new image and waits up to 90 s for the image's own
  HEALTHCHECK. If it doesn't turn healthy, it stops the app, puts the DB copy back (a migration
  may have run) and starts the previous image again. CI then fails.
- The job runs only when the repository variable `PROD_HOST` (the host's tailnet name) is set.
  Unset it to pause auto-deploys. It is not a required check.

## Tailnet policy

```jsonc
"grants": [{"src": ["tag:tm-ci"], "dst": ["tag:tm-prod"], "ip": ["tcp:22"]}],
"ssh": [{"action": "accept", "src": ["tag:tm-ci"], "dst": ["tag:tm-prod"], "users": ["deploy"]}],
```

## Host setup (once)

The app already runs from Docker Compose in `/opt/taskmaster` (`compose.yaml` + `.env`, volume
`taskmaster_tm-data`). In `compose.yaml`, read the image from `TM_IMAGE` so the controller can pin
each deploy:

```yaml
    image: ${TM_IMAGE:-ghcr.io/slatinskyj/taskmaster:main}
```

Copy the controller in and create the `deploy` user (it needs Docker, and read access to the
Compose files):

```bash
incus file push deploy/prod/tm-prod <container>/usr/local/bin/tm-prod --mode 0755 --uid 0 --gid 0
incus exec <container> -- bash -euxc '
  grep -qx /usr/local/bin/tm-prod /etc/shells || echo /usr/local/bin/tm-prod >> /etc/shells
  id deploy || useradd --create-home --shell /usr/local/bin/tm-prod --groups docker deploy
  chgrp deploy /opt/taskmaster /opt/taskmaster/compose.yaml /opt/taskmaster/.env
  chmod 750 /opt/taskmaster; chmod 640 /opt/taskmaster/compose.yaml /opt/taskmaster/.env
'
incus exec <container> -- tailscale set --ssh
```

`docker` group membership is root on that container. That is the same trust CI already has on
the preview host, and the forced shell is what limits it.

## Check it works

From a host with SSH access to the container:

```bash
incus exec <container> -- su -s /bin/bash deploy -c '/usr/local/bin/tm-prod status'
incus exec <container> -- su -s /bin/bash deploy -c '/usr/local/bin/tm-prod deploy <sha7 of main>'
```

`version` must match `sha256sum deploy/prod/tm-prod | cut -c1-12`.

## Updating the controller script

It is copied in by hand (above), so a change to `deploy/prod/tm-prod` needs a fresh
`incus file push` after it merges. CI never changes the host.

## Recovery

- A bad deploy rolls itself back. To go back further, run `deploy <older sha7>`. Note that the
  DB stays on the newer schema unless you also copy a `pre-*.db` backup back (stop the app first).
- Broken container: restore its latest Incus snapshot.
