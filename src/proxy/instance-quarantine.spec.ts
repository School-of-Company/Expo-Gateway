import { InstanceQuarantine } from './instance-quarantine';

describe('InstanceQuarantine', () => {
  let now: number;
  const q = () => new InstanceQuarantine(10_000, () => now);

  beforeEach(() => {
    now = 1_000;
  });

  it('hides an instance until the quarantine runs out', () => {
    const quarantine = q();
    expect(quarantine.add('a', 'http://1:1')).toBe(true);

    now += 9_999;
    expect(quarantine.quarantined('a', ['http://1:1', 'http://2:2'])).toEqual(
      new Set(['http://1:1']),
    );
    now += 1;
    expect(quarantine.quarantined('a', ['http://1:1'])).toEqual(new Set());
  });

  it('counts a repeat failure while quarantined as the same event but extends it', () => {
    const quarantine = q();
    quarantine.add('a', 'http://1:1');
    now += 5_000;
    expect(quarantine.add('a', 'http://1:1')).toBe(false);
    now += 9_000;
    expect(quarantine.quarantined('a', ['http://1:1']).size).toBe(1);
  });

  it('keeps apps apart', () => {
    const quarantine = q();
    quarantine.add('a', 'http://1:1');
    expect(quarantine.quarantined('b', ['http://1:1']).size).toBe(0);
  });
});
