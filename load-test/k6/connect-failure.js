// Constant 200-ish req/s at one gateway path for connect-failure-bench.mjs.
// Same arrival settings as scenario.js; gracefulStop is long enough that a
// request hanging until k6's 60s timeout is still counted instead of cut off.
// Per-request timing comes from `--out json`, the totals from handleSummary.
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const RATE = Number(__ENV.RATE || 200);
const DURATION_S = Number(__ENV.DURATION_S || 80);
const OUT = __ENV.OUT || 'summary';

const measured = new Trend('measured_duration', true);
const STATUSES = [0, 200, 499, 502, 503, 504];
const byStatus = Object.fromEntries(STATUSES.map((s) => [s, new Counter(`status_${s}`)]));
const otherStatus = new Counter('status_other');

export const options = {
  scenarios: {
    measure: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: `${DURATION_S}s`,
      preAllocatedVUs: Math.max(50, Math.ceil(RATE / 4)),
      maxVUs: Math.max(200, RATE * 2),
      gracefulStop: '70s',
    },
  },
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'med', 'p(99)', 'max'],
};

let seq = 0;
export default function () {
  const res = http.get(`${__ENV.TARGET_URL}/svc-a/item/${seq++ % 1000}`, {
    headers: { Authorization: `Bearer ${__ENV.TOKEN}` },
  });
  measured.add(res.timings.duration, { st: String(res.status) });
  (byStatus[res.status] || otherStatus).add(1);
}

export function handleSummary(data) {
  const t = data.metrics.measured_duration?.values || {};
  const counts = {};
  for (const s of STATUSES) counts[s] = data.metrics[`status_${s}`]?.values.count || 0;
  counts.other = data.metrics.status_other?.values.count || 0;
  return {
    [`/results/${OUT}.json`]: JSON.stringify({
      latencyMs: { avg: t.avg, p50: t.med, p99: t['p(99)'], max: t.max },
      statusCounts: counts,
      droppedIterations: data.metrics.dropped_iterations?.values.count || 0,
    }),
  };
}
