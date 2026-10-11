// Stands in for expo-config-server in load tests: answers the one call the
// gateway makes at boot, GET /configs/gateway/:profile. The JWT public key is
// read from PUBLIC_KEY_FILE (the load-test orchestrator generates the pair).
import fs from 'node:fs';
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8888);
const EUREKA_URL = process.env.EUREKA_URL ?? 'http://eureka:8761/eureka';
const publicKey = fs.readFileSync(process.env.PUBLIC_KEY_FILE ?? '/keys/public.pem', 'utf8');

const config = {
  jwt: { publicKey },
  eureka: { serviceUrl: EUREKA_URL },
  routing: {
    prefixes: {
      '/svc-a': 'svc-a',
      '/svc-b': 'svc-b',
      '/svc-c': 'svc-c',
      // Same backend as /svc-a but public: isolates the JWT verification cost.
      '/public': 'svc-a',
    },
  },
  // Large enough that the rate limiter never interferes with the measurement.
  rateLimit: { ttlSeconds: 60, limit: 100_000_000 },
  publicPaths: ['/health', '/public'],
};

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/configs/gateway/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
      return;
    }
    res.writeHead(404).end();
  })
  .listen(PORT, '0.0.0.0', () => console.log(`[stub-config] listening on ${PORT}`));
