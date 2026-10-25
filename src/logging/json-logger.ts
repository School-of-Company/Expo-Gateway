import type { LoggerService } from '@nestjs/common';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { DestinationStream, Level, Logger as Pino } from 'pino';

/** Shared Expo log keys (see CLAUDE.md "Logging"); Loki labels by these names only. */
export interface JsonLoggerOptions {
  /** Eureka app name, written as `service` on every line. */
  service: string;
  /** pino level: trace, debug, info, warn, error. */
  level: string;
  /** Mirror stdout to `<logDir>/<service>/app.log` (local only). */
  logDir?: string;
}

const DEFAULT_MODULE = 'app';
const STACK_LINE = /\n\s+at /;

export function defaultLogDir(): string {
  return join(homedir(), '.expo', 'logs');
}

export function createPino(
  options: JsonLoggerOptions,
  stdout: DestinationStream = pino.destination({ dest: 1, sync: true }),
): Pino {
  const streams: pino.StreamEntry[] = [
    { level: options.level as Level, stream: stdout },
  ];
  if (options.logDir) {
    streams.push({
      level: options.level as Level,
      stream: pino.destination({
        dest: join(options.logDir, options.service, 'app.log'),
        mkdir: true,
        sync: true,
      }),
    });
  }
  return pino(
    {
      level: options.level,
      base: { service: options.service },
      messageKey: 'message',
      timestamp: () => `,"@timestamp":"${new Date().toISOString()}"`,
      formatters: {
        // The standard has no FATAL: Nest's fatal() is reported as ERROR.
        level: (label) => ({
          level: label === 'fatal' ? 'ERROR' : label.toUpperCase(),
        }),
      },
    },
    pino.multistream(streams),
  );
}

/**
 * Nest LoggerService writing the standard JSON line. The Nest logger context
 * (the class name passed to `new Logger(...)`) becomes `module`, the same
 * mapping as nestjs-pino's `renameContext: 'module'`, so call sites never set it.
 * Installed with `Logger.overrideLogger()` before Nest exists, so bootstrap
 * lines are JSON too.
 */
export class JsonLogger implements LoggerService {
  constructor(private readonly pino: Pino) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params, true);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params, true);
  }

  private write(
    level: Level,
    message: unknown,
    params: unknown[],
    withStack = false,
  ): void {
    // `new Logger(ctx).log(msg)` reaches here as (msg, undefined, ctx).
    const rest = params.filter((param) => param !== undefined);
    let stack: string | undefined;
    // Nest calls error(message, stack?, context?): a lone stack-shaped string is not a context.
    if (
      withStack &&
      typeof rest[0] === 'string' &&
      (rest.length === 2 || STACK_LINE.test(rest[0]))
    ) {
      stack = rest.shift() as string;
    }
    const last = rest[rest.length - 1];
    const module =
      typeof last === 'string' && last !== ''
        ? (rest.pop() as string)
        : DEFAULT_MODULE;

    const fields: Record<string, unknown> = { module };
    let text: string;
    if (message instanceof Error) {
      text = message.message;
      stack ??= message.stack;
    } else if (typeof message === 'string') {
      text = message;
    } else {
      text = safeStringify(message);
    }
    if (rest.length > 0) {
      text = [text, ...rest.map(safeStringify)].join(' ');
    }
    if (stack) {
      fields.stack_trace = stack;
    }
    this.pino[level](fields, text);
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
