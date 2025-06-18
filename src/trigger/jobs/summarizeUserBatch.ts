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
    gender: z.enum(["male", "female", "unknown"]),
    age_group: z.enum(["18-24", "25-34", "35+", "unknown"]),
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
const limit = pLimit(5);

export const summarizeUserBatch = task({
    id: "summarize-user-batch",
    run: async (
        payload: { users: { userId: number; username: string | null }[] },
        { ctx }
    ) => {
        logger.info("🚀 Запуск батч-саммаризации", { count: payload.users.length });

        const tasks = payload.users.map(({ userId }) =>
            limit(() => summarizeOneUser({ userId }))
        );

        await Promise.allSettled(tasks);

        logger.info("✅ Саммаризация батча завершена");
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

async function summarizeOneUser({ userId }: { userId: number; }) {
    try {
        const existing = await db.query.userProfiles.findFirst({
            where: eq(userProfiles.user_id, BigInt(userId)),
        });

        if (existing?.summarization_status === "done" || existing?.summarization_status === "no_data") {
            return;
        }

        const rows = (await ch.query({
            query: `
        SELECT text, c.channel_name
        FROM default.messages m
        LEFT JOIN default.channels c ON m.channel_id = c.id
        WHERE m.user_id = ${userId} AND length(text) > 10
        LIMIT 1000
      `,
            format: "JSONEachRow",
        }).then((r) => r.json())) as { text: string; channel_name: string }[];

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
- Все значения должны быть на **русском языке**.
- Ответ строго в формате JSON по заданной схеме.
          `,
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
    } catch (err) {
        logger.error("🔥 Ошибка в summarizeOneUser", { userId, error: err });
    }
}
