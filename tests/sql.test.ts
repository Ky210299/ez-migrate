import { describe, expect, it } from "vitest";
import { isEmptySQL, normalizeSQL, stripComments } from "../src/sql";

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
