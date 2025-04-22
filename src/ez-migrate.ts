import program from "./CLI";

program.parseAsync(process.argv).then().catch(e => console.error("\n" + e.message))