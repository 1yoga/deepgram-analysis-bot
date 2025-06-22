import { task, logger } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import { db } from "../../db/client";
import { channels, userProfiles, channelMembers } from "../../db/schema";
import {eq, and, desc, sql, isNull} from "drizzle-orm";
import axios from "axios";
import fs from "fs/promises";
import { stringify } from "csv-stringify/sync";
import FormData from "form-data";

export const generateFinalChannelReport = task({
    id: "generate-final-channel-report",
    run: async ({ channelId, chatId }: { channelId: bigint; chatId: number }, { ctx }) => {
        logger.info("📈 Генерация итогового отчёта", { channelId });

        const channel = await db.query.channels.findFirst({
            where: eq(channels.id, channelId),
        });

        if (!channel) {
            logger.error("❌ Канал не найден", { channelId });
            return;
        }

        const total = await db
            .select({ count: sql<number>`count(*)` })
            .from(userProfiles)
            .innerJoin(channelMembers, eq(userProfiles.user_id, channelMembers.user_id))
            .where(and(
                eq(channelMembers.channel_id, channelId),
                eq(userProfiles.summarization_status, "done")
            ))

        const count = total[0]?.count || 0;
        if (count === 0) {
            logger.warn("❌ Нет пользователей для отчёта", { channelId });
            return;
        }

        const [genderStats, ageStats, countryStats, interestStats, summariesRaw] = await Promise.all([
            db.select({ group: userProfiles.gender, c: sql<number>`count(*)` })
                .from(userProfiles)
                .innerJoin(channelMembers, eq(userProfiles.user_id, channelMembers.user_id))
                .where(and(
                    eq(channelMembers.channel_id, channelId),
                    eq(userProfiles.summarization_status, "done")
                ))
                .groupBy(userProfiles.gender),

            db.select({ group: userProfiles.age_group, c: sql<number>`count(*)` })
                .from(userProfiles)
                .innerJoin(channelMembers, eq(userProfiles.user_id, channelMembers.user_id))
                .where(and(
                    eq(channelMembers.channel_id, channelId),
                    eq(userProfiles.summarization_status, "done")
                ))
                .groupBy(userProfiles.age_group),

            db.select({ group: userProfiles.country, c: sql<number>`count(*)` })
                .from(userProfiles)
                .innerJoin(channelMembers, eq(userProfiles.user_id, channelMembers.user_id))
                .where(and(
                    eq(channelMembers.channel_id, channelId),
                    eq(userProfiles.summarization_status, "done")
                ))
                .groupBy(userProfiles.country)
                .orderBy(desc(sql<number>`count(*)`))
                .limit(10),

            db.select({ group: sql<string>`unnest(${userProfiles.interests})`, c: sql<number>`count(*)` })
                .from(userProfiles)
                .innerJoin(channelMembers, eq(userProfiles.user_id, channelMembers.user_id))
                .where(and(
                    eq(channelMembers.channel_id, channelId),
                    sql`cardinality(${userProfiles.interests}) > 0`
                ))
                .groupBy(sql`1`)
                .orderBy(desc(sql<number>`count(*)`))
                .limit(10),

            db.select({ summary: userProfiles.summary })
                .from(userProfiles)
                .innerJoin(channelMembers, eq(userProfiles.user_id, channelMembers.user_id))
                .where(and(
                    eq(channelMembers.channel_id, channelId),
                    sql`length(${userProfiles.summary}) > 10`
                ))
                .orderBy(sql`random()`)
                .limit(100),
        ]);

        const percent = (n: number) => `${Math.round((n / count) * 100)}%`;

        const genderLine = genderStats.map(g => `${mapGender(g.group)} (${percent(g.c)})`).join(', ');
        const ageLine = ageStats.map(a => `${a.group} (${percent(a.c)})`).join(', ');
        const countryLine = countryStats.map(c => `${c.group} (${percent(c.c)})`).join(', ');
        const interestLine = interestStats.map(i => `${i.group} (${percent(i.c)})`).join(', ');

        const summaries = summariesRaw
            .map(s => s.summary?.trim())
            .filter((s): s is string => Boolean(s));

        const gptPrompt = `
Ты — эксперт по аналитике Telegram-аудиторий. У тебя есть сводные статистики и 100 кратких описаний пользователей канала "${channel.username}".

Сначала прочитай данные:

1. Гендер: ${genderLine}
2. Возраст: ${ageLine}
3. География: ${countryLine}
4. Интересы: ${interestLine}

Теперь:

📌 Часть 1. Аудиторные сегменты

На основе 100 summary — выведи **три портрета пользователей**:

🟠 Каждый портрет — это сегмент аудитории (укажи, примерно, сколько % он охватывает).

🟠 Формат:
  🧬 Портрет 1 — ~48% аудитории

  [два абзаца живого описания: кто они, чем живут, о чём думают, как себя ведут]

  (и так далее для Портрет 2 и 3)

🟠 Не используй списки. Не используй шаблоны вроде "Это человек, который...". Пиши живо, маркетологическим языком.

---

📌 Часть 2. Выводы и рекомендации

На основе всех данных (статистики + summary + портреты), предложи **рекомендации по трём направлениям**:

**1. Контент:** что публиковать, какие форматы заходят, какой стиль лучше.

**2. Вовлечение:** как лучше включать аудиторию в активность (опросы, AMA, чаты, реакции и т.п.).

**3. Монетизация:** какие типы продуктов и форматов рекламы подходят, как лучше интегрировать.

Формулируй рекомендации конкретно, по делу. Без воды. Пиши на русском.
`.trim();

        const gptInput = summaries.join('\n\n');

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

        const completion = await openai.chat.completions.create({
            model: "gpt-4.1-nano",
            messages: [
                { role: "system", content: gptPrompt },
                { role: "user", content: gptInput },
            ],
        });

        const reportText = completion.choices[0].message.content?.trim();
        if (!reportText) {
            logger.error("❌ GPT не дал ответа");
            return;
        }

        const reportHeader = `📊 ОТЧЁТ ПО КАНАЛУ @${channel.username}
🗓 Дата: ${new Date().toLocaleDateString("ru-RU")}
👥 Подписчиков в выборке: ${count.toLocaleString("ru-RU")}

📍 ОБЩИЙ ОБЗОР

Гендер: ${genderLine}
Возраст: ${ageLine}
География: ${countryLine}
Интересы: ${interestLine}

📍 ГЕНДЕРНЫЙ СОСТАВ
${genderStats.map(g => `- **${mapGender(g.group)}** — ${percent(g.c)}`).join('\n')}

📍 ВОЗРАСТНАЯ СТРУКТУРА
${ageStats.map(a => `- ${a.group}: ${percent(a.c)}`).join('\n')}

📍 ГЕОГРАФИЯ ПОДПИСЧИКОВ
${countryStats.map(c => `- ${c.group}: ${percent(c.c)}`).join('\n')}

📍 ОСНОВНЫЕ ИНТЕРЕСЫ
${interestStats.map((i, idx) => `${idx + 1}. ${i.group}: ${percent(i.c)}`).join('\n')}

📍 СЕГМЕНТЫ АУДИТОРИИ + РЕКОМЕНДАЦИИ

`;

        const finalText = `${reportHeader}${reportText}

📎 ПРИЛОЖЕНИЯ
- CSV-файл с полным анализом каждого пользователя`;

        await sendLongMessage(chatId, finalText);

        await sendProfilesCSV(chatId, channelId, channel.username);

        const updated = await db.update(channels)
            .set({
                report_text: finalText,
                report_generated_at: new Date(),
            })
            .where(and(
                eq(channels.id, channelId),
                isNull(channels.report_generated_at)
            ))
            .returning({ id: channels.id });

        if (updated.length === 0) {
            logger.info("🔁 Отчёт уже сгенерирован другим процессом, выходим");
            return;
        }

        logger.info("✅ Финальный отчёт сгенерирован и сохранён", { channelId });
    }
});

