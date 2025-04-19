import Down from "./use-cases/Down";
import Make from "./use-cases/Make";
import Migrate from "./use-cases/Migrate";
import Redo from "./use-cases/Redo";
import Reset from "./use-cases/Reset";
import Rollback from "./use-cases/Rollback";
import Status from "./use-cases/Status";
import Up from "./use-cases/Up";

; (async () => {
    try {
        const command = process.argv[2];
        switch (command) {
            case "status": {
                await Status.run()
                break;
            }
            case "redo": {
                await Redo.run();
                break;
            }
            case "make": {
                const name = process.argv[3];
                Make.run(name)
                break;
            }
            case "up": {
                await Up.run();
                break;
            }
            case "down": {
                await Down.run();
                break;
            }
            case "reset": {
                await Reset.run()
                break;
            }
            case "rollback": {
                await Rollback.run();
                break;
            }
            default: {
                await Migrate.run()
                break;
            }
        }
        process.exit();
    } catch (err) {
        if(err instanceof Error) console.error(err.message)
        else console.error(err);
    } finally {
        process.exit()
    }
})()