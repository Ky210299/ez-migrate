#!/usr/bin/env node
import program from "./CLI";
program.parseAsync(process.argv).then().catch(e => {
    const message = e instanceof Error ? e.message : String(e);
    if (message) console.error("\n" + message);
    process.exitCode = 1;
})
