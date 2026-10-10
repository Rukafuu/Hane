#!/usr/bin/env bash
# Builds the Hane box image (ADR-0007): a Debian minbase rootfs with the
# boundary already inside it, packed as a gzip tar and named .wsl so WSL accepts
# `wsl --install --from-file <path>` with no Store and no account.
#
# Run as root on a Debian/Ubuntu machine (the repository workflow runs it on a
# GitHub Actions ubuntu runner). It never touches the host beyond a temp dir.

set -euo pipefail

SUITE="${SUITE:-trixie}"
ARCH="${ARCH:-amd64}"
MIRROR="${MIRROR:-http://deb.debian.org/debian}"
VERSION="${VERSION:?VERSION is required, e.g. VERSION=0.1.0}"
OUTPUT="${OUTPUT:-hane-box-${VERSION}.wsl}"

# sudo is in the image so the human owner of the box can install packages; the
# agent account is deliberately kept out of it.
PACKAGES="ca-certificates,curl,git,gnupg,nano,procps,sudo"
AGENT_UID=1001

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
ROOTFS="$WORK/rootfs"
trap 'rm -rf "$WORK"' EXIT

[ "$(id -u)" -eq 0 ] || { echo 'run as root: debootstrap needs to create device nodes' >&2; exit 1; }
command -v debootstrap > /dev/null || { echo 'debootstrap is missing (apt install debootstrap)' >&2; exit 1; }

echo '==> bootstrapping'" $SUITE/$ARCH"
debootstrap --variant=minbase --arch="$ARCH" --include="$PACKAGES" "$SUITE" "$ROOTFS" "$MIRROR"

echo '==> baking the boundary'
install -m 0644 -o root -g root "$SCRIPT_DIR/overlay/etc/wsl.conf" "$ROOTFS/etc/wsl.conf"
install -m 0644 -o root -g root "$SCRIPT_DIR/overlay/etc/wsl-distribution.conf" "$ROOTFS/etc/wsl-distribution.conf"
install -m 0755 -o root -g root "$SCRIPT_DIR/overlay/etc/hane-oobe.sh" "$ROOTFS/etc/hane-oobe.sh"

echo '==> creating the agent account (uid '"$AGENT_UID"', no sudo)'
chroot "$ROOTFS" /usr/sbin/useradd --uid "$AGENT_UID" --create-home --shell /bin/bash haneagent
chroot "$ROOTFS" /usr/bin/id haneagent

echo '==> shrinking'
rm -rf "$ROOTFS"/var/lib/apt/lists/* "$ROOTFS"/var/cache/apt/archives/*.deb
# Microsoft's rule for a distributable rootfs: WSL writes resolv.conf at boot,
# and an old one in the image means a stale nameserver inside the box.
rm -f "$ROOTFS/etc/resolv.conf"

echo '==> packing'
tar --numeric-owner -C "$ROOTFS" -cf "$WORK/rootfs.tar" .
gzip --best -c "$WORK/rootfs.tar" > "$OUTPUT"

echo '==> auditing the artifact'
FAIL=0
audit() {
  local description="$1" pattern="$2" want="$3"
  local hits
  hits="$(tar -tvzpf "$OUTPUT" | awk -v p="$pattern" '$NF ~ p { print }' | wc -l | tr -d ' ')"
  if [ "$hits" -ne "$want" ]; then
    echo "FAIL: $description (found $hits, want $want)" >&2
    FAIL=1
  else
    echo 'ok: '"$description"
  fi
}
audit 'no /etc/resolv.conf in the image' '^\./etc/resolv\.conf$' 0
audit 'no kernel or initramfs in the image' '^\./(boot/|init(\.gz|ramfs)?|vmlinuz)' 0
audit 'wsl.conf is baked in' '^\./etc/wsl\.conf$' 1
audit 'wsl-distribution.conf is baked in' '^\./etc/wsl-distribution\.conf$' 1
audit 'oobe script is baked in' '^\./etc/hane-oobe\.sh$' 1

# A distributable rootfs must carry no password hashes (Microsoft's rule), and
# nothing in it should be able to reach Windows anyway.
HASHES="$(tar -xzOf "$OUTPUT" ./etc/shadow | awk -F: '$2 != "" && $2 !~ /^[!*]/' | wc -l | tr -d ' ')"
if [ "$HASHES" -ne 0 ]; then
  echo "FAIL: $HASHES password hash(es) in /etc/shadow" >&2
  FAIL=1
else
  echo 'ok: no password hashes in /etc/shadow'
fi

ls -lh "$OUTPUT"
[ "$FAIL" -eq 0 ] || { echo 'the image does not match the boundary it is supposed to carry' >&2; exit 1; }
echo "==> $OUTPUT ready: wsl --install --from-file $OUTPUT"
