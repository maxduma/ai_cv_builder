import pino, { type Logger } from 'pino';
import pretty from 'pino-pretty';
import type { Config } from '../config/env';

export type { Logger };

export function createLogger(config: Pick<Config, 'nodeEnv' | 'logLevel'>): Logger {
  const options = { level: config.logLevel };

  // Readable output for local development; JSON lines everywhere else.
  if (config.nodeEnv === 'development') {
    return pino(options, pretty({ translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' }));
  }
  return pino(options);
}
