import { task, logger } from "@trigger.dev/sdk/v3";
import { db } from "../../db/client";
import { eq, and, or, isNull, sql } from "drizzle-orm";
import { channels, userProfiles, channelMembers } from "../../db/schema";
import { summarizePendingBatch } from "../../services/summarizePendingBatch";
import { generateFinalChannelReport } from "./generateFinalChannelReport";
import {delayedMonitorTrigger} from "./delayedMonitorTrigger";

export const monitorChannelAnalysis = task({
    id: "monitor-channel-analysis",
    run: async (payload: { channelId: bigint; channelUsername: string; chatId: number }) => {
        const { channelId, channelUsername, chatId } = payload;

        logger.info("🔁 Проверка готовности данных", { channelUsername });

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

        const pending = Number(pendingCount);

        logger.info("🧮 Статус:", {
            parsing: isParsingComplete ? "✅" : "⏳",
            summarized: pending === 0 ? "✅" : `${pending} осталось`,
            report: isReportAlreadyGenerated ? "📝" : "—",
        });

        if (isParsingComplete && pending === 0 && !isReportAlreadyGenerated) {
            logger.info("📈 Все готово, запускаем генерацию отчета", { channelId });
            await generateFinalChannelReport.trigger({ channelId, chatId });
            return;
        }

        if (pending > 0) {
            await summarizePendingBatch(channelId);
        }

        // 💡 Задержка на 30 секунд и рекурсивный триггер
        await delayedMonitorTrigger.trigger({
            ...payload,
            delayMs: 30_000,
        });
    },
});
