import { ConsoleLogger, FileLogger } from "./Logger";
import Pino, { Logger } from "pino"

export class PinoConsoleLogger implements ConsoleLogger {
    private readonly pino: Logger = Pino({
        transport: {
            target: "pino-pretty",
            options: {
                colorize: true
            }
            
        }
    })
    constructor() { }
    info(msg: string) { this.pino.info(msg) };
    warn(msg: string) { this.pino.warn(msg) };
    error(msg: string) { this.pino.error(msg) };
}

export class PinoFileLogger implements FileLogger {
    private readonly pino: Logger;
    constructor(location: string) {
        this.pino = Pino({}, Pino.destination(location))
    }
    info(msg: string) { this.pino.info(msg) };
    warn(msg: string) { this.pino.warn(msg) };
    error(msg: string) { this.pino.error(msg) };
}
