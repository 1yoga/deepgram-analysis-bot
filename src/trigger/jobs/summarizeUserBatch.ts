import { task, logger } from "@trigger.dev/sdk/v3";
import { ch } from "../../db/clickhouse";
import { db } from "../../db/client";
import { userProfiles } from "../../db/schema";
import OpenAI from "openai";
import { encode } from "gpt-tokenizer";
import { zodResponseFormat } from "openai/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import pLimit from "p-limit";

export const UserProfileSchema = z.object({
    gender: z.enum(["male", "female"]),
    age_group: z.enum(["18-24", "25-34", "35+"]),
    country: z.string().nullable().default(""),
    language: z.string().nullable().default(""),
    interests: z.array(z.string()),
    tone: z.string(),
    language_level: z.string(),
    likely_profession: z.string(),
    persona_cluster: z.string().nullable().default(""),
    persona_probability: z.number().nullable().default(0),
    summary: z.string(),
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const limit = pLimit(20);
const chLimit = pLimit(5);

async function safeCH<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err: any) {
            if (err.message?.includes("Timeout") && i < retries - 1) {
                logger.warn("🔁 Retry ClickHouse after timeout", { try: i + 1 });
                await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
                continue;
            }
            throw err;
        }
    }
    throw new Error("ClickHouse failed after retries");
}

export const summarizeUserBatch = task({
    id: "summarize-user-batch",
    run: async (
        payload: { users: { userId: number; username: string | null }[]; channelId: bigint },
        { ctx }
    ) => {
        const { users, channelId } = payload;
        const userIds = users.map((u) => u.userId);
        logger.info("🚀 Запуск batch-саммаризации", { count: userIds.length });

        // 1. Загружаем все сообщения
        const messages = await safeCH(() =>
            chLimit(() =>
                ch.query({
                    query: `
            SELECT m.user_id, m.text, c.channel_name
            FROM default.messages m
            LEFT JOIN default.channels c ON m.channel_id = c.id
            WHERE m.user_id IN (${userIds.join(",")}) AND length(m.text) > 10
            LIMIT 100000
          `,
                    format: "JSONEachRow",
                }).then((r) => r.json())
            )
        ) as { user_id: number | string; text: string; channel_name: string }[];

        logger.info("📨 Сообщения получены", {
            total: messages.length,
            users: new Set(messages.map((m) => m.user_id)).size,
        });

        // 2. Группируем по user_id (строково!)
        const grouped = new Map<string, { text: string; channel_name: string }[]>();
        for (const row of messages) {
            const key = String(row.user_id);
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(row);
        }

        // 3. Саммаризуем в параллель
        const results = await Promise.allSettled(
            userIds.map((userId) =>
                limit(async () => {
                    const rows = grouped.get(String(userId)) || [];
                    if (!rows.length) {
                        await db.update(userProfiles)
                            .set({ summarization_status: "no_data", summarized_at: new Date() })
                            .where(eq(userProfiles.user_id, BigInt(userId)));
                        return;
                    }

                    const structuredInput = JSON.stringify(limitStructuredInput(rows), null, 2);

                    const parsed = await openai.beta.chat.completions.parse({
                        model: "gpt-4.1-nano",
                        messages: [
                            {
                                role: "system",
                                content: `
Ты — опытный AI-аналитик. По сообщениям пользователя из Telegram нужно обязательно определить его пол, возрастную группу и другие параметры. 
Обязательные требования:
- Никогда не пиши "unknown" — всегда делай обоснованное предположение.
- Все значения должны быть на **русском языке**, включая массивы интересов, стиль речи, вероятную профессию и прочее.
- Даже если исходные сообщения частично на английском — переводи термины и используй русские формулировки.
- Ответ строго в формате JSON по заданной схеме (schema).

Поля, которые нужно определить:
- gender (male или female) — по стилю речи, темам, местоимениям, интересам.
- age_group (18–24, 25–34, 35+) — по лексике, интересам, отсылкам.
- country — по языку, культурным особенностям, контексту.
- language — основной язык сообщений.
- interests — массив 3–7 тем.
- tone — формальный, агрессивный, дружелюбный, саркастичный и т. д.
- language_level — например A2, B2, C1, academic, casual.
- likely_profession — примерная профессия или сфера.
- persona_cluster — краткое описание типа ("инвестор", "фрилансер", "школьник").
- persona_probability — от 0 до 1.
- summary — 2–3 предложения с итогом.
          `.trim(),
                            },
                            { role: "user", content: structuredInput },
                        ],
                        response_format: zodResponseFormat(UserProfileSchema, "user_profile"),
                    });

                    const profile = parsed.choices[0].message.parsed!;
                    await db.update(userProfiles)
                        .set({
                            gender: profile.gender,
                            age_group: profile.age_group,
                            country: profile.country,
                            language: profile.language,
                            interests: profile.interests,
                            tone: profile.tone,
                            language_level: profile.language_level,
                            likely_profession: profile.likely_profession,
                            persona_cluster: profile.persona_cluster,
                            persona_probability: profile.persona_probability,
                            summary: profile.summary,
                            is_summarized: true,
                            summarization_status: "done",
                            summarized_at: new Date(),
                        })
                        .where(eq(userProfiles.user_id, BigInt(userId)));

                    logger.info("✅ Сохранили профиль", { userId });
                })
            )
        );

        logger.info("✅ Саммаризация батча завершена", {
            success: results.filter((r) => r.status === "fulfilled").length,
            failed: results.filter((r) => r.status === "rejected").length,
        });
    },
});

function limitStructuredInput(rows: { channel_name: string; text: string }[], maxTokens = 8000) {
    const result: { channel: string; text: string }[] = [];
    let total = 0;

    for (const row of rows) {
        const item = { channel: row.channel_name, text: row.text };
        const tokens = encode(JSON.stringify(item)).length;
        if (total + tokens > maxTokens) break;
        result.push(item);
        total += tokens;
    }

    return result;
}
