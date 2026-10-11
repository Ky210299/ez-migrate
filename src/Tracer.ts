import { AsyncLocalStorage } from "node:async_hooks";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { consoleLogger, LogFields } from "./Logger";

/** One timed step of a command, for example connecting or running one migration */
export interface Span {
    id: number;
    parentId: number | null;
    name: string;
    attrs: LogFields;
    /** Milliseconds since the process started */
    start: number;
    duration: number;
    error?: string;
}

/**
 * Records how long each step of a command takes. Spans nest: a span started
 * inside another one is its child. Recording is always on because it costs
 * a few microseconds per span. The result is printed with --trace or written
 * with --trace-file in the Chrome trace format (open it in https://ui.perfetto.dev).
 */
export class Tracer {
    private readonly spans: Array<Span> = [];
    private readonly current = new AsyncLocalStorage<Span>();
    private nextId = 1;

    private begin(name: string, attrs: LogFields): Span {
        const parent = this.current.getStore();
        const span: Span = { id: this.nextId++, parentId: parent?.id ?? null, name, attrs, start: performance.now(), duration: 0 };
        this.spans.push(span);
        consoleLogger.debug(`start ${name}`, attrs);
        return span;
    }

    private end(span: Span, err?: unknown) {
        span.duration = performance.now() - span.start;
        if (err !== undefined) span.error = err instanceof Error ? err.message : String(err);
        const fields = { ...span.attrs, ms: round(span.duration), ...(span.error ? { error: span.error } : {}) };
        consoleLogger.debug(`${span.error ? "failed" : "end"} ${span.name}`, fields);
    }

    /** Run fn as a span */
    async span<T>(name: string, attrs: LogFields, fn: () => Promise<T>): Promise<T> {
        const span = this.begin(name, attrs);
        try {
            const result = await this.current.run(span, fn);
            this.end(span);
            return result;
        } catch (err) {
            this.end(span, err);
            throw err;
        }
    }

    /** Run a synchronous fn as a span */
    spanSync<T>(name: string, attrs: LogFields, fn: () => T): T {
        const span = this.begin(name, attrs);
        try {
            const result = this.current.run(span, fn);
            this.end(span);
            return result;
        } catch (err) {
            this.end(span, err);
            throw err;
        }
    }

    getSpans(): ReadonlyArray<Span> {
        return this.spans;
    }

    /** Tree of spans with their duration, slowest root first */
    summary(): string {
        const children = new Map<number | null, Array<Span>>();
        for (const span of this.spans) {
            const list = children.get(span.parentId) ?? [];
            list.push(span);
            children.set(span.parentId, list);
        }
        const total = performance.now();
        const lines = [`Trace (process ${round(total)} ms, startup ${round(this.spans[0]?.start ?? total)} ms)`];
        const walk = (parentId: number | null, depth: number) => {
            for (const span of children.get(parentId) ?? []) {
                const attrs = Object.entries(span.attrs).map(([k, v]) => `${k}=${String(v)}`).join(" ");
                lines.push(`${"  ".repeat(depth + 1)}${String(round(span.duration)).padStart(8)} ms  ${span.name}${attrs ? `  ${attrs}` : ""}${span.error ? "  FAILED" : ""}`);
                walk(span.id, depth + 1);
            }
        };
        walk(null, 0);
        return lines.join("\n");
    }

    /** Chrome trace event format. Opens in https://ui.perfetto.dev or chrome://tracing */
    toChromeTrace() {
        return {
            traceEvents: this.spans.map(span => ({
                name: span.name,
                cat: "ez-migrate",
                ph: "X",
                ts: Math.round(span.start * 1000),
                dur: Math.round(span.duration * 1000),
                pid: process.pid,
                tid: 1,
                args: { ...span.attrs, ...(span.error ? { error: span.error } : {}) },
            })),
            displayTimeUnit: "ms",
        };
    }

    writeChromeTrace(path: string) {
        writeFileSync(path, JSON.stringify(this.toChromeTrace(), null, 1));
    }
}

function round(ms: number) {
    return Math.round(ms * 10) / 10;
}

export const tracer = new Tracer();
