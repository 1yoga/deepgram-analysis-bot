/*
// src/services/analyzeChannel.ts
import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { getTelegramClient } from '../telegram/client';
import { db } from "../db/client";
import { users, channelMembers, userProfiles } from '../db/schema';
import { summarizeUser } from './summarizeUser';
import { and, eq } from 'drizzle-orm';

export async function analyzeChannel(channelUsername: string) {
    const client: TelegramClient = await getTelegramClient();
    const entity = await client.getEntity(`@${channelUsername}`);
    if (!(entity instanceof Api.Channel)) throw new Error("Это не Channel");

    const channelId = BigInt(entity.id.toString());

    // 🔄 Однобуквенный обход
    const alphabet = [...'абвгдеёжзийклмнопрстуфхцчшщъыьэюяabcdefghijklmnopqrstuvwxyz0123456789'];
    const limit = 100;
    const seen = new Set<bigint>();

    for (const letter of alphabet) {
        let offset = 0;
        while (true) {
            const result = await client.invoke(new Api.channels.GetParticipants({
                channel: entity,
                filter: new Api.ChannelParticipantsSearch({ q: letter }),
                offset,
                limit,
                hash: bigInt(0),
            }));

            if (!(result instanceof Api.channels.ChannelParticipants)) break;

            const usersToInsert: typeof users.$inferInsert[] = [];
            const membersToInsert: typeof channelMembers.$inferInsert[] = [];

            for (const user of result.users) {
                if (!(user instanceof Api.User)) continue;
                const userId = BigInt(user.id.toString());
                if (seen.has(userId)) continue;
                seen.add(userId);

                usersToInsert.push({
                    id: userId,
                    username: user.username ?? null,
                    first_name: user.firstName ?? null,
                    last_name: user.lastName ?? null,
                });

                membersToInsert.push({
                    user_id: userId,
                    channel_id: channelId,
                });

                // 🔁 параллельный запуск саммаризации
                //summarizeUser(userId, channelUsername).catch(console.error);
            }

            await db.insert(users).values(usersToInsert).onConflictDoNothing();
            await db.insert(channelMembers).values(membersToInsert).onConflictDoNothing();

            if (result.users.length < limit) break;
            offset += result.users.length;
        }
    }
}
*/
