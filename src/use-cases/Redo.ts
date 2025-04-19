import Down from "./Down"
import Up from "./Up"

export default class Redo {
    private constructor() { throw new Error("Not constructor available for Redo") }
    static async run() {
        await Down.run();
        await Up.run();
    }
}