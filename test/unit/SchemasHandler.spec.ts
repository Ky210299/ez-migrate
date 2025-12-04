import {describe, expect, it, vi} from "vitest"
import SchemasHandler from "../../src/SchemasHandler";

const mockedSchemaHandler = new SchemasHandler({});

vi.spyOn(mockedSchemaHandler, "getSchemasFilesName").mockImplementation(() => ["1.sql", "2.sql"]);
function createTemplate({ up, down }: { up: string, down: string }) {
    return `-- ez-migration-up
    ${up}
-- ez-migration-up
-- ez-migration-down
    ${down}
-- ez-migration-down
`.trim();
}

describe("Schema Handler", () => {

    it("should remove sql comments", () => {
        vi.spyOn(mockedSchemaHandler, "readSQL").mockImplementation(() => {
            return createTemplate({
                up: `CREATE TABLE xd; -- comment
                # another comment`,
                down: `DROP TABLE xd;  // comment
                -- another comment`
            }
            );
        });
        const migration = mockedSchemaHandler.next("1.sql")?.getDetails()
        expect(migration?.up).toBe("CREATE TABLE xd;")
        expect(migration?.down).toBe("DROP TABLE xd;")

    })
})

