import { hostname } from "node:os";
import { openSync, readFileSync, unlinkSync, writeFileSync, closeSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

/** Default time to wait for the lock, in seconds */
export const DEFAULT_LOCK_TIMEOUT_S = 60;

const POLL_INTERVAL_MS = 200;

/** Lock settings of this run. The CLI sets them from --lock-timeout */
export const lockSettings = {
    timeoutMs: lockTimeoutFromEnv() ?? DEFAULT_LOCK_TIMEOUT_S * 1000,
};

function lockTimeoutFromEnv() {
    const value = process.env.EZ_MIGRATE_LOCK_TIMEOUT;
    return value ? parseLockTimeout(value) : undefined;
}

/** Seconds (as text) to milliseconds. Throws if it is not a number >= 0 */
export function parseLockTimeout(seconds: string) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid lock timeout: ${seconds}. Use a number of seconds >= 0`);
    return value * 1000;
}

/** Thrown when another ez-migrate keeps the lock longer than the timeout */
export class LockTimeoutError extends Error {
    constructor(timeoutMs: number, holder?: string) {
        super(
            `Another ez-migrate is changing this database${holder ? ` (${holder})` : ""}. ` +
            `Waited ${Math.round(timeoutMs / 1000)} s. Try again when it ends, or raise --lock-timeout`,
        );
        this.name = "LockTimeoutError";
    }
}

/** Calls tryAcquire until it returns true. Throws LockTimeoutError after timeoutMs */
export async function acquireWithRetry(tryAcquire: () => Promise<boolean>, timeoutMs: number, holder?: () => string | undefined) {
    const deadline = Date.now() + timeoutMs;
    while (!(await tryAcquire())) {
        if (Date.now() >= deadline) throw new LockTimeoutError(timeoutMs, holder?.());
        await sleep(POLL_INTERVAL_MS);
    }
}

interface LockOwner { pid: number, host: string, since: string }

/**
 * Lock with a file, for the SQLite tracker. The file has the pid and host of
 * the owner. A lock left by a process that died on this host is removed.
 */
export class FileLock {
    private held = false;
    private readonly releaseOnExit = () => this.releaseSync();

    constructor(private readonly path: string) {}

    async acquire(timeoutMs: number) {
        await acquireWithRetry(async () => this.tryAcquire(), timeoutMs, () => this.describeOwner());
        this.held = true;
        process.once("exit", this.releaseOnExit);
    }

    async release() {
        this.releaseSync();
        process.removeListener("exit", this.releaseOnExit);
    }

    private releaseSync() {
        if (!this.held) return;
        this.held = false;
        try { unlinkSync(this.path) } catch { /* already removed */ }
    }

    private tryAcquire(): boolean {
        try {
            const fd = openSync(this.path, "wx");
            const owner: LockOwner = { pid: process.pid, host: hostname(), since: new Date().toISOString() };
            writeFileSync(fd, JSON.stringify(owner));
            closeSync(fd);
            return true;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        if (this.isStale()) {
            try { unlinkSync(this.path) } catch { /* another process removed it first */ }
        }
        return false;
    }

    private readOwner(): LockOwner | null {
        try {
            return JSON.parse(readFileSync(this.path, "utf8"));
        } catch {
            return null;
        }
    }

    /** True if the owner was a process of this host that doesn't exist anymore */
    private isStale() {
        const owner = this.readOwner();
        if (owner == null || owner.host !== hostname()) return false;
        try {
            process.kill(owner.pid, 0);
            return false;
        } catch (err) {
            return (err as NodeJS.ErrnoException).code === "ESRCH";
        }
    }

    private describeOwner() {
        const owner = this.readOwner();
        return owner ? `pid ${owner.pid} on ${owner.host} since ${owner.since}` : undefined;
    }
}
