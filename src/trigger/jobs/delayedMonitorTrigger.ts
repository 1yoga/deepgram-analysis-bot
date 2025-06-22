import { task, logger } from "@trigger.dev/sdk/v3";

export const delayedMonitorTrigger = task({
    id: "delayed-monitor-trigger",
    run: async (payload: {
        delayMs: number;
        channelId: bigint;
        channelUsername: string;
        chatId: number;
    }) => {
        logger.info("⏳ Ожидание перед повторной проверкой анализа", {
            delayMs: payload.delayMs,
        });

        await new Promise((r) => setTimeout(r, payload.delayMs));

        const { monitorChannelAnalysis } = await import("./monitorChannelAnalysis");
        await monitorChannelAnalysis.trigger({
            channelId: payload.channelId,
            channelUsername: payload.channelUsername,
            chatId: payload.chatId,
        });
    },
});
