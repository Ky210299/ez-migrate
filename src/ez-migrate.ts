import program from "./CLI";

program.parseAsync().then().catch(e => console.error("\n" + e.message))