import { readFileSync } from "node:fs";
import { join } from "node:path";

export default class Version {
    private constructor() { throw new Error("Version is a static class") }
    /** The version in package.json */
    static get() {
        // dist/use-cases/Version.js -> package.json
        const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
        return pkg.version as string;
    }
    public static run() {
        console.log(Version.get());
    }
}
