// src/trigger/tasks/parseAndSummarizeChannel.ts

import { task, logger } from "@trigger.dev/sdk/v3";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import bigInt from "big-integer";
import { promises as fs } from "fs";
import { db } from "../../db/client";
import { channelMembers, userProfiles } from "../../db/schema";
import {summarizeUserBatch} from "./summarizeUserBatch";

export const parseAndSummarizeChannel = task({
    id: "parse-and-summarize-channel",
    run: async (payload: { channelId: bigint; channelUsername: string }, { ctx }) => {
        const { channelId, channelUsername } = payload;

        logger.info("🚀 Запуск анализа канала", { channelUsername, channelId });

        const client = await getTelegramClient();
        const entity = await client.getEntity(`@${channelUsername}`);

        if (!(entity instanceof Api.Channel)) {
            logger.error("❌ Объект не является каналом", { entity });
            throw new Error("Не является каналом");
        }

        const alphabet = [
            ..."abcdefghijklmnopqrstuvwxyz",
            ..."абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
            ..."0123456789",
            "_", "-", ".",
        ];

        const BIGRAM_LIMIT = Number(process.env.BIGRAM_LIMIT ?? 20);
        const bigrams: string[] = JSON.parse(await fs.readFile("./bigrams.json", "utf8"));
        const seen = new Set<number>();

        for (const char of alphabet) {
            logger.info(`🔠 Парсим символ: "${char}"`, { seenCount: seen.size });

            const { shouldUseBigrams } = await parseQuery({
                q: char,
                entity,
                seen,
                channelId,
                client
            });

            if (shouldUseBigrams) {
                const subs = bigrams.filter((b) => b.startsWith(char)).slice(0, BIGRAM_LIMIT);
                for (const bigram of subs) {
                    logger.info(`🔤 Парсим биграмму: "${bigram}"`, { seenCount: seen.size });
                    await parseQuery({ q: bigram, entity, seen, channelId, client });
                }
            }
        }

        await client.disconnect();
        logger.info("✅ Анализ завершён", { total: seen.size });
    },
});

async function getTelegramClient(): Promise<TelegramClient> {
    const client = new TelegramClient(
        new StringSession(process.env.TELEGRAM_SESSION!),
        Number(process.env.TELEGRAM_API_ID),
        process.env.TELEGRAM_API_HASH!,
        { connectionRetries: 3 }
    );
    await client.connect();
    return client;
}

async function parseQuery({
                              q,
                              entity,
                              seen,
                              channelId,
                              client,
                          }: {
    q: string;
    entity: Api.Channel;
    seen: Set<number>;
    channelId: bigint;
    client: TelegramClient;
}): Promise<{ found: number; shouldUseBigrams: boolean }> {
    const limit = 100;
    const BATCH_DELAY_MS = 500;
    const INSERT_BATCH_SIZE = 100;
    let offset = 0;
    let found = 0;
    let shouldUseBigrams = false;

    logger.info("🔍 Запрос участников", { q });

    while (true) {
        try {
            const res = await client.invoke(
                new Api.channels.GetParticipants({
                    channel: entity,
                    filter: new Api.ChannelParticipantsSearch({ q }),
                    offset,
                    limit,
                    hash: bigInt(0),
                })
            );

            if (!(res instanceof Api.channels.ChannelParticipants)) break;

            const newUsers = res.users.filter((u): u is Api.User => u instanceof Api.User);
            logger.info(`📦 Получено пользователей: ${newUsers.length}`, { q, offset });

            const userProfileBatch = newUsers.map((u) => ({
                user_id: BigInt(u.id.toJSNumber()),
                username: u.username ?? null,
                first_name: u.firstName ?? null,
                last_name: u.lastName ?? null,
            }));

            const channelMemberBatch = newUsers.map((u) => ({
                channel_id: channelId,
                user_id: BigInt(u.id.toJSNumber()),
            }));

            const insertedUsers = newUsers.map((u) => ({
                userId: u.id.toJSNumber(),
                username: u.username ?? null,
            }));

            await db.transaction(async (tx) => {
                for (let i = 0; i < userProfileBatch.length; i += INSERT_BATCH_SIZE) {
                    const batch = userProfileBatch.slice(i, i + INSERT_BATCH_SIZE);
                    await tx.insert(userProfiles).values(batch).onConflictDoNothing();
                }

                for (let i = 0; i < channelMemberBatch.length; i += INSERT_BATCH_SIZE) {
                    const batch = channelMemberBatch.slice(i, i + INSERT_BATCH_SIZE);
                    await tx.insert(channelMembers).values(batch).onConflictDoNothing();
                }
            });

            for (let i = 0; i < insertedUsers.length; i += 100) {
                const batch = insertedUsers.slice(i, i + 100);

                try {
                    await summarizeUserBatch.trigger({ users: batch });
                    logger.info("📤 Отправлен batch на саммаризацию", { count: batch.length });
                } catch (err) {
                    logger.error("❌ Ошибка при вызове summarizeUserBatch", { error: err });
                }
            }

            for (const u of insertedUsers) {
                seen.add(u.userId);
                found++;
            }

            offset += res.users.length;
            if (res.users.length < limit) break;
            else shouldUseBigrams = true;

            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        } catch (err) {
            logger.error("❌ Ошибка при парсинге участников", { q, error: err });
            break;
        }
    }

    return { found, shouldUseBigrams };
}


