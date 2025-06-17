import { Context } from "telegraf";
import { Message } from "typegram";
import { getTelegramClient } from "../../telegram/client";
import { Api } from "telegram";

const basePrice = Number(process.env.PRICE_BASE ?? 20);
const multiplier = Number(process.env.PRICE_MULTIPLIER ?? 10);

export const checkChannelHandler = async (ctx: Context) => {
    const message = ctx.message as Message.TextMessage;
    const text = message?.text;

    if (!text?.startsWith("@")) {
        await ctx.reply("Введите корректный @username канала.");
        return;
    }

    const username = text.slice(1);

    try {
        const client = await getTelegramClient();
        const entity = await client.getEntity(username);

        if (!(entity instanceof Api.Channel)) {
            await ctx.reply("Это не канал.");
            return;
        }

        const full = await client.invoke(
            new Api.channels.GetFullChannel({
                channel: entity,
            })
        );

        const fullChannel = full.fullChat as Api.ChannelFull;
        const membersCount = fullChannel.participantsCount ?? 0;

        const price = Math.round(basePrice + Math.log10(membersCount + 1) * multiplier);
        const stars = price * 10;

        await ctx.reply(
            `🔍 Мы нашли ваш канал:\n` +
            `@${username} — ${membersCount.toLocaleString("ru-RU")} подписчиков\n\n` +
            `💰 Стоимость анализа: $${price} (≈ ${stars} Telegram Stars)\n\n` +
            `Продолжим?`,
            {
                reply_markup: {
                    keyboard: [["✅ Оплатить", "🔙 Назад"]],
                    resize_keyboard: true,
                },
            }
        );
    } catch (err: any) {
        console.error("❌ Ошибка при анализе канала:", err);
        await ctx.reply("❌ Не удалось получить данные о канале. Убедитесь, что он существует и публичен.");
    }
};
