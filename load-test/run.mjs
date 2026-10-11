#!/usr/bin/env node
// Load-test orchestrator. Runs on the developer machine and drives a docker
// compose stack either locally (--target local, stub Eureka) or on the staging
// server over SSH (--target ssh, real Eureka, CPU-pinned).
//
//   node load-test/run.mjs run  --target local --fast --reps 1 --duration 20 --warmup 5
//   node load-test/run.mjs run  --target ssh
//   node load-test/run.mjs up   --target ssh      (build and start only)
//   node load-test/run.mjs down --target ssh
//
// See load-test/README.md for what is measured and how to read it.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const LT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(LT, '..');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? 'run';
const useSsh = (args.target ?? 'local') === 'ssh';
const fast = Boolean(args.fast);
const eurekaKind = args.eureka ?? (useSsh ? 'real' : 'stub');
const reps = Number(args.reps ?? 3);
const durationS = Number(args.duration ?? 60);
const warmupS = Number(args.warmup ?? 15);
const only = String(args.only ?? 'latency,sigterm,sigkill,hostdown').split(',');

const SSH_HOST = process.env.BENCH_SSH_HOST ?? 'ubuntu@ssh.gsmsv.site';
const SSH_PORT = process.env.BENCH_SSH_PORT ?? '21105';
const REMOTE_DIR = process.env.BENCH_REMOTE_DIR ?? '~/bench/gateway';
const GATEWAY_URL = 'http://gateway:3000';
const DIRECT_URL = 'http://backend-a:4000';
const PROM_LOCAL_PORT = useSsh ? 19090 : 9090;
const PROM = `http://127.0.0.1:${PROM_LOCAL_PORT}`;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- command execution (local shell or ssh) ----------------------------------

// An idle SSH connection can be dropped silently by a NAT/firewall; without
// keepalives the client then waits forever on a half-open socket (this hung a
// real run for an hour). ServerAlive makes ssh exit instead, and every command
// also has a hard timeout.
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4'];

function run(bin, argv, opts = {}, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, argv, opts);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs)
      : undefined;
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : code, stdout, stderr, timedOut });
    });
  });
}

function sh(command, timeoutMs = 300_000) {
  if (useSsh) {
    return run('ssh', [...SSH_OPTS, '-p', SSH_PORT, SSH_HOST, `cd ${REMOTE_DIR}/load-test && ${command}`], {}, timeoutMs);
  }
  return run('bash', ['-c', command], { cwd: LT }, timeoutMs);
}

async function must(command, timeoutMs) {
  const r = await sh(command, timeoutMs);
  if (r.code !== 0) throw new Error(`command failed (${r.code}${r.timedOut ? ', timed out' : ''}): ${command}\n${r.stderr || r.stdout}`);
  return r.stdout;
}

const composeFiles = useSsh ? '-f docker-compose.yml -f docker-compose.staging.yml' : '-f docker-compose.yml';
const timingEnv = fast
  ? 'EUREKA_EVICTION_MS=2000 EUREKA_CACHE_MS=1000 HEARTBEAT_SECONDS=3 LEASE_SECONDS=10'
  : '';
const compose = (rest) =>
  `${timingEnv} docker compose -p bench-gw ${composeFiles} --profile ${eurekaKind === 'real' ? 'real-eureka' : 'stub-eureka'} --profile run ${rest}`;

// ---- prometheus ---------------------------------------------------------------

async function promFetch(pathAndQuery) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${PROM}${pathAndQuery}`, { signal: AbortSignal.timeout(8000) });
      return await res.json();
    } catch (err) {
      if (attempt >= 2) throw err;
      await ensureTunnel();
    }
  }
}

async function prom(query) {
  const body = await promFetch(`/api/v1/query?${new URLSearchParams({ query })}`);
  return body.data?.result ?? [];
}

async function scalar(query) {
  const result = await prom(query);
  if (result.length === 0) return undefined;
  const v = Number(result[0].value[1]);
  return Number.isNaN(v) ? undefined : v;
}

async function firingAlerts() {
  const body = await promFetch('/api/v1/alerts');
  return (body.data?.alerts ?? []).filter((a) => a.state === 'firing').map((a) => a.labels.alertname);
}

async function waitFor(label, predicate, timeoutS, intervalMs = 2000) {
  const deadline = Date.now() + timeoutS * 1000;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch { /* keep polling */ }
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutS}s waiting for: ${label}`);
}

