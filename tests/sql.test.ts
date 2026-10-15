import { describe, expect, it } from "vitest";
import { isEmptySQL, normalizeSQL, splitStatements, stripComments, stripStrings } from "../src/sql";

describe("stripComments", () => {
    it("removes line and block comments", () => {
        expect(normalizeSQL("SELECT 1; -- a\n# b\n/* c\n d */ SELECT 2;")).toBe("SELECT 1; SELECT 2;");
    });

    it("keeps comment markers inside quotes", () => {
        const sql = "INSERT INTO t VALUES ('http://x', 'a--b', \"#c\", 'it''s /* no */')";
        expect(stripComments(sql)).toBe(sql);
    });
});

describe("isEmptySQL", () => {
    it("is true for comments only", () => {
        expect(isEmptySQL("  -- Write the SQL here\n  ")).toBe(true);
    });
    it("is false with a statement", () => {
        expect(isEmptySQL("-- x\nDROP TABLE a;")).toBe(false);
    });
});

describe("stripStrings", () => {
    it("empties strings, quoted names and PostgreSQL dollar quotes", () => {
        expect(stripStrings("SELECT 'a;b', \"c;d\", `e;f`, $$g;h$$, $fn$i;j$fn$, x$1")).toBe("SELECT '', \"\", ``, $$, $$, x$1");
    });
});

describe("splitStatements", () => {
    it("splits on ; outside quotes and comments", () => {
        expect(splitStatements("INSERT INTO t VALUES ('a;b'); -- c;d\nDELETE FROM t;")).toEqual(["INSERT INTO t VALUES ('')", "DELETE FROM t"]);
    });

    it("keeps a MySQL trigger or procedure body as one statement", () => {
        const sql = `CREATE PROCEDURE p() BEGIN
            DECLARE x INT;
            IF x > 0 THEN SET x = 1; END IF;
            WHILE x < 3 DO SET x = x + 1; END WHILE;
            CASE x WHEN 1 THEN SET x = 2; ELSE SET x = 3; END CASE;
            SELECT CASE WHEN x = 1 THEN 'a' ELSE 'b' END;
        END;
        CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN INSERT INTO log VALUES (1); END;
        UPDATE a SET b = 1;`;
        const statements = splitStatements(sql);
        expect(statements).toHaveLength(3);
        expect(statements[0]).toMatch(/^CREATE PROCEDURE/);
        expect(statements[1]).toMatch(/^CREATE TRIGGER/);
        expect(statements[2]).toBe("UPDATE a SET b = 1");
    });

    it("keeps a PostgreSQL function and a SQLite trigger as one statement", () => {
        const sql = `CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN NEW.a := 1; RETURN NEW; END $$ LANGUAGE plpgsql;
            CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO log VALUES (1); DELETE FROM b; END;
            SELECT 1;`;
        expect(splitStatements(sql)).toHaveLength(3);
    });

    it("does not count BEGIN of a transaction as a block", () => {
        expect(splitStatements("BEGIN; INSERT INTO a VALUES (1); COMMIT;")).toEqual(["BEGIN", "INSERT INTO a VALUES (1)", "COMMIT"]);
        expect(splitStatements("BEGIN TRANSACTION; DELETE FROM a; END;")).toHaveLength(3);
        expect(splitStatements("BEGIN IMMEDIATE; DELETE FROM a; COMMIT;")).toHaveLength(3);
    });

    it("is fast with big data files", () => {
        const sql = "INSERT INTO t (a, b) VALUES " + Array.from({ length: 20000 }, (_, i) => `(${i}, 'text ${i}; -- not a comment')`).join(",\n") + ";\n";
        const start = performance.now();
        expect(splitStatements(sql.repeat(20))).toHaveLength(20);
        expect(performance.now() - start).toBeLessThan(3000);
    });
});
