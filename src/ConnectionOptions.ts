import { readFileSync } from "node:fs";
import type { EnvKeys, SslConfig } from "./types";
import { loadEnv } from "./utils";

/** TLS options, in the form both drivers (mysql2 and pg) accept */
export interface TlsOptions {
    rejectUnauthorized: boolean;
    ca?: string;
    cert?: string;
    key?: string;
}

/** Connection data of a MySQL or PostgreSQL database */
export interface ConnectionData {
    host?: string;
    user?: string;
    password?: string;
    port?: number;
    database?: string;
    /** TLS options for the driver. Undefined means no TLS */
    ssl?: TlsOptions;
}

/**
 * Connection data from the env vars named in envKeys. A connection URL
 * (envKeys.url) has priority over the separate env vars. The `ssl` config has
 * priority over the `sslmode` / `ssl-mode` parameter of the URL.
 */
export function connectionOptions(envKeys: EnvKeys, ssl?: SslConfig): ConnectionData {
    loadEnv();
    const { env } = process;
    const url = envKeys.url ? env[envKeys.url] : undefined;
    let data: ConnectionData;
    if (url) {
        data = parseConnectionUrl(url, envKeys.url as string);
    } else {
        const port = env[envKeys.port];
        data = {
            host: env[envKeys.host],
            user: env[envKeys.user],
            password: env[envKeys.password],
            port: port ? Number(port) : undefined,
            database: env[envKeys.database],
        };
    }
    if (ssl !== undefined) data.ssl = resolveSsl(ssl);
    return data;
}

/** ssl: verify the certificate (verify-ca, verify-full) or only encrypt (require) */
const SSL_MODES: Record<string, TlsOptions | undefined> = {
    "disable": undefined,
    "allow": undefined,
    "prefer": undefined,
    "require": { rejectUnauthorized: false },
    "no-verify": { rejectUnauthorized: false },
    "verify-ca": { rejectUnauthorized: true },
    "verify-full": { rejectUnauthorized: true },
    // MySQL names
    "disabled": undefined,
    "preferred": undefined,
    "required": { rejectUnauthorized: false },
    "verify_ca": { rejectUnauthorized: true },
    "verify_identity": { rejectUnauthorized: true },
};

/** Parse mysql://user:pass@host:port/db?ssl-mode=… or postgres://…?sslmode=… */
export function parseConnectionUrl(url: string, envVar: string): ConnectionData {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        // Never print the URL: it has the password
        throw new Error(`The env var ${envVar} is not a valid connection URL`);
    }
    if (!["mysql:", "postgres:", "postgresql:"].includes(parsed.protocol)) {
        throw new Error(`The env var ${envVar} must start with mysql://, postgres:// or postgresql://`);
    }
    const data: ConnectionData = {
        host: parsed.hostname || undefined,
        user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        port: parsed.port ? Number(parsed.port) : undefined,
        database: parsed.pathname.length > 1 ? decodeURIComponent(parsed.pathname.slice(1)) : undefined,
    };
    const mode = (parsed.searchParams.get("sslmode") ?? parsed.searchParams.get("ssl-mode"))?.toLowerCase();
    if (mode != null) {
        if (!(mode in SSL_MODES)) throw new Error(`Unknown SSL mode "${mode}" in the env var ${envVar}`);
        data.ssl = SSL_MODES[mode];
    }
    return data;
}

/** TLS options from the ssl config. Reads the certificate files */
export function resolveSsl(ssl: SslConfig): TlsOptions | undefined {
    if (ssl === false) return undefined;
    if (ssl === true) return { rejectUnauthorized: true };
    if (typeof ssl !== "object" || ssl == null) throw new Error("Invalid ssl config. Use true, false or an object");
    return {
        rejectUnauthorized: ssl.rejectUnauthorized ?? true,
        ca: ssl.ca ? readCertificate(ssl.ca) : undefined,
        cert: ssl.cert ? readCertificate(ssl.cert) : undefined,
        key: ssl.key ? readCertificate(ssl.key) : undefined,
    };
}

function readCertificate(path: string) {
    try {
        return readFileSync(path, "utf8");
    } catch {
        throw new Error(`Cannot read the SSL file ${path}`);
    }
}
