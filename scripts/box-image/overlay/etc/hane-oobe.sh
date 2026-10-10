#!/bin/bash
# First run inside the box, as root, with no elevation on Windows (ADR-0007).
# A non-zero exit here means the user cannot open a shell at all, so every path
# out of this script returns 0 except a genuinely broken adduser.

set -u

AGENT_UID=1001
HUMAN_UID=1000

# The agent account is baked at build time; recreating it here would silently
# change the uid the egress rules are written against.
if ! getent passwd "$AGENT_UID" > /dev/null; then
  useradd --uid "$AGENT_UID" --create-home --shell /bin/bash --no-user-group haneagent \
    || echo 'hane: could not ensure the agent account; the box still starts.' >&2
fi

if getent passwd "$HUMAN_UID" > /dev/null; then
  echo 'hane: an interactive user already exists, skipping setup.'
  exit 0
fi

echo 'Create your own UNIX user for this box. The name does not have to match'
echo 'your Windows username. Inside the box you can use sudo without a password;'
echo 'the agents run as haneagent and cannot.'

for _ in 1 2 3 4 5; do
  read -r username || break
  case "$username" in
    *[!a-z0-9_-]*|'') echo 'Use lowercase letters, digits, "-" or "_". Try again.' >&2; continue ;;
  esac
  # No password is set on purpose: the image must carry no password hashes
  # (Microsoft's own rule for a distributable rootfs), so the human's root
  # inside the box comes from a NOPASSWD rule instead.
  if adduser --uid "$HUMAN_UID" --disabled-password --gecos '' "$username" \
    && echo "$username ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/hane-human \
    && chmod 0440 /etc/sudoers.d/hane-human; then
    echo "hane: welcome, $username. The agents run as haneagent."
    exit 0
  fi
  deluser --quiet --system "$username" 2> /dev/null
done

echo 'hane: no interactive user was created; you will enter the box as haneagent.' >&2
exit 0
