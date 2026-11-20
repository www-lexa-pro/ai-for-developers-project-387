import { execFileSync } from 'node:child_process';
import lint from '@commitlint/lint';
import load from '@commitlint/load';

// These two starting histories contain course commits that predate our policy.
const messages = execFileSync(
  'git',
  ['log', '-z', '--format=%B', 'HEAD', '^02cdd5a', '^983f1dedeb8853e2c4eb677bd8e38710189a0c52'],
  { encoding: 'utf8' },
).split('\0').filter(Boolean);
const config = await load();
for (const message of messages) {
  const result = await lint(message, config.rules, {
    parserOpts: config.parserPreset?.parserOpts,
    plugins: config.plugins,
    ignores: config.ignores,
    defaultIgnores: config.defaultIgnores,
  });
  for (const { message: error, name } of result.errors) {
    console.error(`${message.split('\n')[0]}: ${error} [${name}]`);
    process.exitCode = 1;
  }
}
