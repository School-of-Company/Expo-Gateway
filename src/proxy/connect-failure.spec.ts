import { connectFailureReason } from './connect-failure';

const err = (code: string) => Object.assign(new Error(code), { code });
const fresh = { connected: false, connectTimedOut: false };

describe('connectFailureReason', () => {
  it.each([
    ['ECONNREFUSED', 'refused'],
    ['EHOSTUNREACH', 'unreachable'],
    ['ENETUNREACH', 'unreachable'],
    ['ETIMEDOUT', 'timeout'],
  ])('maps %s before the socket connected to %s', (code, reason) => {
    expect(connectFailureReason(err(code), fresh)).toBe(reason);
  });

  it('reports our own connect timeout', () => {
    expect(
      connectFailureReason(new Error('x'), {
        connected: false,
        connectTimedOut: true,
      }),
    ).toBe('timeout');
  });

  it('ignores anything once the socket was connected (the upstream may have the request)', () => {
    expect(
      connectFailureReason(err('ECONNRESET'), {
        connected: true,
        connectTimedOut: false,
      }),
    ).toBeUndefined();
    expect(
      connectFailureReason(err('ECONNREFUSED'), {
        connected: true,
        connectTimedOut: false,
      }),
    ).toBeUndefined();
  });

  it('ignores a reset on a socket that never connected', () => {
    expect(connectFailureReason(err('ECONNRESET'), fresh)).toBeUndefined();
  });
});
