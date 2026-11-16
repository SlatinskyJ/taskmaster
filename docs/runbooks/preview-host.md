# Preview host runbook

Per-PR previews (epic #60) run on Jakub's home server, not on the family NAS. This page is
generic on purpose: host names, addresses and ports live in private notes, never in the repo.

## Shape

- An **Incus system container** `tm-previews` (Debian 13) on the home server, with nesting on,
  so Docker runs inside it. The host and its other containers are untouched.
- The container is its **own Tailscale node**, tagged `tag:tm-preview`.
- **CI** joins the tailnet as an ephemeral node tagged `tag:tm-ci` (Tailscale OAuth client in
  repo secrets `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`). The policy lets `tag:tm-ci` reach only
  `tag:tm-preview` on SSH, and Tailscale SSH lets it log in only as the `deploy` user.
- `deploy`'s login shell is [`deploy/preview/tm-preview`](../../deploy/preview/tm-preview), so CI
  can run only `deploy`, `remove`, `list` and `sweep`. No SSH keys exist anywhere.
- Each preview: one Docker container, fresh data volume, 256 MB memory cap, at most 3 at once,
  published on the tailnet with `tailscale serve` on HTTPS port `10000 + PR number`.

## Tailscale policy (admin console)

```jsonc
"tagOwners": {
  "tag:tm-preview": ["autogroup:owner"],
  "tag:tm-ci":      ["autogroup:owner"],
},
"grants": [
  // CI runners (ephemeral) may only SSH to the Taskmaster preview container.
  {"src": ["tag:tm-ci"], "dst": ["tag:tm-preview"], "ip": ["tcp:22"]},
],
"ssh": [
  {"action": "accept", "src": ["tag:tm-ci"], "dst": ["tag:tm-preview"], "users": ["deploy"]},
],
"tests": [
  {"src": "tag:tm-ci", "accept": ["tag:tm-preview:22"], "deny": ["tag:tm-preview:443"]},
],
```

Tagged nodes are not `autogroup:member`, so a default "members reach everything" grant does not
reach or come from them.

## One-time setup (on the home server, as the Incus admin)

```bash
incus snapshot create <an existing container> pre-tm-previews   # habit: snapshot before changes

incus launch images:debian/13 tm-previews \
  -c security.nesting=true \
  -c security.syscalls.intercept.mknod=true \
  -c security.syscalls.intercept.setxattr=true \
  -c limits.memory=2GiB -c limits.cpu=2 \
  -c boot.autostart=true
incus config device add tm-previews tun unix-char path=/dev/net/tun

incus exec tm-previews -- bash -euxc '
  apt-get update
  apt-get install -y --no-install-recommends docker.io docker-cli curl jq ca-certificates gnupg
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list
  apt-get update && apt-get install -y tailscale
  systemctl enable --now docker tailscaled
'
```

Copy the controller in and create the `deploy` user:

```bash
incus file push deploy/preview/tm-preview tm-previews/usr/local/bin/tm-preview --mode 0755 --uid 0 --gid 0
incus exec tm-previews -- bash -euxc '
  grep -qx /usr/local/bin/tm-preview /etc/shells || echo /usr/local/bin/tm-preview >> /etc/shells
  id deploy || useradd --create-home --shell /usr/local/bin/tm-preview --groups docker deploy
'
```

Join the tailnet (prints a login link; approve it in the browser as the tailnet owner):

```bash
incus exec tm-previews -- tailscale up --ssh --hostname=tm-previews --advertise-tags=tag:tm-preview
incus exec tm-previews -- tailscale set --operator=deploy
incus snapshot create tm-previews ready
```

## Check it works

From a tailnet device that has SSH access to the container (or from CI):

```bash
ssh deploy@tm-previews list                      # prints nothing: no previews yet
docker save taskmaster:ci | gzip | ssh deploy@tm-previews deploy 999
ssh deploy@tm-previews remove 999
```

## Updating the controller script

The script is copied in by hand (above), so a change to `deploy/preview/tm-preview` needs a
fresh `incus file push` after it merges. CI never changes the host.

## Recovery

- Broken container: `incus restore tm-previews ready`.
- Remove everything: `incus delete --force tm-previews`, then delete the node in the Tailscale
  admin console. The rest of the server is untouched.
