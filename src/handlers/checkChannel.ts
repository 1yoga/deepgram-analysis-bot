import { Context } from "telegraf";
import { getTelegramClient } from "../telegram/client";
import { upsertUser } from "../db/queries/users";
import { upsertChannel } from "../db/queries/channels";
import { createOrder } from "../db/queries/orders";
import { calculatePrice } from "../services/price";
import { Api } from "telegram";

export const checkChannelHandler = async (ctx: Context & { session?: any }) => {
    const message = ctx.message;

    if (!message || typeof message !== "object" || !("text" in message)) return;

    const text = message.text;
    if (!text.startsWith("@")) {
        await ctx.reply("Введите корректный @username канала.");
        return;
    }

    const username = text.slice(1);
    ctx.session = ctx.session || {};
    ctx.session.channelUsername = username;

    const userId = BigInt(ctx.from!.id);

    try {
        const client = await getTelegramClient();
        const entity = await client.getEntity(username);

        if (!(entity instanceof Api.Channel)) {
            await ctx.reply("⚠️ Это не канал.");
            return;
        }

        try {
            await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
            await ctx.reply("✅ Канал найден");
        } catch (joinErr) {
            console.error("❗ Ошибка при подписке:", joinErr);
            await ctx.reply("⚠️ Не удалось подписаться на канал. Возможно, доступ ограничен.");
        }

        const full = await client.invoke(
            new Api.channels.GetFullChannel({ channel: entity })
        );

        const fullChat = full.fullChat;
        if (!(fullChat instanceof Api.ChannelFull)) {
            await ctx.reply("⚠️ Не удалось получить полную информацию о канале.");
            return;
        }

        const channelId = BigInt(entity.id.toString());
        const members = fullChat.participantsCount ?? 0;
        const price = 1 // calculatePrice(members);

        await upsertUser(ctx);
        await upsertChannel({
            id: channelId,
            username,
            title: entity.title ?? "",
            is_public: !entity.megagroup,
            members_count: members,
        });

        const orderId = await createOrder(userId, channelId, price);

        await ctx.replyWithInvoice({
            title: `AI-анализ канала @${username}`,
            description: `Анализ ${members} подписчиков`,
            payload: String(orderId),
            provider_token: process.env.PAY_TOKEN!,
            currency: "XTR",
            prices: [{ label: `Анализ`, amount: price }],
            is_flexible: false,
        });
    } catch (err) {
        console.error(err);
        await ctx.reply("❌ Не удалось получить информацию о канале.");
    }
};
