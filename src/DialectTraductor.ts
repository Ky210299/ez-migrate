import { MIGRATIONS_DIALECTS, TRACKER_DIALECTS } from "./constants";
const DIALECTS_ARRAY = [
    ...Object.values(MIGRATIONS_DIALECTS),
    ...Object.values(TRACKER_DIALECTS)
] as const
const DIALECTS = new Set(DIALECTS_ARRAY)
type Dialect = (typeof TRACKER_DIALECTS)[keyof typeof TRACKER_DIALECTS] | (typeof MIGRATIONS_DIALECTS)[keyof typeof MIGRATIONS_DIALECTS]

const TRANSLATABLE_KEYWORDS = {
    CHAR: "CHAR" ,
    CHARACTER: "CHARACTER",
    TEXT: "TEXT",
    VARCHAR: "VARCHAR",
    "CHARACTER VARYING": "CHARACTER VARYING"
} as const

export type TranslatableKeyword = typeof TRANSLATABLE_KEYWORDS[keyof typeof TRANSLATABLE_KEYWORDS]
const TRANSLATION_MAP = Object.create(null)

for (const f of DIALECTS) {
    TRANSLATION_MAP[f] = Object.create(null)
    for (const t of DIALECTS) {
        TRANSLATION_MAP[f][t] = Object.create(null)
        for (const kw of Object.values(TRANSLATABLE_KEYWORDS)) {
            TRANSLATION_MAP[f][t][kw] = (f === t ? kw : kw);
        }
    }
}
/**                                           MYSQL                                                                    */

/**                              MYSQL -> -> -> -> -> -> POSTGRES                                                                    */
TRANSLATION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.POSTGRES][TRANSLATABLE_KEYWORDS.CHAR] = TRANSLATABLE_KEYWORDS.CHARACTER
TRANSLATION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.POSTGRES][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT
TRANSLATION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.POSTGRES][TRANSLATABLE_KEYWORDS.VARCHAR] = TRANSLATABLE_KEYWORDS["CHARACTER VARYING"]

/**                              MYSQL -> -> -> -> -> -> SQLITE                                                                     */
TRANSLATION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.CHAR] = TRANSLATABLE_KEYWORDS.TEXT
TRANSLATION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT
TRANSLATION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.VARCHAR] = TRANSLATABLE_KEYWORDS.TEXT

/**                                           SQLITE                                                                    */

/**                              SQLITE -> -> -> -> -> -> MYSQL                                                                    */
TRANSLATION_MAP[TRACKER_DIALECTS.SQLITE][TRACKER_DIALECTS.MYSQL][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT

/**                              SQLITE -> -> -> -> -> -> POSTGRES                                                                    */
TRANSLATION_MAP[TRACKER_DIALECTS.SQLITE][TRACKER_DIALECTS.POSTGRES][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT

/**                                           POSTGRES                                                                    */
/**                              POSTGRES -> -> -> -> -> -> MYSLQ                                                                    */
TRANSLATION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.MYSQL][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT
TRANSLATION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.MYSQL][TRANSLATABLE_KEYWORDS.CHARACTER] = TRANSLATABLE_KEYWORDS.CHAR
TRANSLATION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.MYSQL][TRANSLATABLE_KEYWORDS["CHARACTER VARYING"]] = TRANSLATABLE_KEYWORDS.VARCHAR

/**                              POSTGRES -> -> -> -> -> -> SQLITE                                                                    */
TRANSLATION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.CHARACTER] = TRANSLATABLE_KEYWORDS.CHAR
TRANSLATION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT
TRANSLATION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS["CHARACTER VARYING"]] = TRANSLATABLE_KEYWORDS.VARCHAR


export default class DialectTranslator {
    static translate(from: Dialect, to: Dialect, keyword: TranslatableKeyword) {
        if (!DIALECTS.has(from) || !DIALECTS.has(to)) throw new Error("Invalid Dialects")
        else if (!Object.values(TRANSLATABLE_KEYWORDS).includes(keyword)) return null
        else if (from === to) return keyword;
        return TRANSLATION_MAP[from][to][keyword]
    }
}