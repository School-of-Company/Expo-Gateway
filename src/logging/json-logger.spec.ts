import { Logger } from '@nestjs/common';
import { Writable } from 'node:stream';
import { createPino, JsonLogger } from './json-logger';

function capture(level = 'trace') {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  const logger = new JsonLogger(
    createPino({ service: 'expo-test', level }, stream),
  );
  return { lines, logger };
}

describe('JsonLogger', () => {
  afterEach(() => {
    Logger.overrideLogger(true);
  });

  it('writes the five standard keys, taking module from the Nest context', () => {
    const { lines, logger } = capture();
    Logger.overrideLogger(logger);

    new Logger('Bootstrap').log('started');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'INFO',
      service: 'expo-test',
      module: 'Bootstrap',
      message: 'started',
    });
    expect(lines[0]['@timestamp']).toEqual(
      new Date(lines[0]['@timestamp'] as string).toISOString(),
    );
    expect(lines[0]).not.toHaveProperty('pid');
    expect(lines[0]).not.toHaveProperty('hostname');
  });

  it('uses a default module when there is no context', () => {
    const { lines, logger } = capture();

    logger.warn('no context');

    expect(lines[0]).toMatchObject({ level: 'WARN', module: 'app' });
  });

  it('keeps the stack of error(message, stack, context) apart from the context', () => {
    const { lines, logger } = capture();
    Logger.overrideLogger(logger);

    new Logger('Poller').error('failed', 'Error: x\n    at foo (a.ts:1:1)');

    expect(lines[0]).toMatchObject({
      level: 'ERROR',
      module: 'Poller',
      message: 'failed',
      stack_trace: 'Error: x\n    at foo (a.ts:1:1)',
    });
  });

  it('reports fatal and verbose with the standard level names', () => {
    const { lines, logger } = capture();

    logger.fatal(new Error('boom'));
    logger.verbose('detail', 'Ctx');

    expect(lines[0]).toMatchObject({ level: 'ERROR', message: 'boom' });
    expect(lines[0].stack_trace).toEqual(expect.stringContaining('boom'));
    expect(lines[1]).toMatchObject({ level: 'TRACE', module: 'Ctx' });
  });

  it('drops lines below the configured level', () => {
    const { lines, logger } = capture('info');

    logger.debug('hidden');

    expect(lines).toHaveLength(0);
  });
});
