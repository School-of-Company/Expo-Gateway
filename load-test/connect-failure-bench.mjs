#!/usr/bin/env node
// Before/After bench for the upstream connect timeout and passive health check
// (#105). Local Docker only, stub Eureka with its default (non --fast) timings,
// so a killed svc-a instance stays UP in Eureka for the whole fault window.
//
// Each run: fresh gateway container (Before or After image), k6 at RATE req/s
// for DURATION_S, svc-a's backend-a killed at KILL_AT_S and restored at
// RESTORE_AT_S. Versions alternate order per rep (cross-over). With
// --instances 2 a second svc-a instance (backend-a2) stays alive throughout.
//
//   GW_IMAGE_BEFORE=bench-gw105:before GW_IMAGE_AFTER=bench-gw105:after \
//   BENCH_APP_IMAGE=bench-gw105:after \
//     nice -n 15 node load-test/connect-failure-bench.mjs --reps 3
//   node load-test/connect-failure-bench.mjs down
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const LT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
const REPS = Number(opt('reps', 3));
const START_REP = Number(opt('start-rep', 1)); // resume after an interrupted run
const RATE = Number(opt('rate', 200));
const DURATION_S = Number(opt('duration', 80));
const KILL_AT_S = Number(opt('kill-at', 10));
const RESTORE_AT_S = Number(opt('restore-at', 60));
const INSTANCES = opt('instances', '2,1').split(',').map(Number);
const SCENARIOS = opt('scenarios', 'sigkill,hostdown').split(',');
const IMAGES = {
  before: process.env.GW_IMAGE_BEFORE ?? 'bench-gw105:before',
  after: process.env.GW_IMAGE_AFTER ?? 'bench-gw105:after',
};
const APP_IMAGE = process.env.BENCH_APP_IMAGE ?? IMAGES.after;

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, env = {}, timeoutMs = 600_000) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', cmd], { cwd: LT, env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}
async function must(cmd, env) {
  const r = await sh(cmd, env);
  if (r.code !== 0) throw new Error(`failed (${r.code}): ${cmd}\n${r.err || r.out}`);
  return r.out;
}

const compose = (rest) =>
  `docker compose -p bench-gw -f docker-compose.yml -f docker-compose.connect-failure.yml --profile stub-eureka --profile run ${rest}`;
const composeEnv = (gwImage = IMAGES.after) => ({ BENCH_APP_IMAGE: APP_IMAGE, GW_IMAGE: gwImage });

let TOKEN = '';
let privateKey;
// The gateway rejects access tokens that live longer than 15 minutes
// (src/auth/jwt-verify.ts), so a fresh one is signed for every run.
function signToken() {
  TOKEN = jwt.sign({ sub: 'load-test-user' }, privateKey, { algorithm: 'RS256', expiresIn: '14m' });
}
function ensureKeys() {
  const dir = path.join(LT, '.tmp', 'keys');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'private.pem'))) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(path.join(dir, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    fs.writeFileSync(path.join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  }
  privateKey = fs.readFileSync(path.join(dir, 'private.pem'));
  signToken();
}

const inConfig = (js) => sh(`docker exec bench-gw-config node -e ${JSON.stringify(js)}`);
async function gatewayMetrics() {
  const r = await inConfig("fetch('http://gateway:9464/metrics').then(r=>r.text()).then(t=>console.log(t)).catch(()=>process.exit(1))");
  return r.code === 0 ? r.out : '';
}
const metricValue = (text, re) => {
  let sum = 0;
  for (const line of text.split('\n')) if (re.test(line)) sum += Number(line.split(' ').pop());
  return sum;
};
async function viaGatewayOk() {
  const r = await inConfig(
    `fetch('http://gateway:3000/svc-a/item/1',{headers:{authorization:'Bearer ${TOKEN}'}}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))`,
  );
  return r.code === 0;
}

const backends = (n) => (n === 2 ? ['a', 'a2'] : ['a']);
const listening = (name) =>
  `docker exec bench-gw-backend-${name} node -e "require('net').connect(4000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"`;
const startNode = (name) =>
  `docker exec -d bench-gw-backend-${name} sh -c 'node load-test/.tmp/stub-backend/main.js & echo $! > /tmp/node.pid; wait'`;

async function waitFor(label, pred, timeoutS) {
  const end = Date.now() + timeoutS * 1000;
  while (Date.now() < end) {
    if (await pred()) return;
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function prepareRun(n, version) {
  signToken();
  for (const b of backends(n)) {
    await sh(`docker start bench-gw-backend-${b}`);
  }
  await sleep(3000);
  for (const b of backends(n)) {
    if ((await sh(listening(b))).code !== 0) await sh(startNode(b));
  }
  await must(compose('up -d --no-build --force-recreate gateway'), composeEnv(IMAGES[version]));
  await waitFor(`gateway sees ${n} svc-a instance(s) and every one answers`, async () => {
    const text = await gatewayMetrics();
    if (metricValue(text, /^gateway_upstream_healthy_instances\{app="svc-a"\}/) !== n) return false;
    for (let i = 0; i < 2 * n; i++) if (!(await viaGatewayOk())) return false;
    return true;
  }, 240);
}

function analyse(name, killWall, restoreWall) {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(LT, 'results', `${name}.json.gz`))).toString();
  const reqs = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('"measured_duration"') || !line.includes('"Point"')) continue;
    const p = JSON.parse(line);
    const end = Date.parse(p.data.time);
    reqs.push({ start: end - p.data.value, ms: p.data.value, st: Number(p.data.tags.st) });
  }
  const errs = reqs.filter((r) => r.st !== 200).sort((a, b) => a.start - b.start);
  const afterKill = errs.filter((r) => r.start >= killWall - 1000);
  return {
    requests: reqs.length,
    errorWindowS: afterKill.length ? (afterKill.at(-1).start - afterKill[0].start) / 1000 : 0,
    firstErrorAfterKillS: afterKill.length ? (afterKill[0].start - killWall) / 1000 : undefined,
    errorsAfterRestore: errs.filter((r) => r.start > restoreWall).length,
    hungOver5s: reqs.filter((r) => r.ms >= 5000).length,
  };
}

