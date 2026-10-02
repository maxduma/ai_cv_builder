import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import pretty from 'pino-pretty';
import type { Config } from '../config/env';

export type { Logger };

/**
 * pino-http logs request and response headers, which carry session tokens. Paths are those of
 * its serialized `req` and `res` (lowercase header names, as Node stores them).
 */
const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

/** `destination` replaces the default output (stdout); tests use it to read the log lines. */
export function createLogger(
  config: Pick<Config, 'nodeEnv' | 'logLevel'>,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = { level: config.logLevel, redact: REDACTED_PATHS };

  if (destination) {
    return pino(options, destination);
  }
  // Readable output for local development; JSON lines everywhere else.
  if (config.nodeEnv === 'development') {
    return pino(options, pretty({ translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' }));
  }
  return pino(options);
}
