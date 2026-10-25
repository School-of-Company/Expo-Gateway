import { BlockList, isIP } from 'node:net';

export interface UpstreamPolicyConfig {
  /**
   * `"IP"` or `"IP/prefix"`. When present, an instance must fall inside one of
   * them; when absent only the always-blocked ranges below are refused (local
   * development registers loopback instances).
   */
  readonly allowedCidrs?: readonly string[];
  readonly allowedPorts?: { readonly min: number; readonly max: number };
}

export interface UpstreamPolicy {
  isAllowed(ipAddr: unknown, port: unknown): boolean;
}

/**
 * Never a service address, whatever the policy says: unspecified, link-local
 * (cloud metadata lives at 169.254.169.254), multicast, broadcast. `BlockList`
 * also matches the IPv4-mapped IPv6 form (`::ffff:169.254.169.254`).
 */
const alwaysBlocked = new BlockList();
alwaysBlocked.addAddress('0.0.0.0', 'ipv4');
alwaysBlocked.addSubnet('169.254.0.0', 16, 'ipv4');
alwaysBlocked.addSubnet('224.0.0.0', 4, 'ipv4');
alwaysBlocked.addAddress('255.255.255.255', 'ipv4');
alwaysBlocked.addAddress('::', 'ipv6');
alwaysBlocked.addSubnet('fe80::', 10, 'ipv6');
alwaysBlocked.addSubnet('ff00::', 8, 'ipv6');

/** `"IP"` or `"IP/prefix"` with a prefix valid for its family. */
export function isValidCidrEntry(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^([^/]+)(?:\/(\d{1,3}))?$/.exec(value);
  if (!match || match[1].includes('%')) return false;
  const family = isIP(match[1]);
  if (family === 0) return false;
  const max = family === 4 ? 32 : 128;
  return match[2] === undefined || Number(match[2]) <= max;
}

const familyOf = (ip: string): 'ipv4' | 'ipv6' =>
  isIP(ip) === 4 ? 'ipv4' : 'ipv6';

/** Built once at boot; `isAllowed` is a couple of bit comparisons per instance. */
export function compileUpstreamPolicy(
  config: UpstreamPolicyConfig | undefined,
): UpstreamPolicy {
  let allowed: BlockList | undefined;
  if (config?.allowedCidrs) {
    allowed = new BlockList();
    for (const entry of config.allowedCidrs) {
      const [address, prefix] = entry.split('/');
      if (prefix === undefined) {
        allowed.addAddress(address, familyOf(address));
      } else {
        allowed.addSubnet(address, Number(prefix), familyOf(address));
      }
    }
  }
  const ports = config?.allowedPorts;

  return {
    isAllowed(ipAddr, port) {
      // The target is built as `http://${ip}:${port}`: anything but a plain IP
      // literal and an integer port could change where the request goes.
      if (typeof ipAddr !== 'string' || isIP(ipAddr) === 0) return false;
      if (!Number.isInteger(port)) return false;
      const portNumber = port as number;
      if (portNumber < 1 || portNumber > 65535) return false;
      if (ports && (portNumber < ports.min || portNumber > ports.max)) {
        return false;
      }
      const family = familyOf(ipAddr);
      if (alwaysBlocked.check(ipAddr, family)) return false;
      return allowed ? allowed.check(ipAddr, family) : true;
    },
  };
}
