import {
    pgTable,
    serial,
    bigint,
    text,
    boolean,
    integer,
    real,
    timestamp, primaryKey,
} from "drizzle-orm/pg-core";

// 1. Пользователи
export const users = pgTable("users", {
    id: bigint("id", { mode: "bigint" }).primaryKey(), // Telegram ID
    username: text("username"),
    first_name: text("first_name"),
    last_name: text("last_name"),
    created_at: timestamp("created_at").defaultNow(),
});

// 2. Каналы
export const channels = pgTable("channels", {
    id: bigint("id", { mode: "bigint" }).primaryKey(), // Telegram Channel ID
    username: text("username").notNull(),
    title: text("title"),
    members_count: integer("members_count"),
    is_public: boolean("is_public").default(true),
    created_at: timestamp("created_at").defaultNow(),
});

// 3. Заказы
export const orders = pgTable("orders", {
    id: serial("id").primaryKey(),

    user_id: bigint("user_id", { mode: "bigint" })
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),

    channel_id: bigint("channel_id", { mode: "bigint" })
        .notNull()
        .references(() => channels.id, { onDelete: "cascade" }),

    price_stars: integer("price_stars").notNull(),

    status: text("status").default("pending"), // pending | paid | processing | done
    created_at: timestamp("created_at").defaultNow(),
    paid_at: timestamp("paid_at"),
});

// 4. Профили подписчиков
export const userProfiles = pgTable("user_profiles", {
    user_id: bigint("user_id", { mode: "bigint" }).primaryKey(),

    username: text("username"),
    first_name: text("first_name"),
    last_name: text("last_name"),

    gender: text("gender"),
    age_group: text("age_group"),
    country: text("country"),
    language: text("language"),
    interests: text("interests").array(),

    tone: text("tone"),
    language_level: text("language_level"),
    likely_profession: text("likely_profession"),
    summary: text("summary"),

    persona_cluster: text("persona_cluster"),
    persona_probability: real("persona_probability"),

    is_summarized: boolean("is_summarized").default(false),
    summarized_at: timestamp("summarized_at"),
    parsed_at: timestamp("parsed_at").defaultNow(),

    summarization_status: text("summarization_status").default("pending"),
});

export const channelMembers = pgTable(
    "channel_members",
    {
        channel_id: bigint("channel_id", { mode: "bigint" }).notNull(),
        user_id: bigint("user_id", { mode: "bigint" }).notNull(),
        parsed_at: timestamp("parsed_at", { withTimezone: true }).defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.channel_id, table.user_id] }),
    })
);