async function sendLongMessage(chatId: number, text: string) {
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
    const MAX_LENGTH = 4000; // запас от лимита Telegram (4096)
    const chunks = splitTextIntoChunks(text, MAX_LENGTH);

    for (let i = 0; i < chunks.length; i++) {
        const part = chunks[i];

        try {
            await axios.post(TELEGRAM_API_URL, {
                chat_id: chatId,
                text: part,
                parse_mode: "Markdown",
            });

            logger.info("📤 Отправлен фрагмент отчёта", {
                chatId,
                part: `${i + 1}/${chunks.length}`,
            });

            await new Promise((r) => setTimeout(r, 500)); // задержка между отправками (мягкая)
        } catch (err) {
            logger.error("❌ Ошибка при отправке фрагмента", {
                chatId,
                part: i + 1,
                error: err,
            });
            break; // остановить при ошибке
        }
    }
}

function splitTextIntoChunks(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        let end = start + maxLength;

        // Попробуем не обрезать на середине слова
        if (end < text.length) {
            const lastNewline = text.lastIndexOf("\n", end);
            const lastSpace = text.lastIndexOf(" ", end);
            if (lastNewline > start) end = lastNewline;
            else if (lastSpace > start) end = lastSpace;
        }

        chunks.push(text.slice(start, end).trim());
        start = end;
    }

    return chunks;
}

function mapGender(gender: string | null): string {
    if (!gender) return "Не указано";
    const normalized = gender.toLowerCase();
    if (normalized === "male") return "Мужчины";
    if (normalized === "female") return "Женщины";
    return gender;
}

async function sendProfilesCSV(chatId: number, channelId: bigint, channelUsername: string) {
    const rows = await db
        .select({
            user_id: userProfiles.user_id,
            username: userProfiles.username,
            gender: userProfiles.gender,
            age_group: userProfiles.age_group,
            country: userProfiles.country,
            language: userProfiles.language,
            interests: userProfiles.interests,
            tone: userProfiles.tone,
            summary: userProfiles.summary,
        })
        .from(userProfiles)
        .innerJoin(channelMembers, eq(userProfiles.user_id, channelMembers.user_id))
        .where(and(
            eq(channelMembers.channel_id, channelId),
            eq(userProfiles.summarization_status, "done")
        ));

    const records = rows.map(r => ({
        ...r,
        interests: r.interests?.join(", ") ?? "",
    }));

    const csv = stringify(records, { header: true });
    const bom = "\uFEFF"; // Excel-friendly UTF-8 BOM
    const filePath = `/tmp/${channelUsername}_profiles.csv`;
    await fs.writeFile(filePath, bom + csv, "utf8");

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", await fs.readFile(filePath), {
        filename: `${channelUsername}_profiles.csv`,
        contentType: "text/csv",
    });

    await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendDocument`, form, {
        headers: form.getHeaders(),
    });

    logger.info("📎 CSV-файл отправлен");

    await fs.unlink(filePath); // удалить временный файл
}
