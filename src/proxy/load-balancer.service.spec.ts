import { LoadBalancerService } from './load-balancer.service';
import { EurekaLookupError, NoHealthyInstanceError } from './proxy.errors';
import type {
  EurekaInstance,
  EurekaService,
} from '@school-of-company/nestjs-eureka';

function instance(overrides: Partial<EurekaInstance>): EurekaInstance {
  return {
    instanceId: 'id',
    app: 'EXPO-FORM-SERVER',
    hostName: 'host',
    ipAddr: '10.0.0.1',
    status: 'UP',
    port: 8080,
    metadata: {},
    ...overrides,
  };
}

describe('LoadBalancerService', () => {
  it('round-robins across multiple UP instances', async () => {
    const instances = [
      instance({ ipAddr: '10.0.0.1', port: 1 }),
      instance({ ipAddr: '10.0.0.2', port: 2 }),
    ];
    const eureka = {
      getInstances: jest.fn().mockResolvedValue(instances),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka);

    const first = await lb.pickInstanceUrl('expo-form-server');
    const second = await lb.pickInstanceUrl('expo-form-server');
    const third = await lb.pickInstanceUrl('expo-form-server');

    expect(first).toBe('http://10.0.0.1:1');
    expect(second).toBe('http://10.0.0.2:2');
    expect(third).toBe('http://10.0.0.1:1');
  });

  it('filters out DOWN instances', async () => {
    const instances = [
      instance({ ipAddr: '10.0.0.1', port: 1, status: 'DOWN' }),
      instance({ ipAddr: '10.0.0.2', port: 2, status: 'UP' }),
    ];
    const eureka = {
      getInstances: jest.fn().mockResolvedValue(instances),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka);

    expect(await lb.pickInstanceUrl('expo-form-server')).toBe(
      'http://10.0.0.2:2',
    );
  });

  it('throws NoHealthyInstanceError when no instance is UP', async () => {
    const instances = [instance({ status: 'DOWN' })];
    const eureka = {
      getInstances: jest.fn().mockResolvedValue(instances),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka);

    await expect(lb.pickInstanceUrl('expo-form-server')).rejects.toThrow(
      NoHealthyInstanceError,
    );
  });

  it('throws NoHealthyInstanceError when the app has zero instances', async () => {
    const eureka = {
      getInstances: jest.fn().mockResolvedValue([]),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka);

    await expect(lb.pickInstanceUrl('expo-form-server')).rejects.toThrow(
      NoHealthyInstanceError,
    );
  });

  it('wraps a lookup failure in EurekaLookupError', async () => {
    const eureka = {
      getInstances: jest.fn().mockRejectedValue(new Error('network error')),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka);

    await expect(lb.pickInstanceUrl('expo-form-server')).rejects.toThrow(
      EurekaLookupError,
    );
  });
});
