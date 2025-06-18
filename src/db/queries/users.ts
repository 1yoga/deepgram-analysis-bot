import { db } from "../client";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { Context } from "telegraf";

export async function upsertUser(ctx: Context) {
    const tgUser = ctx.from;
    if (!tgUser) return;

    const exists = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, BigInt(tgUser.id)),
    });

    if (!exists) {
        await db.insert(users).values({
            id: BigInt(tgUser.id),
            username: tgUser.username,
            first_name: tgUser.first_name,
            last_name: tgUser.last_name,
        });
    }
}
