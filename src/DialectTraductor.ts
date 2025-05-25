import { MIGRATIONS_DILALECTS, TRACKER_DIALECTS } from "./constants";
const DIALECTS_ARRAY = [
    ...Object.keys(MIGRATIONS_DILALECTS),
    ...Object.keys(TRACKER_DIALECTS)
] as const
const DIALECTS = new Set(DIALECTS_ARRAY)
type Dialect = keyof typeof TRACKER_DIALECTS & keyof typeof MIGRATIONS_DILALECTS

const TRANSLATABLE_KEYWORDS = {
    CHAR: "CHAR",
    TEXT: "TEXT",
    VARCHAR: "VARCHAR",
} as const

type TranslatableKeyword = typeof TRANSLATABLE_KEYWORDS[keyof typeof TRANSLATABLE_KEYWORDS]
const TRANSALTION_MAP = Object.create(null)
/**                                           MYSQL                                                                    */

/**                              MYSQL -> -> -> -> -> -> POSTGRES                                                                    */
TRANSALTION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.POSTGRES][TRANSLATABLE_KEYWORDS.CHAR] = TRANSLATABLE_KEYWORDS.CHAR
TRANSALTION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.POSTGRES][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT
TRANSALTION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.POSTGRES][TRANSLATABLE_KEYWORDS.VARCHAR] = TRANSLATABLE_KEYWORDS.VARCHAR

/**                              MYSQL -> -> -> -> -> -> SQLITE                                                                     */
TRANSALTION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.CHAR] = TRANSLATABLE_KEYWORDS.TEXT
TRANSALTION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT
TRANSALTION_MAP[TRACKER_DIALECTS.MYSQL][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.VARCHAR] = TRANSLATABLE_KEYWORDS.TEXT

/**                                           SQLITE                                                                    */

/**                              SQLITE -> -> -> -> -> -> MYSQL                                                                    */
TRANSALTION_MAP[TRACKER_DIALECTS.SQLITE][TRACKER_DIALECTS.MYSQL][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT

/**                              SQLITE -> -> -> -> -> -> POSTGRES                                                                    */
TRANSALTION_MAP[TRACKER_DIALECTS.SQLITE][TRACKER_DIALECTS.POSTGRES][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT

/**                                           POSTGRES                                                                    */
/**                              POSTGRES -> -> -> -> -> -> MYSLQ                                                                    */
TRANSALTION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.MYSQL][TRANSLATABLE_KEYWORDS.CHAR] = TRANSLATABLE_KEYWORDS.CHAR
TRANSALTION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.MYSQL][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT
TRANSALTION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.MYSQL][TRANSLATABLE_KEYWORDS.VARCHAR] = TRANSLATABLE_KEYWORDS.VARCHAR

/**                              POSTGRES -> -> -> -> -> -> SQLITE                                                                    */
TRANSALTION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.CHAR] = TRANSLATABLE_KEYWORDS.TEXT
TRANSALTION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.TEXT] = TRANSLATABLE_KEYWORDS.TEXT
TRANSALTION_MAP[TRACKER_DIALECTS.POSTGRES][TRACKER_DIALECTS.SQLITE][TRANSLATABLE_KEYWORDS.VARCHAR] = TRANSLATABLE_KEYWORDS.TEXT

export default class DialectTranslator {
    static translate(from: Dialect, to: Dialect, keyword: TranslatableKeyword) {
        if (!DIALECTS.has(from) || !DIALECTS.has(to)) throw new Error("Invalid Dialects")
        else if (!Object.values(TRANSLATABLE_KEYWORDS).includes(keyword)) throw new Error("Unstranslatable keyword")
        else if (from === to) return keyword;
        return TRANSALTION_MAP[from][to][keyword]
    }
}