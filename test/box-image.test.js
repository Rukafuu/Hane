import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = (name) => readFileSync(path.join(root, 'scripts', 'box-image', 'overlay', 'etc', name), 'utf8');
const builder = readFileSync(path.join(root, 'scripts', 'box-image', 'build-debian-rootfs.sh'), 'utf8');

// The boundary is a file that ships inside the image, so a loosening edit has
// to fail here rather than install a box that can see C:.
test('the baked wsl.conf denies Windows drives and Windows binaries', () => {
  const config = overlay('wsl.conf');
  assert.match(config, /\[automount\]\s*\nenabled = false/);
  assert.match(config, /\[interop\]\s*\nenabled = false\s*\nappendWindowsPath = false/);
  assert.equal(config.includes('enabled = true'), false);
});

test('the baked wsl.conf does not pin the default user to the agent', () => {
  // Lucas uses this box himself (ADR-0008): `wsl -d hane` is his shell, and the
  // runtime reaches the agent account explicitly with `-u haneagent`.
  assert.equal(overlay('wsl.conf').includes('[user]'), false);
});

test('the distribution config registers the box as hane and runs our OOBE first', () => {
  const config = overlay('wsl-distribution.conf');
  assert.match(config, /\[oobe\][\s\S]*defaultName = hane/);
  assert.match(config, /command = \/etc\/hane-oobe\.sh/);
  assert.match(config, /defaultUid = 1000/);
});

test('the OOBE gives the human root inside the box without a password hash, and never the agent', () => {
  const oobe = overlay('hane-oobe.sh');
  assert.match(oobe, /adduser --uid "\$HUMAN_UID" --disabled-password/);
  assert.match(oobe, /NOPASSWD:ALL/);
  assert.equal(/haneagent[^\n]*-aG sudo/.test(oobe), false);
  assert.match(oobe, /exit 0/);
});

test('the builder bakes the overlay, creates the agent unprivileged and packs what WSL accepts', () => {
  assert.match(builder, /install -m 0644 -o root -g root .*overlay\/etc\/wsl\.conf/);
  assert.match(builder, /install -m 0755 -o root -g root .*overlay\/etc\/hane-oobe\.sh/);
  assert.match(builder, /useradd --uid "\$AGENT_UID" --create-home --shell \/bin\/bash haneagent/);
  assert.equal(builder.includes('-G sudo'), false);
  assert.match(builder, /AGENT_UID=1001/);
  assert.match(builder, /rm -f "\$ROOTFS\/etc\/resolv\.conf"/);
  assert.match(builder, /tar --numeric-owner -C "\$ROOTFS" -cf/);
  assert.match(builder, /gzip --best -c .* > "\$OUTPUT"/);
  assert.match(builder, /hane-box-\$\{VERSION\}\.wsl/);
});

test('the builder audits its own artifact instead of trusting the build', () => {
  assert.match(builder, /no \/etc\/resolv\.conf in the image/);
  assert.match(builder, /no kernel or initramfs in the image/);
  assert.match(builder, /password hash\(es\) in \/etc\/shadow/);
  assert.match(builder, /\[ "\$FAIL" -eq 0 \] \|\|/);
});
