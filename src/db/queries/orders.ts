import { db } from "../client";
import { orders } from "../schema";
import { eq } from "drizzle-orm";

export async function createOrder(userId: bigint, channelId: bigint, price_stars: number) {
    const result = await db.insert(orders).values({
        user_id: userId,
        channel_id: channelId,
        price_stars,
    }).returning({ id: orders.id });

    return result[0].id;
}

export async function markOrderAsPaid(orderId: number) {
    await db.update(orders)
        .set({ status: "paid", paid_at: new Date() })
        .where(eq(orders.id, orderId));
}
