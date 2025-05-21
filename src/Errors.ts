import { ConsoleLoggerImpl } from "./Logger";
import { PinoConsoleLogger } from "./PinoLogger";

export class MigrateError extends Error {
    constructor(msg: string, name: string | undefined = undefined) {
        super(msg);
        this.name = name ?? "";
        this.stack = "";
    }
}
export const ERRORS = {
    FILE_ALREADY_EXISTS: {
        errno: -17,
        message: "File already exists",
        code: "EEXIST"
    },
    FILE_NOT_FOUND: {
        errno: -2,
        message: "File not found",
        code: "ENOENT"
    },
};
export function isErrnoException(err: unknown) {
    return err != null && typeof err === "object" && "errno" in err && "code" in err;
}

const pino = new PinoConsoleLogger()
const logger = new ConsoleLoggerImpl(pino)

export function throwMessage(err: NodeJS.ErrnoException) {
    const { errno } = err;
    const message = Object.values(ERRORS).find((err) => err.errno === errno)?.message;
    if (message != null) logger.error(message);
}
