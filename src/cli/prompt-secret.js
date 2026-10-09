/**
 * Reads a secret from stdin. On a TTY the input is hidden with raw mode;
 * piped input is read to the end and trimmed. The value is never echoed.
 * @param {{ stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream }} io
 * @returns {Promise<string>}
 */
export async function readSecretFromStdin({ stdin, stdout }) {
  const raw = stdin.isTTY ? await readHiddenLine({ stdin, stdout }) : await readPipedStream(stdin);
  const secret = raw.trim();
  if (secret.length === 0) {
    throw new TypeError('secret is required; paste one when prompted or pipe it in (e.g. Get-Content key.txt | hane provider set-secret openrouter).');
  }
  return secret;
}

function readPipedStream(stdin) {
  return new Promise((resolve, reject) => {
    let data = '';
    stdin.on('data', (chunk) => { data += chunk; });
    stdin.once('end', () => resolve(data));
    stdin.once('error', reject);
  });
}

function readHiddenLine({ stdin, stdout }) {
  return new Promise((resolve, reject) => {
    stdout.write('Paste the secret and press Enter (input is hidden): ');
    let secret = '';
    const previousRawMode = stdin.isRaw ?? false;
    stdin.setRawMode(true);
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(previousRawMode);
      stdin.pause();
    };
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      if (text.includes('\u0003')) {
        cleanup();
        reject(new Error('Cancelled by user.'));
        return;
      }
      if (text.includes('\r') || text.includes('\n')) {
        cleanup();
        stdout.write('\n');
        resolve(secret);
        return;
      }
      if (text.includes('\u007f') || text.includes('\b')) {
        secret = secret.slice(0, -1);
        return;
      }
      secret += text;
    };
    stdin.once('error', (error) => {
      cleanup();
      reject(error);
    });
    stdin.on('data', onData);
  });
}
