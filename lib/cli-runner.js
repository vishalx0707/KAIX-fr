import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';

function resolveSpawnTarget(executable, args) {
  if (!isWindows || !/\.(cmd|bat)$/i.test(executable)) {
    return { command: executable, args };
  }

  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', executable, ...args]
  };
}

export function runCli(cli, executable, systemPrompt, userPrompt, { imagePath = null } = {}) {
  return new Promise((resolve, reject) => {
    const combined = `${systemPrompt}\n\n---\n\nUSER REQUEST:\n${userPrompt}\n\nRespond with the JSON object only.`;
    const args = cli.buildArgs({ imagePath });
    const target = resolveSpawnTarget(executable, args);
    const child = spawn(target.command, target.args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`${cli.label} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout.trim());
    });
    child.stdin.write(combined);
    child.stdin.end();
  });
}
