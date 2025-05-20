export interface ConsoleLogger {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
}

export interface FileLogger {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
}

export class ConsoleLoggerImpl {
    private readonly logger: ConsoleLogger;
    constructor(consoleLogger: ConsoleLogger) {
        if (consoleLogger == null) throw new Error("Wrong console logger constructor");
        this.logger = consoleLogger
    }
    info(msg: string) { this.logger.info(msg) };
    warn(msg: string) { this.logger.warn(msg) };
    error(msg: string) { this.logger.error(msg) };
}

export class FileLoggerImpl {
    private readonly logger: FileLogger;
    constructor(fileLogger: FileLogger) {
        if (fileLogger == null) throw new Error("Wrong console logger constructor");
        this.logger = fileLogger
    }
    info(msg: string) { this.logger.info(msg) };
    warn(msg: string) { this.logger.warn(msg) };
    error(msg: string) { this.logger.error(msg) };
}