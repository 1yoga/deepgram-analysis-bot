import { task, logger } from "@trigger.dev/sdk/v3";
import { TelegramClient } from "telegram";
import { Api } from "telegram";
import { StringSession } from "telegram/sessions";
import bigInt from "big-integer";
import { promises as fs } from "fs";

import { db } from "../../db/client";
import { userProfiles, channelMembers, channels } from "../../db/schema";
import {eq} from "drizzle-orm";

const alphabet = [
    ..."abcdefghijklmnopqrstuvwxyz",
    ..."абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
    ..."0123456789",
    "_", "-", ".",
];

const BATCH_DELAY_MS = 500;
const INSERT_BATCH_SIZE = 100;
const BIGRAM_LIMIT = Number(process.env.BIGRAM_LIMIT ?? 20);

export const parseMembersTask = task({
    id: "parse-members-task",
    run: async (payload: { channelId: bigint; channelUsername: string }) => {
        const { channelId, channelUsername } = payload;

        logger.info("📥 Запускаем парсинг участников", { channelUsername });

        const client = await getTelegramClient();
        const entity = await client.getEntity(`@${channelUsername}`);
        const bigrams: string[] = JSON.parse(await fs.readFile("./bigrams.json", "utf8"));
        const seen = new Set<number>();

        if (!(entity instanceof Api.Channel)) throw new Error("Не является каналом");

        for (const char of alphabet) {
            logger.info(`🔠 Парсим символ "${char}"`, { seen: seen.size });

            const { shouldUseBigrams } = await parseQuery({ q: char, entity, seen, channelId, client });

            if (shouldUseBigrams) {
                const subs = bigrams.filter((b) => b.startsWith(char)).slice(0, BIGRAM_LIMIT);
                for (const bigram of subs) {
                    logger.info(`🔤 Парсим биграмму "${bigram}"`, { seen: seen.size });
                    await parseQuery({ q: bigram, entity, seen, channelId, client });
                }
            }
        }

        await client.disconnect();

        await db.update(channels)
            .set({ parsing_complete: true })
            .where(eq(channels.id, channelId));

        logger.info("✅ Парсинг завершён", { total: seen.size });
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
}): Promise<{ shouldUseBigrams: boolean }> {
    const limit = 100;
    let offset = 0;
    let shouldUseBigrams = false;

    while (true) {
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

        const newUsers = res.users
            .filter((u): u is Api.User => u instanceof Api.User)
            .filter((u) => !seen.has(u.id.toJSNumber()));

        if (newUsers.length === 0) break;

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

        for (const u of newUsers) {
            seen.add(u.id.toJSNumber());
        }

        offset += res.users.length;
        if (res.users.length < limit) break;
        shouldUseBigrams = true;

        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }

    return { shouldUseBigrams };
}
