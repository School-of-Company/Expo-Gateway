import * as express from 'express';
import type { Request } from 'express';
import { parseGatewayConfig } from './gateway-config.validate';
import type { GatewayConfig } from './gateway-config.types';
import { isTrustedProxyEntry, trustProxy } from './trust-proxy';

const NEXT = '198.51.100.7';
const base = {
  jwt: { publicKey: 'unused' },
  eureka: { serviceUrl: 'http://unused:8761/eureka' },
  routing: { prefixes: { '/auth': 'expo-user-server' } },
};

/** Express's own `req.ip` getter (proxy-addr), for a given socket peer and header. */
function ipOf(
  config: GatewayConfig,
  remoteAddress: string,
  forwardedFor?: string,
): string | undefined {
  const app = express();
  app.set('trust proxy', trustProxy(config));
  const req = Object.create(app.request) as Request;
  Object.assign(req, {
    app,
    socket: { remoteAddress },
    headers:
      forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  });
  return req.ip;
}

describe('trustProxy (real Express req.ip)', () => {
  const config = parseGatewayConfig({ ...base, trustedProxies: [NEXT] });

  it.each([
    [
      'browser → Next → Apache',
      '127.0.0.1',
      `203.0.113.10, ${NEXT}`,
      '203.0.113.10',
    ],
    [
      'a second user on the same chain',
      '127.0.0.1',
      `203.0.113.11, ${NEXT}`,
      '203.0.113.11',
    ],
    [
      'forged XFF sent straight to Apache',
      '127.0.0.1',
      '1.2.3.4, 198.51.100.66',
      '198.51.100.66',
    ],
    [
      'untrusted hop between client and Next',
      '127.0.0.1',
      `1.2.3.4, 192.0.2.50, ${NEXT}`,
      '192.0.2.50',
    ],
    [
      'Apache over IPv6 loopback',
      '::1',
      `203.0.113.10, ${NEXT}`,
      '203.0.113.10',
    ],
    [
      'Apache socket as IPv4-mapped IPv6',
      '::ffff:127.0.0.1',
      `203.0.113.10, ${NEXT}`,
      '203.0.113.10',
    ],
    [
      'Next IP as IPv4-mapped IPv6 in XFF',
      '127.0.0.1',
      `203.0.113.10, ::ffff:${NEXT}`,
      '203.0.113.10',
    ],
    ['Apache without XFF', '127.0.0.1', undefined, '127.0.0.1'],
    [
      'non-loopback peer connecting to the gateway port directly',
      '192.0.2.99',
      '1.2.3.4',
      '192.0.2.99',
    ],
  ])('%s', (_name, peer, xff, expected) => {
    expect(ipOf(config, peer, xff)).toBe(expected);
  });

  it("keeps today's Apache-only behaviour when trustedProxies is absent", () => {
    const loopbackOnly = parseGatewayConfig(base);
    expect(trustProxy(loopbackOnly)).toEqual(['loopback']);
    expect(ipOf(loopbackOnly, '127.0.0.1', `203.0.113.10, ${NEXT}`)).toBe(NEXT);
    expect(ipOf(loopbackOnly, '192.0.2.99', '1.2.3.4')).toBe('192.0.2.99');
  });

  it('trusts every listed proxy', () => {
    const two = parseGatewayConfig({
      ...base,
      trustedProxies: [NEXT, '2001:db8::/64'],
    });
    expect(ipOf(two, '127.0.0.1', `203.0.113.10, 2001:db8::5, ${NEXT}`)).toBe(
      '203.0.113.10',
    );
  });
});

describe('trustedProxies validation', () => {
  it.each([NEXT, '198.51.100.0/24', '2001:db8::1', '2001:db8::/64'])(
    'accepts %s',
    (entry) => expect(isTrustedProxyEntry(entry)).toBe(true),
  );

  it.each([
    '0.0.0.0/0',
    '::/0',
    '198.51.0.0/16',
    '2001:db8::/48',
    '198.51.100.7/33',
    '2001:db8::/129',
    '::ffff:198.51.100.7',
    '::ffff:0:0/96',
    '0:0:0:0:0:ffff:c633:6407',
    'fe80::1%eth0',
    'loopback',
    'uniquelocal',
    '198.51.100.256',
    ' 198.51.100.7',
    '198.51.100.7/',
    '198.51.100.7/24/1',
    '',
    1,
    true,
  ])('rejects %p', (entry) => {
    expect(isTrustedProxyEntry(entry)).toBe(false);
  });

  it.each([2, true, '198.51.100.7', [NEXT, '0.0.0.0/0'], null])(
    'fails boot validation for trustedProxies: %p',
    (trustedProxies) => {
      expect(() => parseGatewayConfig({ ...base, trustedProxies })).toThrow(
        /trustedProxies must be an array/,
      );
    },
  );
});
