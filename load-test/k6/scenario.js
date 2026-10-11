// Load shape only. Fault injection (killing a backend) happens outside k6, on
// a timeline driven by load-test/run.mjs.
//
// env: TARGET_URL, PATH_PREFIX (default ''), TOKEN (optional bearer), RATE
// (requests/s), WARMUP_S (default 15, 0 to skip), DURATION_S (default 60), OUT
// (summary file name under /results).
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const TARGET_URL = __ENV.TARGET_URL;
const PATH_PREFIX = __ENV.PATH_PREFIX || '';
const TOKEN = __ENV.TOKEN || '';
const RATE = Number(__ENV.RATE || 100);
const WARMUP_S = Number(__ENV.WARMUP_S || 15);
const DURATION_S = Number(__ENV.DURATION_S || 60);
const OUT = __ENV.OUT || 'summary';

const measured = new Trend('measured_duration', true);
const STATUSES = [0, 200, 401, 404, 429, 499, 500, 502, 503, 504];
const byStatus = Object.fromEntries(STATUSES.map((s) => [s, new Counter(`status_${s}`)]));
const otherStatus = new Counter('status_other');

function arrival(executor, exec, duration, startTime) {
  return {
    executor: 'constant-arrival-rate',
    rate: RATE,
    timeUnit: '1s',
    duration: `${duration}s`,
    startTime: `${startTime}s`,
    preAllocatedVUs: Math.max(50, Math.ceil(RATE / 4)),
    maxVUs: Math.max(200, RATE * 2),
    exec,
  };
}

const scenarios = {};
if (WARMUP_S > 0) scenarios.warmup = arrival('', 'warmup', WARMUP_S, 0);
scenarios.measure = arrival('', 'measure', DURATION_S, WARMUP_S);

export const options = {
  scenarios,
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

let seq = 0;
function request() {
  const params = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : {};
  return http.get(`${TARGET_URL}${PATH_PREFIX}/item/${seq++ % 1000}`, params);
}

export function warmup() {
  request();
}

export function measure() {
  const res = request();
  measured.add(res.timings.duration);
  (byStatus[res.status] || otherStatus).add(1);
}

export function handleSummary(data) {
  const trend = data.metrics.measured_duration?.values || {};
  const counts = {};
  for (const s of STATUSES) {
    counts[s] = data.metrics[`status_${s}`]?.values.count || 0;
  }
  counts.other = data.metrics.status_other?.values.count || 0;
  const summary = {
    rate: RATE,
    latencyMs: {
      avg: trend.avg, min: trend.min, p50: trend.med,
      p90: trend['p(90)'], p95: trend['p(95)'], p99: trend['p(99)'], max: trend.max,
    },
    statusCounts: counts,
    droppedIterations: data.metrics.dropped_iterations?.values.count || 0,
  };
  summary.measuredRequests = Object.values(counts).reduce((a, b) => a + b, 0);
  return { [`/results/${OUT}.json`]: JSON.stringify(summary, null, 2) };
}
