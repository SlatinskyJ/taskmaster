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

If you script these steps, add `</dev/null` to each `incus exec`, which otherwise eats the script's stdin.

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

Block previews from private networks. Previews run unreviewed PR code, so they get their own
Docker network that may reach the public internet but not the home LAN, other containers or the
tailnet:

```bash
incus file push deploy/preview/tm-preview-egress tm-previews/usr/local/sbin/tm-preview-egress --mode 0755 --uid 0 --gid 0
incus file push deploy/preview/tm-preview-egress.service tm-previews/etc/systemd/system/tm-preview-egress.service --mode 0644 --uid 0 --gid 0
incus exec tm-previews -- systemctl enable --now tm-preview-egress </dev/null
incus exec tm-previews -- iptables -S DOCKER-USER </dev/null   # expect 2 DNS RETURN + 5 REJECT rules
incus exec tm-previews -- docker run --rm --network tm-previews busybox sh -c \
  'nslookup example.com && wget -qO- -T5 http://example.com >/dev/null && echo internet-ok' </dev/null
```

The LAN must be blocked: from the same `busybox` container, `wget -T5 http://<your router's IP>`
should fail with "Connection refused".

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
ssh deploy@tm-previews version                   # must match: sha256sum deploy/preview/tm-preview | cut -c1-12
docker save taskmaster:ci | gzip | ssh deploy@tm-previews deploy 999
ssh deploy@tm-previews remove 999
```

## Updating the controller script

The script is copied in by hand (above), so a change to `deploy/preview/tm-preview` needs a
fresh `incus file push` (as above, with `--uid 0 --gid 0`) after it merges. CI never changes
the host. Compare `version` with the repo copy to spot drift.

## Disk

Memory and CPU are capped; disk is not, beyond the server's own storage pool. Check that nested
Docker uses overlay2, not `vfs` (which copies every layer and fills the disk fast):

```bash
incus exec tm-previews -- docker info --format '{{.Driver}}'   # expect overlay2
```

On a storage pool that supports quotas, also cap the container's root disk, e.g.
`incus config device override tm-previews root size=40GiB`.

## After a reboot

Previews don't restart on their own (`--restart no`), so none runs before the egress block is back.
They come back on the PR's next push. `deploy` refuses to run until `tm-preview-egress` has
succeeded since boot.

## Recovery

- Broken container: `incus restore tm-previews ready`.
- Remove everything: `incus delete --force tm-previews`, then delete the node in the Tailscale
  admin console. The rest of the server is untouched.
