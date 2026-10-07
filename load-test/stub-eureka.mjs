// Minimal Eureka server for the LOCAL load-test mode only (there is no arm64
// Eureka image). It implements just the REST calls nestjs-eureka makes and
// emulates Eureka's timing: instances that stop renewing stay UP until their
// lease expires and the eviction timer runs, and lookups are served from a
// snapshot refreshed every CACHE_MS (Eureka's read-only response cache).
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8761);
const EVICTION_MS = Number(process.env.EVICTION_MS ?? 60_000);
const CACHE_MS = Number(process.env.CACHE_MS ?? 30_000);
const DEFAULT_LEASE_S = 90;

const registry = new Map(); // APP -> Map(instanceId -> { instance, lastRenewal, leaseMs })
let snapshot = new Map(); // APP -> instance[]

function log(message) {
  console.log(`[stub-eureka ${new Date().toISOString()}] ${message}`);
}

function takeSnapshot() {
  const next = new Map();
  for (const [app, instances] of registry) {
    next.set(app, [...instances.values()].map((entry) => entry.instance));
  }
  snapshot = next;
}

function evict() {
  const now = Date.now();
  for (const [app, instances] of registry) {
    for (const [id, entry] of instances) {
      if (now - entry.lastRenewal > entry.leaseMs) {
        instances.delete(id);
        log(`evicted ${app}/${id} (lease expired)`);
      }
    }
    if (instances.size === 0) registry.delete(app);
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  if (parts[0] !== 'eureka' || parts[1] !== 'apps' || !parts[2]) {
    res.writeHead(404).end();
    return;
  }
  const app = decodeURIComponent(parts[2]).toUpperCase();
  const id = parts[3] ? decodeURIComponent(parts[3]) : undefined;

  if (req.method === 'POST' && !id) {
    const { instance } = JSON.parse(await readBody(req));
    const leaseMs = (instance.leaseInfo?.durationInSecs ?? DEFAULT_LEASE_S) * 1000;
    const instances = registry.get(app) ?? new Map();
    instances.set(instance.instanceId, { instance, lastRenewal: Date.now(), leaseMs });
    registry.set(app, instances);
    log(`registered ${app}/${instance.instanceId} (lease ${leaseMs / 1000}s)`);
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'PUT' && id) {
    const entry = registry.get(app)?.get(id);
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    entry.lastRenewal = Date.now();
    res.writeHead(200).end();
    return;
  }
  if (req.method === 'DELETE' && id) {
    const removed = registry.get(app)?.delete(id);
    log(`deregistered ${app}/${id}${removed ? '' : ' (was not registered)'}`);
    res.writeHead(removed ? 200 : 404).end();
    return;
  }
  if (req.method === 'GET' && !id) {
    const source = CACHE_MS > 0 ? snapshot : new Map([...registry].map(([a, m]) => [a, [...m.values()].map((e) => e.instance)]));
    const instances = source.get(app) ?? [];
    if (instances.length === 0) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ application: { name: app, instance: instances } }));
    return;
  }
  res.writeHead(404).end();
});

setInterval(evict, EVICTION_MS);
if (CACHE_MS > 0) setInterval(takeSnapshot, CACHE_MS);
server.listen(PORT, '0.0.0.0', () =>
  log(`listening on ${PORT} (eviction ${EVICTION_MS}ms, response cache ${CACHE_MS}ms)`),
);