async function faultRun(n, kind, version, rep) {
  await prepareRun(n, version);
  const name = `cf-${n}i-${kind}-${version}-r${rep}`;
  await sh(`rm -f results/${name}.json results/${name}.json.gz`);
  log(`${name}: k6 ${DURATION_S}s at ${RATE} rps, kill backend-a at ${KILL_AT_S}s, restore at ${RESTORE_AT_S}s`);
  const k6 = sh(
    compose(
      `run --rm -T --name bench-gw-k6-${name} k6 run --quiet --out json=/results/${name}.json.gz /scripts/connect-failure.js -e TARGET_URL=http://gateway:3000 -e TOKEN=${TOKEN} -e RATE=${RATE} -e DURATION_S=${DURATION_S} -e OUT=${name}`,
    ),
    composeEnv(IMAGES[version]),
    (DURATION_S + 300) * 1000,
  );
  // k6 needs a moment to start; anchor the timeline on its first request.
  await sleep(2000 + KILL_AT_S * 1000);
  await must(kind === 'hostdown' ? 'docker kill -s SIGKILL bench-gw-backend-a' : `docker exec bench-gw-backend-a sh -c 'kill -KILL $(cat /tmp/node.pid)'`);
  const killWall = Date.now();
  await sleep((RESTORE_AT_S - KILL_AT_S) * 1000);
  await sh(kind === 'hostdown' ? 'docker start bench-gw-backend-a' : startNode('a'));
  const restoreWall = Date.now();
  const r = await k6;
  if (r.code !== 0) log(`  k6 exited ${r.code}: ${r.err.slice(-300)}`);
  const summary = JSON.parse(fs.readFileSync(path.join(LT, 'results', `${name}.json`), 'utf8'));
  const text = await gatewayMetrics();
  const gw = {
    connectFailures: metricValue(text, /^gateway_upstream_connect_failures_total\{app="svc-a"/),
    quarantines: metricValue(text, /^gateway_upstream_quarantines_total\{app="svc-a"/),
    retries: metricValue(text, /^gateway_upstream_retries_total\{app="svc-a"/),
  };
  const result = { name, n, kind, version, rep, ...summary, ...analyse(name, killWall, restoreWall), gateway: gw };
  log(`  ${JSON.stringify({ s: result.statusCounts, p99: Math.round(result.latencyMs.p99), max: Math.round(result.latencyMs.max), win: result.errorWindowS, hung: result.hungOver5s, dropped: result.droppedIterations, gw })}`);
  return result;
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function table(results) {
  const rows = ['| 인스턴스 | 시나리오 | 버전 | 502 | 504 | status 0 | 오류 구간(s) | p99(ms) | 최대(ms) | ≥5s 요청 | dropped |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const n of INSTANCES) for (const kind of SCENARIOS) for (const version of ['before', 'after']) {
    const rs = results.filter((r) => r.n === n && r.kind === kind && r.version === version);
    if (!rs.length) continue;
    const cell = (f, d = 0) => `${rs.map((r) => f(r).toFixed(d)).join(' / ')} (중앙 ${median(rs.map(f)).toFixed(d)})`;
    rows.push(`| ${n} | ${kind} | ${version} | ${cell((r) => r.statusCounts[502])} | ${cell((r) => r.statusCounts[504])} | ${cell((r) => r.statusCounts[0])} | ${cell((r) => r.errorWindowS, 1)} | ${cell((r) => r.latencyMs.p99)} | ${cell((r) => r.latencyMs.max)} | ${cell((r) => r.hungOver5s)} | ${cell((r) => r.droppedIterations)} |`);
  }
  return rows.join('\n');
}

async function main() {
  if (command === 'down') {
    await must(compose('down'), composeEnv());
    return;
  }
  ensureKeys();
  fs.mkdirSync(path.join(LT, 'results'), { recursive: true });
  fs.chmodSync(path.join(LT, 'results'), 0o777);
  await must(compose('up -d --no-build eureka-stub config'), composeEnv());
  await waitFor('Eureka', async () => (await inConfig("fetch('http://eureka:8761/eureka/apps').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))")).code === 0, 120);
  await must(compose(`up -d --no-build backend-a${INSTANCES.includes(2) ? ' backend-a2' : ''}`), composeEnv());

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(LT, 'results', `connect-failure-${stamp}.json`);
  const results = [];
  for (const n of INSTANCES) {
    if (n === 1) {
      // Deregister a2 cleanly (the library does it on SIGTERM), then wait for
      // the Eureka response cache to drop it.
      await sh(`docker exec bench-gw-backend-a2 sh -c 'kill -TERM $(cat /tmp/node.pid)'`);
      await sleep(2000);
      await sh('docker stop -t 1 bench-gw-backend-a2');
    }
    for (let rep = START_REP; rep <= REPS; rep++) {
      for (const kind of SCENARIOS) {
        const order = rep % 2 ? ['before', 'after'] : ['after', 'before'];
        for (const version of order) {
          results.push(await faultRun(n, kind, version, rep));
          fs.writeFileSync(out, JSON.stringify(results, null, 2));
        }
      }
    }
  }
  console.log(`\n${table(results)}\n`);
  log(`raw results: ${out}`);
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