// ---- environment lifecycle ----------------------------------------------------

let tunnel;
let TOKEN = '';

function ensureKeys() {
  const dir = path.join(LT, '.tmp', 'keys');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'private.pem'))) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(path.join(dir, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    fs.writeFileSync(path.join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  }
  TOKEN = jwt.sign({ sub: 'load-test-user' }, fs.readFileSync(path.join(dir, 'private.pem')), {
    algorithm: 'RS256',
    expiresIn: '6h',
  });
}

async function sync() {
  log(`syncing sources to ${SSH_HOST}:${REMOTE_DIR}`);
  const excludes = ['node_modules', 'dist', '.git', '.claude', 'coverage', 'load-test/results', 'load-test/.tmp/stub-backend', 'load-test/.tmp/keys/private.pem']
    .map((e) => `--exclude=${e}`)
    .join(' ');
  const cmd = `COPYFILE_DISABLE=1 tar -czf - -C "${REPO}" ${excludes} . | ssh ${SSH_OPTS.join(' ')} -p ${SSH_PORT} ${SSH_HOST} "mkdir -p ${REMOTE_DIR} && tar -xzf - -C ${REMOTE_DIR} 2>/dev/null"`;
  const r = await run('bash', ['-c', cmd], {}, 300_000);
  if (r.code !== 0) throw new Error(`sync failed: ${r.stderr}`);
  await must('mkdir -p results && chmod 777 results');
}

function openTunnel() {
  tunnel?.kill();
  tunnel = spawn('ssh', ['-N', ...SSH_OPTS, '-o', 'ExitOnForwardFailure=yes', '-L', `${PROM_LOCAL_PORT}:127.0.0.1:9090`, '-L', '13001:127.0.0.1:3001', '-p', SSH_PORT, SSH_HOST], { stdio: 'ignore' });
}
process.on('exit', () => tunnel?.kill());

async function tunnelOk() {
  try {
    return (await fetch(`${PROM}/-/ready`, { signal: AbortSignal.timeout(5000) })).ok;
  } catch {
    return false;
  }
}

async function ensureTunnel() {
  if (!useSsh || (await tunnelOk())) return;
  log('prometheus tunnel is down, reopening it');
  openTunnel();
  await waitFor('prometheus tunnel', tunnelOk, 40, 1000);
}

async function prepare() {
  ensureKeys();
  if (useSsh) {
    const ping = await run('ssh', [...SSH_OPTS, '-p', SSH_PORT, SSH_HOST, 'hostname; nproc; docker ps --format "{{.Names}}" | wc -l'], {}, 60_000);
    if (ping.code !== 0) throw new Error(`cannot reach the staging server: ${ping.stderr}`);
    log(`staging server reachable: ${ping.stdout.trim().split('\n').join(' | ')} (host | cpus | running containers)`);
    await sync();
    openTunnel();
  }
  fs.mkdirSync(path.join(LT, 'results'), { recursive: true });
  fs.chmodSync(path.join(LT, 'results'), 0o777);

  if (!args['no-build']) {
    log('building image (gateway + stubs)');
    await must(compose('build gateway'), 1_200_000);
  }
  log(`starting ${eurekaKind} Eureka and config server`);
  await must(compose(`up -d ${eurekaKind === 'real' ? 'eureka' : 'eureka-stub'} config`));
  await waitFor('Eureka', async () => {
    const r = await sh(`docker exec bench-gw-config node -e "fetch('http://eureka:8761/eureka/apps').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"`);
    return r.code === 0;
  }, 180, 3000);
  log('starting backends, gateway, prometheus, grafana');
  await must(compose('up -d backend-a backend-b backend-c gateway prometheus grafana'));
  await waitFor('Prometheus API', async () => { await ensureTunnel(); return tunnelOk(); }, 90);
  await ensureHealthy();
  log('stack is healthy');
}

const NODE_CMD = 'node load-test/.tmp/stub-backend/main.js';
const killNode = (signal) => `docker exec bench-gw-backend-a sh -c 'kill -${signal} $(cat /tmp/node.pid)'`;
const startNode = (name = 'a') => `docker exec -d bench-gw-backend-${name} sh -c '${NODE_CMD} & echo $! > /tmp/node.pid; wait'`;
// Liveness = the port answers. A pid file can be stale after a container restart.
const listening = (name) =>
  `docker exec bench-gw-backend-${name} node -e "require('net').connect(4000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"`;

// Bring every backend back to "container up and node listening".
async function ensureBackends() {
  await sh('docker start bench-gw-backend-a bench-gw-backend-b bench-gw-backend-c');
  await sleep(4000);
  for (const name of ['a', 'b', 'c']) {
    if ((await sh(listening(name))).code !== 0) await sh(startNode(name));
  }
}

async function ensureHealthy(timeoutS = 240) {
  await ensureBackends();
  await waitFor('gateway scraped and every backend UP', async () => {
    if ((await scalar('up{job="expo-gateway"}')) !== 1) return false;
    for (const app of ['svc-a', 'svc-b', 'svc-c']) {
      if ((await scalar(`gateway_upstream_healthy_instances{app="${app}"}`)) !== 1) return false;
    }
    return true;
  }, timeoutS);
}

// ---- k6 -----------------------------------------------------------------------

async function runK6({ name, url, prefix = '', auth = false, rate, warmup, duration }) {
  const started = Date.now();
  // A stale file from an earlier run must never be mistaken for this run's result.
  await sh(`rm -f results/${name}.json`, 60_000);
  const cmd = compose(
    `run --rm -T --name bench-gw-k6-${name} k6 run /scripts/scenario.js -e TARGET_URL=${url} -e PATH_PREFIX=${prefix} -e TOKEN=${auth ? TOKEN : ''} -e RATE=${rate} -e WARMUP_S=${warmup} -e DURATION_S=${duration} -e OUT=${name}`,
  );
  const r = await sh(cmd, (warmup + duration) * 1000 + 180_000);
  if (r.code !== 0) log(`k6 exited ${r.code}${r.timedOut ? ' (timed out)' : ''} (thresholds are not used, so this usually means an error): ${r.stderr.slice(-300)}`);
  const raw = useSsh ? await must(`cat results/${name}.json`, 60_000) : fs.readFileSync(path.join(LT, 'results', `${name}.json`), 'utf8');
  return { ...JSON.parse(raw), startedAt: started, endedAt: Date.now() };
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n, d = 2) => (n === undefined || Number.isNaN(n) ? 'n/a' : n.toFixed(d));

async function calibrate() {
  if (args.rate) return Number(args.rate);
  const steps = fast ? [50, 100, 200] : [100, 200, 400, 800, 1200, 1600, 2000];
  let best = 0;
  log('calibrating: highest rate through the gateway with p95 < 100ms, no dropped iterations, all 200');
  for (const rate of steps) {
    const r = await runK6({ name: `calib-${rate}`, url: GATEWAY_URL, prefix: '/svc-a', auth: true, rate, warmup: 3, duration: fast ? 8 : 15 });
    const ok = r.droppedIterations === 0 && r.latencyMs.p95 < 100 && r.statusCounts[200] === r.measuredRequests;
    log(`  ${rate} rps: p95=${fmt(r.latencyMs.p95)}ms dropped=${r.droppedIterations} ok=${ok}`);
    if (!ok) break;
    best = rate;
  }
  const chosen = best ? Math.max(10, Math.floor(best * 0.5)) : 20;
  log(`calibration: max sustainable ≈ ${best || '<' + steps[0]} rps -> measuring at ${chosen} rps (~50%)`);
  return chosen;
}

// ---- latency scenarios --------------------------------------------------------

const LATENCY_SCENARIOS = {
  direct: { url: DIRECT_URL, prefix: '', auth: false },
  via: { url: GATEWAY_URL, prefix: '/svc-a', auth: true },
  public: { url: GATEWAY_URL, prefix: '/public', auth: false },
};

async function internalNumbers(windowS) {
  const w = `${Math.ceil(windowS)}s`;
  const ratio = (sum, count) => `increase(${sum}[${w}]) / increase(${count}[${w}])`;
  const total = await scalar(ratio('gateway_http_request_duration_seconds_sum{app="svc-a",status_class="2xx"}', 'gateway_http_request_duration_seconds_count{app="svc-a",status_class="2xx"}'));
  const upstream = await scalar(ratio('gateway_upstream_duration_seconds_sum{app="svc-a"}', 'gateway_upstream_duration_seconds_count{app="svc-a"}'));
  const lookup = await scalar(ratio('gateway_eureka_lookup_duration_seconds_sum{app="svc-a"}', 'gateway_eureka_lookup_duration_seconds_count{app="svc-a"}'));
  const cpu = await scalar(`rate(process_cpu_seconds_total{job="expo-gateway"}[${w}])`);
  return { totalMs: total * 1000, upstreamMs: upstream * 1000, lookupMs: lookup * 1000, gatewayCpuCores: cpu };
}

async function latencyScenarios(rate) {
  const passes = [['direct', 'via', 'public'], ['public', 'via', 'direct']];
  const results = { rate, passes: [] };
  for (const [passIndex, order] of passes.entries()) {
    const acc = { order, runs: { direct: [], via: [], public: [] } };
    for (let rep = 1; rep <= reps; rep++) {
      for (const scenario of order) {
        const spec = LATENCY_SCENARIOS[scenario];
        log(`latency pass ${passIndex + 1}/${passes.length} rep ${rep}/${reps}: ${scenario} @ ${rate} rps`);
        const r = await runK6({ name: `${scenario}-p${passIndex + 1}-r${rep}`, ...spec, rate, warmup: warmupS, duration: durationS });
        if (scenario !== 'direct') r.internal = await internalNumbers((r.endedAt - r.startedAt) / 1000 + 5);
        acc.runs[scenario].push(r);
      }
    }
    results.passes.push(acc);
  }
  return results;
}

function summarizeLatency(res) {
  const lines = [];
  const stat = (runs, key) => median(runs.map((r) => r.latencyMs[key]));
  const range = (runs, key) => {
    const v = runs.map((r) => r.latencyMs[key]);
    return `${fmt(Math.min(...v))}–${fmt(Math.max(...v))}`;
  };
  lines.push(`Target rate: ${res.rate} req/s, ${durationS}s measured after ${warmupS}s warm-up, ${reps} repetition(s), median reported.`);
  lines.push('');
  lines.push('| pass (order) | scenario | p50 ms | p95 ms | p99 ms | p95 range ms | non-200 | dropped |');
  lines.push('|---|---|---|---|---|---|---|---|');
  const overhead = [];
  for (const [i, pass] of res.passes.entries()) {
    for (const scenario of pass.order) {
      const runs = pass.runs[scenario];
      const non200 = runs.reduce((a, r) => a + (r.measuredRequests - r.statusCounts[200]), 0);
      const dropped = runs.reduce((a, r) => a + r.droppedIterations, 0);
      lines.push(`| ${i + 1} (${pass.order.join('→')}) | ${scenario} | ${fmt(stat(runs, 'p50'))} | ${fmt(stat(runs, 'p95'))} | ${fmt(stat(runs, 'p99'))} | ${range(runs, 'p95')} | ${non200} | ${dropped} |`);
    }
    overhead.push({
      pass: i + 1,
      gatewayP50: stat(pass.runs.via, 'p50') - stat(pass.runs.direct, 'p50'),
      gatewayP95: stat(pass.runs.via, 'p95') - stat(pass.runs.direct, 'p95'),
      jwtP95: stat(pass.runs.via, 'p95') - stat(pass.runs.public, 'p95'),
    });
  }
  lines.push('');
  lines.push('| pass | Gateway overhead p50 ms (via − direct) | Gateway overhead p95 ms (via − direct) | JWT verification p95 ms (via − public) |');
  lines.push('|---|---|---|---|');
  for (const o of overhead) lines.push(`| ${o.pass} | ${fmt(o.gatewayP50)} | ${fmt(o.gatewayP95)} | ${fmt(o.jwtP95)} |`);
  const [a, b] = overhead;
  if (b) {
    const diff = Math.abs(a.gatewayP95 - b.gatewayP95);
    const big = Math.max(Math.abs(a.gatewayP95), Math.abs(b.gatewayP95), 0.001);
    lines.push('');
    lines.push(`Order effect on p95 overhead: |pass1 − pass2| = ${fmt(diff)} ms (${fmt((diff / big) * 100, 0)}% of the larger)${diff / big > 0.1 ? ' — **over 10%, treat the overhead as noisy**' : ''}.`);
  }
  const internals = res.passes.flatMap((p) => p.runs.via.map((r) => r.internal)).filter(Boolean);
  if (internals.length) {
    lines.push('');
    lines.push(`From the gateway's own metrics (via, protected path, median of runs): total ${fmt(median(internals.map((i) => i.totalMs)), 3)} ms, upstream ${fmt(median(internals.map((i) => i.upstreamMs)), 3)} ms, per-request Eureka lookup ${fmt(median(internals.map((i) => i.lookupMs)), 3)} ms, gateway CPU ${fmt(median(internals.map((i) => i.gatewayCpuCores)), 2)} cores.`);
  }
  return lines.join('\n');
}

// ---- fault scenarios ----------------------------------------------------------

const TIMING = fast
  ? { sigterm: { killAt: 10, maxDetect: 40, hold: 5, maxRecover: 60 }, sigkill: { killAt: 10, maxDetect: 70, hold: 5, maxRecover: 60 }, hostdown: { killAt: 10, maxDetect: 70, hold: 5, maxRecover: 60 } }
  // hold > the 30s `for` of GatewayNoHealthyInstances, so that alert can be seen firing.
  : { sigterm: { killAt: 20, maxDetect: 90, hold: 45, maxRecover: 120 }, sigkill: { killAt: 20, maxDetect: 260, hold: 45, maxRecover: 120 }, hostdown: { killAt: 20, maxDetect: 260, hold: 45, maxRecover: 120 } };

async function faultRun(kind, rep, rate) {
  const t = TIMING[kind];
  const totalS = t.killAt + t.maxDetect + t.hold + t.maxRecover;
  await ensureHealthy();
  const t0 = Date.now();
  const rel = () => (Date.now() - t0) / 1000;
  const what = { sigterm: 'SIGTERM to the node process', sigkill: 'SIGKILL to the node process', hostdown: 'whole container killed (host disappears)' }[kind];
  log(`${kind} rep ${rep}: k6 for ${totalS}s at ${rate} rps; backend-a ${what} at t=${t.killAt}s`);
  let finished = false;
  const k6 = runK6({ name: `${kind}-r${rep}`, url: GATEWAY_URL, prefix: '/svc-a', auth: true, rate, warmup: 0, duration: totalS }).finally(() => (finished = true));

  const ev = { killedAt: undefined, first502At: undefined, upZeroAt: undefined, restoredAt: undefined, recoveredAt: undefined, alreadyFiring: [] };
  const alertFirst = {};
  const timeline = [];
  let detectTimedOut = false;
  let baseline502 = 0;

  while (!finished) {
    await sleep(2000);
    const now = rel();
    const [up, upB, r200, r502, r503, c502] = await Promise.all([
      scalar('gateway_upstream_healthy_instances{app="svc-a"}'),
      scalar('gateway_upstream_healthy_instances{app="svc-b"}'),
      scalar('sum(rate(gateway_http_requests_total{app="svc-a",status="200"}[10s]))'),
      scalar('sum(rate(gateway_http_requests_total{app="svc-a",status="502"}[10s]))'),
      scalar('sum(rate(gateway_http_requests_total{app="svc-a",status="503"}[10s]))'),
      scalar('sum(gateway_http_requests_total{app="svc-a",status="502"})'),
    ]).catch(() => []);
    const alerts = await firingAlerts().catch(() => []);
    timeline.push({ t: Number(now.toFixed(1)), up, upB, r200, r502, r503, c502, alerts });
    // An alert that was already firing when the fault started (a 5-minute-window alert
    // can carry over from the previous run) says nothing about this fault.
    if (ev.killedAt !== undefined) for (const a of alerts) if (!ev.alreadyFiring.includes(a)) alertFirst[a] ??= now - ev.killedAt;

    if (ev.killedAt === undefined && now >= t.killAt) {
      baseline502 = c502 ?? 0;
      ev.alreadyFiring = alerts;
      await sh(kind === 'hostdown' ? 'docker kill -s SIGKILL bench-gw-backend-a' : killNode(kind === 'sigkill' ? 'KILL' : 'TERM'));
      ev.killedAt = rel();
      log(`  t=${fmt(ev.killedAt, 1)}s backend-a killed (${kind})`);
    } else if (ev.killedAt !== undefined) {
      if (ev.first502At === undefined && (c502 ?? 0) > baseline502) ev.first502At = now;
      if (ev.upZeroAt === undefined && up === 0) { ev.upZeroAt = now; log(`  t=${fmt(now, 1)}s Gateway sees UP=0 (${fmt(now - ev.killedAt, 0)}s after the kill)`); }
      const detectDeadline = ev.killedAt + t.maxDetect;
      if (ev.restoredAt === undefined && ((ev.upZeroAt !== undefined && now - ev.upZeroAt >= t.hold) || (ev.upZeroAt === undefined && now >= detectDeadline))) {
        if (ev.upZeroAt === undefined) { detectTimedOut = true; log(`  UP never reached 0 within ${t.maxDetect}s (self-preservation or a longer lease) — restoring anyway`); }
        await sh(kind === 'hostdown' ? 'docker start bench-gw-backend-a' : startNode());
        ev.restoredAt = rel();
        log(`  t=${fmt(ev.restoredAt, 1)}s backend-a restarted`);
      }
      if (ev.restoredAt !== undefined && ev.recoveredAt === undefined && up === 1 && (r502 ?? 0) < 0.5 && (r503 ?? 0) < 0.5 && (r200 ?? 0) > 0) {
        ev.recoveredAt = now;
        log(`  t=${fmt(now, 1)}s recovered (${fmt(now - ev.restoredAt, 0)}s after restart)`);
      }
    }
  }
  const summary = await k6;
  return { kind, rep, rate, ...ev, detectTimedOut, alertFirst, timeline, k6: summary };
}

function summarizeFaults(runsByKind) {
  const lines = [];
  for (const [kind, runs] of Object.entries(runsByKind)) {
    const m = (f, unit = ' s') => {
      const v = runs.map(f).filter((x) => x !== undefined && !Number.isNaN(x));
      return v.length ? `${fmt(median(v), 0)}${unit}` : 'never';
    };
    const title = {
      sigterm: 'SIGTERM to the process (graceful: the library deregisters)',
      sigkill: 'SIGKILL to the process (crash/OOM on a live host: no deregistration, port refuses at once)',
      hostdown: 'Host disappears (container killed: no deregistration, IP unreachable)',
    }[kind];
    lines.push(`**${title}** — ${runs.length} run(s), median`);
    lines.push('');
    lines.push('| metric | value |');
    lines.push('|---|---|');
    lines.push(`| first 502 after the kill | ${m((r) => (r.first502At === undefined ? undefined : r.first502At - r.killedAt))} |`);
    lines.push(`| Gateway sees UP = 0 after the kill | ${m((r) => (r.upZeroAt === undefined ? undefined : r.upZeroAt - r.killedAt))} |`);
    lines.push(`| **502s flowing while UP was still ≥ 1** | ${m((r) => (r.first502At === undefined ? undefined : (r.upZeroAt ?? r.restoredAt ?? r.first502At) - r.first502At))} |`);
    lines.push(`| recovery after restart | ${m((r) => (r.recoveredAt === undefined ? undefined : r.recoveredAt - r.restoredAt))} |`);
    lines.push(`| 502 responses (k6) | ${m((r) => r.k6.statusCounts[502], '')} |`);
    lines.push(`| 503 responses (k6) | ${m((r) => r.k6.statusCounts[503], '')} |`);
    lines.push(`| 200 responses (k6) | ${m((r) => r.k6.statusCounts[200], '')} |`);
    const names = [...new Set(runs.flatMap((r) => Object.keys(r.alertFirst)))];
    for (const n of names) {
      lines.push(`| alert \`${n}\` first firing after the kill (design check) | ${m((r) => r.alertFirst[n])} (fired in ${runs.filter((r) => r.alertFirst[n] !== undefined).length}/${runs.length} runs) |`);
    }
    const carried = [...new Set(runs.flatMap((r) => r.alreadyFiring ?? []))];
    if (carried.length) lines.push(`| alerts already firing at the kill (carried over, excluded above) | ${carried.map((a) => `\`${a}\``).join(', ')} |`);
    const timedOut = runs.filter((r) => r.detectTimedOut).length;
    if (timedOut) lines.push(`| UP never reached 0 | ${timedOut}/${runs.length} runs |`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---- main ---------------------------------------------------------------------

async function main() {
  if (command === 'down') {
    await must(compose('down'));
    log('stack removed (volumes are not used; no -v)');
    return;
  }
  await prepare();
  if (command === 'up') {
    log('stack is up (no scenarios run). `run` reuses it; `down` removes it.');
    return;
  }
  const rate = await calibrate();
  const report = { startedAt: new Date().toISOString(), target: useSsh ? 'staging (ssh)' : 'local', eureka: eurekaKind, fast, rate, reps, durationS, warmupS };

  const sections = [];
  if (only.includes('latency')) {
    const res = await latencyScenarios(rate);
    report.latency = res;
    sections.push(`## Latency: Gateway overhead and JWT cost\n\n${summarizeLatency(res)}`);
  }
  const faults = {};
  for (const kind of ['sigterm', 'sigkill', 'hostdown']) {
    if (!only.includes(kind)) continue;
    faults[kind] = [];
    for (let rep = 1; rep <= reps; rep++) faults[kind].push(await faultRun(kind, rep, rate));
  }
  if (Object.keys(faults).length) {
    report.faults = faults;
    sections.push(`## Fault injection (backend svc-a)\n\n${summarizeFaults(faults)}`);
  }

  const header = `# Gateway load test (${report.target}, Eureka: ${eurekaKind}${fast ? ', FAST timings — not for reporting' : ''})\n\nRun: ${report.startedAt}\n`;
  const markdown = `${header}\n${sections.join('\n\n')}\n`;
  fs.mkdirSync(path.join(LT, 'results'), { recursive: true });
  fs.writeFileSync(path.join(LT, 'results', `report-${stamp}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(LT, 'results', `report-${stamp}.md`), markdown);
  console.log(`\n${markdown}`);
  log(`report written to load-test/results/report-${stamp}.{md,json}`);
  if (args.teardown) await must(compose('down'));
  else log('stack left running (Grafana: ' + (useSsh ? 'ssh tunnel on http://127.0.0.1:13001' : 'http://127.0.0.1:3001') + '); `down` removes it');
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
