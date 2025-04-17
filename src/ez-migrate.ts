import Down from "./use-cases/Down";
import Migrate from "./use-cases/Migrate";
import Rollback from "./use-cases/Rollback";
import Up from "./use-cases/Up";

; (async () => {
    try {
        const command = process.argv[2];
        switch (command){
            case "up":{
                 await Up.run();
                 break;
            }
            case "down":{
                 await Down.run();
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