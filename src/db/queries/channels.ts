import { db } from "../client";
import { channels } from "../schema";
import { eq } from "drizzle-orm";

export async function upsertChannel(channel: {
    id: bigint;
    username: string;
    title: string;
    is_public: boolean;
    members_count: number;
}) {
    const exists = await db.query.channels.findFirst({
        where: (channels, { eq }) => eq(channels.id, channel.id),
    });

    if (!exists) {
        await db.insert(channels).values(channel);
    } else {
        await db.update(channels).set(channel).where(eq(channels.id, channel.id));
    }
}
