import { task, logger } from "@trigger.dev/sdk/v3";
import { parseMembersTask } from "./parseMembersTask";
import {monitorChannelAnalysis} from "./monitorChannelAnalysis";


export const startChannelAnalysis = task({
    id: "start-channel-analysis",
    run: async ({ channelId, channelUsername, chatId }: { channelId: bigint; channelUsername: string; chatId: number }) => {
        logger.info("🚀 Старт анализа канала", { channelUsername });

        try {
            await parseMembersTask.trigger({ channelId, channelUsername });
            logger.info("📤 Парсинг запущен");
        } catch (err) {
            logger.error("❌ Ошибка запуска парсинга", { error: err });
            return;
        }

        await monitorChannelAnalysis.trigger({ channelId, channelUsername, chatId });
        logger.info("👀 Мониторинг готовности начат", { channelId });
    },
});

