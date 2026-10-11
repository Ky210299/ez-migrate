/**
 * Small logger without dependencies. It writes one line per message:
 * `info` and `debug` to stdout, `warn` and `error` to stderr.
 *
 * Level and format come from the CLI options (--log-level, --verbose,
 * --log-format) or the env vars EZ_MIGRATE_LOG_LEVEL and EZ_MIGRATE_LOG_FORMAT.
 */
export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = typeof LOG_LEVELS[number];
export const LOG_FORMATS = ["pretty", "json"] as const;
export type LogFormat = typeof LOG_FORMATS[number];
export type LogFields = Record<string, unknown>;

const COLORS: Record<LogLevel, string> = { error: "31", warn: "33", info: "36", debug: "90" };

function parseLevel(value: string | undefined): LogLevel | undefined {
    const level = value?.toLowerCase();
    return LOG_LEVELS.find(l => l === level);
}

function parseFormat(value: string | undefined): LogFormat | undefined {
    const format = value?.toLowerCase();
    return LOG_FORMATS.find(f => f === format);
}

export class ConsoleLoggerImpl {
    private level: LogLevel = parseLevel(process.env.EZ_MIGRATE_LOG_LEVEL) ?? "info";
    private format: LogFormat = parseFormat(process.env.EZ_MIGRATE_LOG_FORMAT) ?? "pretty";

    /** Change the level and format. Throws on unknown values so a typo in an option is not ignored */
    configure({ level, format }: { level?: string, format?: string }) {
        if (level != null) {
            const parsed = parseLevel(level);
            if (parsed == null) throw new Error(`Invalid log level: ${level}. Use one of: ${LOG_LEVELS.join(", ")}`);
            this.level = parsed;
        }
        if (format != null) {
            const parsed = parseFormat(format);
            if (parsed == null) throw new Error(`Invalid log format: ${format}. Use one of: ${LOG_FORMATS.join(", ")}`);
            this.format = parsed;
        }
    }

    isEnabled(level: LogLevel) {
        return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(this.level);
    }

    error(msg: string, fields?: LogFields) { this.write("error", msg, fields) }
    warn(msg: string, fields?: LogFields) { this.write("warn", msg, fields) }
    info(msg: string, fields?: LogFields) { this.write("info", msg, fields) }
    debug(msg: string, fields?: LogFields) { this.write("debug", msg, fields) }

    private write(level: LogLevel, msg: string, fields?: LogFields) {
        if (!this.isEnabled(level)) return;
        const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
        if (this.format === "json") {
            stream.write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }) + "\n");
            return;
        }
        const color = stream.isTTY && !process.env.NO_COLOR;
        const label = level.toUpperCase().padEnd(5);
        const extra = fields == null ? "" : Object.entries(fields)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => ` ${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join("");
        const line = `${new Date().toISOString().substring(11, 23)} ${color ? `\x1b[${COLORS[level]}m${label}\x1b[0m` : label} ${msg}${color && extra ? `\x1b[90m${extra}\x1b[0m` : extra}`;
        stream.write(line + "\n");
    }
}

export const consoleLogger = new ConsoleLoggerImpl();
