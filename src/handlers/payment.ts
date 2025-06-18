import { Context } from "telegraf";
import { markOrderAsPaid } from "../db/queries/orders";
// import { analyzeChannelByOrder } from "../services/analyze";

export const handleSuccessfulPayment = async (ctx: Context) => {
    const message = ctx.message;

    // ✅ Проверка на существование и наличие поля
    if (!message || !("successful_payment" in message)) return;

    const payload = message.successful_payment.invoice_payload;
    const orderId = parseInt(payload ?? "", 10);
    if (!orderId) return;

    await markOrderAsPaid(orderId);
    // await analyzeChannelByOrder(orderId);

    await ctx.reply(
        `✅ Оплата прошла успешно!\n\n` +
        `⚙️ Последний шаг: Добавьте нашего бота в ваш канал с правами администратора (без прав публикации).\n\n` +
        `👤 Кого добавить: @${process.env.TELEGRAM_USERNAME}\n\n` +
        `Это нужно только на время анализа. Бот ничего не публикует и не имеет доступа к сообщениям.`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔍 Проверить подключение", callback_data: "check_connection" }],
                ],
            },
        }
    );
};
