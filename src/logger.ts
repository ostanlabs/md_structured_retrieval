/**
 * Structured logging for MSRL.
 *
 * Writes JSON logs to stderr (MCP convention - stdout is reserved for protocol messages).
 * Format: {"ts":"ISO","level":"info","component":"SnapshotBuilder","msg":"...","data":{}}
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/**
 * Log level priority (higher = more severe).
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Global log level. Can be changed at runtime.
 */
let globalLogLevel: LogLevel = 'info';

/**
 * Set the global log level.
 */
export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

/**
 * Get the current global log level.
 */
export function getGlobalLogLevel(): LogLevel {
  return globalLogLevel;
}

/**
 * Check if a log level should be output given the current global level.
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[globalLogLevel];
}

/**
 * Write a log entry to stderr.
 */
function writeLog(
  level: LogLevel,
  component: string,
  msg: string,
  data?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
  };

  if (data !== undefined) {
    entry.data = data;
  }

  process.stderr.write(JSON.stringify(entry) + '\n');
}

/**
 * Create a logger for a specific component.
 *
 * @param component - The component name (e.g., 'SnapshotBuilder', 'MsrlEngine')
 * @returns A Logger instance
 */
export function createLogger(component: string): Logger {
  return {
    debug(msg: string, data?: Record<string, unknown>): void {
      writeLog('debug', component, msg, data);
    },
    info(msg: string, data?: Record<string, unknown>): void {
      writeLog('info', component, msg, data);
    },
    warn(msg: string, data?: Record<string, unknown>): void {
      writeLog('warn', component, msg, data);
    },
    error(msg: string, data?: Record<string, unknown>): void {
      writeLog('error', component, msg, data);
    },
  };
}

