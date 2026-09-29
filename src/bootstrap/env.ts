export interface BootEnv {
  configServerUrl: string;
  profile: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function readBootEnv(): BootEnv {
  const configServerUrl = requireEnv('CONFIG_SERVER_URL');
  const profile = process.env.PROFILE ?? process.env.NODE_ENV;
  if (!profile) {
    throw new Error('Missing required env var: PROFILE (or NODE_ENV)');
  }
  return { configServerUrl, profile };
}

export function readInstanceEnv() {
  return {
    hostName: requireEnv('INSTANCE_HOSTNAME'),
    ipAddr: requireEnv('INSTANCE_IP_ADDR'),
    port: Number(process.env.PORT) || 3000,
  };
}
