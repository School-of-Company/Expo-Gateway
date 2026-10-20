import type { Request } from 'express';
import { matchesBffToken, rateLimitClientIp } from './client-ip';

const TOKEN = 'b'.repeat(40);
const VERCEL = '198.51.100.7';

// What Express produces with `trust proxy` = loopback when Apache (on
// loopback) appended the BFF's address: req.ip is the BFF, one entry consumed.
const viaApache = (headers: Record<string, string>): Request =>
  ({ headers, ip: VERCEL, ips: [VERCEL] }) as unknown as Request;

describe('matchesBffToken', () => {
  it('matches only the exact token', () => {
    expect(matchesBffToken(TOKEN, TOKEN)).toBe(true);
    expect(matchesBffToken(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(matchesBffToken('', TOKEN)).toBe(false);
    expect(matchesBffToken(undefined, TOKEN)).toBe(false);
    expect(matchesBffToken([TOKEN, TOKEN], TOKEN)).toBe(false);
  });
});

describe('rateLimitClientIp', () => {
  const withToken = (xff: string) =>
    viaApache({ 'x-bff-token': TOKEN, 'x-forwarded-for': xff });

  it('uses the user IP the BFF reported, left of the BFF hop', () => {
    expect(rateLimitClientIp(withToken(`203.0.113.10, ${VERCEL}`), TOKEN)).toBe(
      '203.0.113.10',
    );
    expect(
      rateLimitClientIp(withToken(`10.0.0.1, 2001:db8::1, ${VERCEL}`), TOKEN),
    ).toBe('2001:db8::1');
  });

  it('reads the rightmost entry when the BFF is the direct peer', () => {
    const req = {
      headers: { 'x-bff-token': TOKEN, 'x-forwarded-for': '203.0.113.10' },
      ip: VERCEL,
      ips: [],
    } as unknown as Request;
    expect(rateLimitClientIp(req, TOKEN)).toBe('203.0.113.10');
  });

  it('keeps req.ip without a valid token or with the feature off', () => {
    const xff = `203.0.113.10, ${VERCEL}`;
    expect(
      rateLimitClientIp(viaApache({ 'x-forwarded-for': xff }), TOKEN),
    ).toBe(VERCEL);
    expect(
      rateLimitClientIp(
        viaApache({ 'x-bff-token': 'wrong', 'x-forwarded-for': xff }),
        TOKEN,
      ),
    ).toBe(VERCEL);
    expect(rateLimitClientIp(withToken(xff), undefined)).toBe(VERCEL);
  });

  it.each([
    ['no entry left of the BFF', VERCEL],
    ['not an IP', `evil, ${VERCEL}`],
    ['an empty entry', `, ${VERCEL}`],
    ['a port', `203.0.113.10:1234, ${VERCEL}`],
    ['a zone id', `fe80::1%eth0, ${VERCEL}`],
    ['IPv4-mapped IPv6', `::ffff:203.0.113.10, ${VERCEL}`],
    ['hex IPv4-mapped IPv6', `::ffff:cb00:710a, ${VERCEL}`],
  ])('falls back to req.ip for %s', (_name, xff) => {
    expect(rateLimitClientIp(withToken(xff), TOKEN)).toBe(VERCEL);
  });

  it('falls back to req.ip without X-Forwarded-For', () => {
    expect(rateLimitClientIp(viaApache({ 'x-bff-token': TOKEN }), TOKEN)).toBe(
      VERCEL,
    );
  });
});
