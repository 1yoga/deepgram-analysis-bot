import { task, logger } from "@trigger.dev/sdk/v3";
import { db } from "../../db/client";
import { eq, and, or, isNull, sql } from "drizzle-orm";
import { channels, userProfiles, channelMembers } from "../../db/schema";

import { parseMembersTask } from "./parseMembersTask";
import { summarizePendingBatch } from "../../services/summarizePendingBatch";
import { generateFinalChannelReport } from "./generateFinalChannelReport";

export const startChannelAnalysis = task({
    id: "start-channel-analysis",
    run: async (payload: { channelId: bigint; channelUsername: string; chatId: number }) => {
        const { channelId, channelUsername, chatId  } = payload;

        logger.info("🚀 Старт анализа канала", { channelUsername });

        // 1. 🚀 Запускаем асинхронный парсинг
        try {
            await parseMembersTask.trigger({ channelId, channelUsername });
            logger.info("📤 Парсинг запущен через Trigger");
        } catch (err) {
            logger.error("❌ Не удалось запустить parseMembersTask", { error: err });
            return; // не продолжаем, если парсинг даже не стартовал
        }

        // 2. 🔁 Саммаризация + проверка готовности
        while (true) {
            // Пробуем саммаризовать хотя бы кого-то
            const summarized = await summarizePendingBatch(channelId);

            // Получаем свежие данные по каналу
            const channel = await db.query.channels.findFirst({
                where: eq(channels.id, channelId),
            });

            const isParsingComplete = channel?.parsing_complete === true;
            const isReportAlreadyGenerated = channel?.report_generated_at !== null;

            const [{ count: pendingCount }] = await db
                .select({ count: sql<number>`count(*)` })
                .from(userProfiles)
                .innerJoin(channelMembers, eq(userProfiles.user_id, channelMembers.user_id))
                .where(and(
                    eq(channelMembers.channel_id, channelId),
                    or(
                        isNull(userProfiles.summarization_status),
                        eq(userProfiles.summarization_status, "pending")
                    )
                ));

            logger.info("🔄 Статус анализа", {
                pendingCount,
                parsing: isParsingComplete ? "✅" : "⏳",
                generated: isReportAlreadyGenerated ? "📝" : "—",
            });

            const pendingCountNum = Number(pendingCount);

            if (isParsingComplete && pendingCountNum === 0 && !isReportAlreadyGenerated) {
                logger.info("✅ Все данные готовы, запускаем генерацию отчёта", { channelId });
                break;
            }

            // ⏳ Подождём перед следующей проверкой
            await new Promise((r) => setTimeout(r, 3000));
        }

        // 3. 📈 Генерация отчёта
        await generateFinalChannelReport.trigger({ channelId, chatId });
        logger.info("🎉 Анализ канала завершён", { channelId });
    },
});
