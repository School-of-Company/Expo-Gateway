const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const workflow = yaml.load(
  readFileSync(join(__dirname, '../.github/workflows/deploy.yml'), 'utf8'),
);
const job = workflow.jobs.deploy;
const step = (name) => job.steps.find((entry) => entry.name === name);
const run = (script, env) =>
  spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
const settings = {
  HOST: 'deploy.example.com',
  PORT: '22',
  USER: 'gateway',
  REMOTE_ROOT: '/srv/expo/dev',
};

assert.equal(workflow.permissions.contents, 'read');
assert.ok(workflow.on.pull_request);
assert.equal(job['timeout-minutes'], 20);
assert.equal(job.env.REMOTE_ROOT, '/srv/users/projects/2026/team1/expo');
assert.deepEqual(workflow.on.push.branches, ['main']);
for (const entry of job.steps.filter((entry) => entry.uses)) {
  assert.match(entry.uses, /@[a-f0-9]{40}$/);
}
assert.equal(job.steps[1].with['persist-credentials'], false);
for (const name of [
  'Validate deployment settings',
  'Package',
  'Configure SSH',
  'Upload and deploy',
]) {
  assert.equal(step(name).if, "github.event_name != 'pull_request'");
}
const validate = step('Validate deployment settings').run;
assert.equal(run(validate, settings).status, 0);
for (const key of Object.keys(settings)) {
  assert.notEqual(run(validate, { ...settings, [key]: '' }).status, 0, key);
}
for (const PORT of ['0', '65536', '-1', 'abc', '999999999999999999999']) {
  assert.notEqual(run(validate, { ...settings, PORT }).status, 0, PORT);
}
assert.notEqual(
  run(validate, { ...settings, REMOTE_ROOT: '/srv/expo;echo injected' }).status,
  0,
);

const sandbox = mkdtempSync(join(tmpdir(), 'gateway-deploy-check-'));
try {
  const calls = join(sandbox, 'calls');
  const runtime = JSON.stringify([
    process.platform,
    process.arch,
    process.versions.modules,
    process.report.getReport().header.glibcVersionRuntime || 'musl',
  ]);
  writeFileSync(
    join(sandbox, 'ssh'),
    '#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALLS"\nif [[ "$*" == *"node -p"* ]]; then printf "%s\\n" "$TARGET_RUNTIME"; fi\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(sandbox, 'scp'),
    '#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALLS"\n',
    { mode: 0o700 },
  );
  const env = {
    ...settings,
    PATH: `${sandbox}:${process.env.PATH}`,
    CALLS: calls,
    TARGET_RUNTIME: runtime,
    GITHUB_SHA: '123456789012abcdef',
    GITHUB_RUN_ATTEMPT: '1',
    SVC: 'gateway',
    DEPLOY_ENV: 'dev',
  };
  const deploy = step('Upload and deploy').run;
  assert.equal(run(deploy, env).status, 0);
  const commands = readFileSync(calls, 'utf8').trim().split('\n');
  assert.equal(commands.length, 3);
  for (const command of commands) {
    assert.ok(command.includes('BatchMode=yes'));
    assert.ok(command.includes('ConnectTimeout=15'));
  }
  assert.ok(
    commands[1].includes(
      '/srv/expo/dev/app/gateway/incoming/123456789012-1.tar.gz',
    ),
  );
  writeFileSync(calls, '');
  assert.notEqual(
    run(deploy, { ...env, TARGET_RUNTIME: 'different-runtime' }).status,
    0,
  );
  assert.equal(readFileSync(calls, 'utf8').trim().split('\n').length, 1);
  console.log(
    'PASS: deployment settings, PR isolation, SSH options and runtime mismatch guard',
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
