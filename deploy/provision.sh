#!/usr/bin/env bash
#
# deploy/provision.sh — a fresh Debian or Ubuntu LTS machine made into one the api can run on:
# security updates on their own, SSH by key only, a firewall, Docker, the backup tools, and the
# backup and disk timers. Run once as root from the checkout, and again whenever: every step
# checks before it changes.
#
#   sudo deploy/provision.sh --user <login> [--ssh-from <cidr>] [--tunnel]
#
#   --user      the account you log in as. It must already exist and hold a key in
#               ~/.ssh/authorized_keys: password and root logins are switched off, and this
#               refuses to do that while it would lock you out.
#   --ssh-from  where SSH may come from (your VPN's or Tailscale's range, `100.64.0.0/10`). Without
#               it, 22 is open to the internet and rate limited.
#   --tunnel    the machine is behind a tunnel (deploy/compose.tunnel.yaml): 80 and 443 stay
#               closed, because nothing comes in.
#
# What it does not do: anything only the maintainer can — the provider account, DNS, the secrets
# in deploy/.env, `rclone config`, the monitoring service. deploy/README.md, *The machine*, is the
# whole list in order.
set -euo pipefail

usage() { echo "usage: $0 --user <login> [--ssh-from <cidr>] [--tunnel]" >&2; [[ $# -gt 0 ]] && echo "$1" >&2; exit 2; }

login=""
ssh_from=""
tunnel=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --user) [[ -n "${2:-}" ]] || usage "--user needs a name"; login="$2"; shift 2 ;;
    --ssh-from) [[ -n "${2:-}" ]] || usage "--ssh-from needs a range"; ssh_from="$2"; shift 2 ;;
    --tunnel) tunnel=1; shift ;;
    *) usage "unknown argument $1" ;;
  esac
done
[[ -n "$login" ]] || usage

step() { printf '\n\033[1m— %s\033[0m\n' "$1"; }
refuse() { echo "provision: $1" >&2; exit 1; }

deploy="$(cd "$(dirname "$0")" && pwd)"

step "the machine"
[[ $EUID -eq 0 ]] || refuse "run as root (sudo)"
# shellcheck source=/dev/null
. /etc/os-release
case "${ID:-}" in
  debian | ubuntu) ;;
  *) refuse "this is for Debian or Ubuntu, not ${PRETTY_NAME:-an unknown system}" ;;
esac
echo "${PRETTY_NAME}"

# Checked before anything changes: the one mistake this script must not make is the lockout.
step "the login, before SSH is closed to anything else"
id "$login" >/dev/null 2>&1 || refuse "no user $login — create it and give it your key first"
home="$(getent passwd "$login" | cut -d: -f6)"
keys="$home/.ssh/authorized_keys"
[[ -s "$keys" ]] || refuse "$keys is empty or missing — copy your public key there first (ssh-copy-id)"
grep -qE '^(ssh-|ecdsa-|sk-)' "$keys" || refuse "$keys holds no key a server would read"
echo "$login logs in with $(grep -cE '^(ssh-|ecdsa-|sk-)' "$keys") key(s)"
# A range that leaves out the address this session comes from would close it behind you.
if [[ -n "$ssh_from" && -n "${SSH_CONNECTION:-}" ]]; then
  here="${SSH_CONNECTION%% *}"
  command -v python3 >/dev/null || { apt-get update -q && apt-get install -y -q python3-minimal; }
  python3 -c 'import ipaddress,sys; sys.exit(0 if ipaddress.ip_address(sys.argv[1]) in ipaddress.ip_network(sys.argv[2], strict=False) else 1)' \
    "$here" "$ssh_from" || refuse "this session comes from $here, which --ssh-from $ssh_from leaves out — connect from inside it first"
fi

step "packages: security updates on their own, the firewall, the backup tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q unattended-upgrades ufw age rclone curl ca-certificates gnupg
# Security updates every day, unattended; a reboot a kernel needs happens at a quiet hour.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat >/etc/apt/apt.conf.d/52anydag-reboot <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF

step "Docker Engine and the compose plugin, from Docker's own repository"
if docker compose version >/dev/null 2>&1; then
  docker compose version
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
# The docker group is root by another name; the login is the machine's admin, so it is theirs.
usermod -aG docker "$login"

step "SSH: keys only, no root"
cat >/etc/ssh/sshd_config.d/10-anydag.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
CONF
sshd -t || refuse "sshd refused its configuration — nothing was reloaded"
systemctl reload ssh 2>/dev/null || systemctl reload sshd

step "the firewall"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
if [[ -n "$ssh_from" ]]; then
  ufw allow from "$ssh_from" to any port 22 proto tcp >/dev/null
  ufw delete limit 22/tcp >/dev/null 2>&1 || true
else
  ufw limit 22/tcp >/dev/null
fi
if ((tunnel)); then
  ufw delete allow 80/tcp >/dev/null 2>&1 || true
  ufw delete allow 443/tcp >/dev/null 2>&1 || true
else
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi
ufw --force enable >/dev/null
# Docker writes its own iptables rules for a published port, past ufw: only Caddy publishes any
# (80 and 443), and the tunnel's override publishes none — Postgres never does.
ufw status verbose

step "the timers: the nightly backup and the hourly disk check"
for unit in anydag-backup.service anydag-backup.timer anydag-disk.service anydag-disk.timer; do
  sed "s#@DEPLOY@#${deploy}#g" "$deploy/systemd/$unit" >"/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now anydag-backup.timer anydag-disk.timer
systemctl list-timers 'anydag-*' --no-pager

step "done — what is left is yours (deploy/README.md, *The machine*)"
[[ -f "$deploy/.env" ]] || echo "- deploy/.env: cp deploy/.env.example deploy/.env, fill it in, chmod 600"
command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -q . || echo "- rclone config: the backup destination, at another provider"
echo "- log in again as $login before closing this session, to be sure the key works"
