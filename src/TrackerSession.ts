import { lockSettings } from "./Lock";
import Repository from "./Repository";
import TrackerFactory from "./TrackerFactory";
import type { Config } from "./types";

/**
 * Create the tracker, take its lock, run fn and always unlock and close.
 * Every command that changes the database runs inside this, so two
 * ez-migrate (two deploys, two servers) never change the same database at once.
 */
export async function withLockedTracker<T>(config: Config, fn: (tracker: Repository) => Promise<T>): Promise<T> {
    const tracker = TrackerFactory.create(config);
    try {
        return await tracker.withLock(lockSettings.timeoutMs, () => fn(tracker));
    } finally {
        await tracker.close().catch(() => {});
    }
}

/**
 * Create the tracker, run fn and always close it. For commands that only read
 * the history (status, --dry-run), so they never wait for the lock.
 */
export async function withTracker<T>(config: Config, fn: (tracker: Repository) => Promise<T>): Promise<T> {
    const tracker = TrackerFactory.create(config);
    try {
        await tracker.init();
        return await fn(tracker);
    } finally {
        await tracker.close().catch(() => {});
    }
}
