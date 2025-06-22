import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import bigInt from "big-integer";
import { bigrams } from "../trigger/bigrams";
import { db } from "../db/client";
import { userProfiles, channelMembers } from "../db/schema";

const alphabet = [
    ..."abcdefghijklmnopqrstuvwxyz",
    ..."абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
    ..."0123456789",
    "_", "-", ".",
];

const BATCH_DELAY_MS = 500;
const INSERT_BATCH_SIZE = 100;
const BIGRAM_LIMIT = Number(process.env.BIGRAM_LIMIT ?? 20);

export async function parseAndSaveMembers(channelId: bigint, channelUsername: string) {
    const client = await getTelegramClient();
    const entity = await client.getEntity(`@${channelUsername}`);
    const seen = new Set<number>();

    if (!(entity instanceof Api.Channel)) throw new Error("Не является каналом");

    for (const char of alphabet) {
        const { shouldUseBigrams } = await parseQuery({ q: char, entity, seen, channelId, client });

        if (shouldUseBigrams) {
            const subs = bigrams.filter((b) => b.startsWith(char)).slice(0, BIGRAM_LIMIT);
            for (const bigram of subs) {
                await parseQuery({ q: bigram, entity, seen, channelId, client });
            }
        }
    }

    await client.disconnect();
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

        if (!newUsers.length) break;

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
        else shouldUseBigrams = true;

        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }

    return { shouldUseBigrams };
}

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
