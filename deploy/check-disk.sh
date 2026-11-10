#!/usr/bin/env bash
#
# deploy/check-disk.sh — the disk alert: is the filesystem under the api's data more than
# DISK_ALERT_PERCENT full?
#
#   ./check-disk.sh
#
# Run hourly by deploy/systemd/anydag-disk.timer. Reads the machine's deploy/.env (or the
# environment) for:
#   DISK_ALERT_PERCENT  (70) — the line;
#   DISK_PING_URL       (optional) a healthchecks.io-style check: pinged at the URL when every
#                       filesystem is under the line, at `/fail` (with the numbers as the body)
#                       when one is over. The service emails on the fail, and on silence — so a
#                       machine that stopped running this is noticed too.
#
# Which filesystems: the ones holding the named volumes (`anydag_api_data`: blobs and logs;
# `anydag_db_data`: Postgres) — on an attached block volume that is that volume, on a plain VM
# the root disk. Each is checked once, however many volumes share it.
#
# Exit 0 under the line, 1 over it, 2 when it cannot tell (a volume that does not exist yet).
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n "${!key+x}" ]] || export "$key=$value"
  done < .env
fi

LINE="${DISK_ALERT_PERCENT:-70}"
if ! [[ "$LINE" =~ ^[0-9]+$ ]] || ((LINE < 1 || LINE > 99)); then
  echo "DISK_ALERT_PERCENT must be 1–99, not $LINE" >&2
  exit 2
fi

beat() { [[ -z "${DISK_PING_URL:-}" ]] || curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "${DISK_PING_URL%/}$1" || true; }

report=""
over=0
seen=""
for volume in anydag_api_data anydag_db_data; do
  where="$(docker volume inspect --format '{{.Mountpoint}}' "$volume" 2>/dev/null)" || {
    echo "no volume $volume — is the stack up?" >&2
    exit 2
  }
  # `df` names the filesystem, so two volumes on one disk are one line.
  read -r fs used <<<"$(df --output=source,pcent "$where" | tail -n 1 | tr -d '%')"
  case " $seen " in *" $fs "*) continue ;; esac
  seen="$seen $fs"
  line="$fs ${used}% (holds $volume)"
  report+="$line"$'\n'
  echo "$line"
  ((used < LINE)) || over=1
done

if ((over)); then
  echo "over ${LINE}% — grow the volume (deploy/README.md, *Watch it*)" >&2
  beat /fail "$report"
  exit 1
fi
beat "" "$report"
