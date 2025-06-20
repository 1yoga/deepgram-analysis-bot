import { db } from "../db/client";
import { userProfiles, channelMembers } from "../db/schema";
import { summarizeUserBatch } from "../trigger/jobs/summarizeUserBatch";
import { and, eq, or, isNull } from "drizzle-orm";
import { logger } from "@trigger.dev/sdk/v3";

export async function summarizePendingBatch(channelId: bigint): Promise<boolean> {
    const pendingUsers = await db
        .select({
            userId: userProfiles.user_id,
            username: userProfiles.username,
        })
        .from(userProfiles)
        .innerJoin(channelMembers, eq(userProfiles.user_id, channelMembers.user_id))
        .where(
            and(
                eq(channelMembers.channel_id, channelId),
                or(
                    isNull(userProfiles.summarization_status),
                    eq(userProfiles.summarization_status, "pending")
                )
            )
        )
        .limit(100); // можно изменить лимит

    if (pendingUsers.length === 0) {
        return true; // ✅ Всё уже саммаризировано
    }

    try {
        await summarizeUserBatch.trigger({
            users: pendingUsers.map((u) => ({
                userId: Number(u.userId),
                username: u.username,
            })),
            channelId,
        });

        logger.info("📤 Отправлен батч на саммаризацию", {
            count: pendingUsers.length,
        });
    } catch (err) {
        logger.error("❌ Ошибка при запуске summarizeUserBatch", {
            error: err,
            channelId,
        });
    }

    return false;
}
