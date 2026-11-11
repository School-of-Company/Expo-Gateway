import { Agent } from 'node:http';

// Without an agent http-proxy sends `Connection: close` and opens a fresh TCP
// connection per request (handshake every time, TIME_WAIT piling up, ephemeral
// ports at risk under load). Upstreams are Eureka `ipAddr` over plain http, so
// one http agent covers them; its pool is per host:port, i.e. per instance.
//
// Idle sockets are dropped before the backend's own keep-alive timeout (Node's
// default is 5s) so the gateway never reuses a socket the backend is closing,
// which would surface as ECONNRESET -> 502. Node also honours a shorter
// `Keep-Alive: timeout=` hint from the backend on its own.
export const UPSTREAM_IDLE_SOCKET_TIMEOUT_MS = 4_000;

// Cap per instance. Past it requests queue in the agent instead of opening
// more connections; at the measured ~400 req/s and ~30ms upstream latency
// about a dozen sockets are busy, so this only bites on a stalled backend.
export const UPSTREAM_MAX_SOCKETS = 512;

export function createUpstreamAgent(): Agent {
  return new Agent({
    keepAlive: true,
    // Socket timeout: for a free socket it means "close when idle this long".
    // A request in flight only gets a `timeout` event nobody listens to, and
    // once its body is in ProxyController replaces it with the upstream timeout.
    timeout: UPSTREAM_IDLE_SOCKET_TIMEOUT_MS,
    maxSockets: UPSTREAM_MAX_SOCKETS,
  });
}
