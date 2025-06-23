import { Context } from "telegraf";
import { markOrderAsPaid } from "../db/queries/orders";

export const handleSuccessfulPayment = async (ctx: Context) => {
    const message = ctx.message;

    // ✅ Проверка на существование и наличие поля
    if (!message || !("successful_payment" in message)) return;

    const payload = message.successful_payment.invoice_payload;
    const orderId = parseInt(payload ?? "", 10);
    if (!orderId) return;

    await markOrderAsPaid(orderId);

    await ctx.reply(
        `✅ Оплата прошла успешно!\n\n` +
        `⚙️ Последний шаг: добавьте нашего бота в канал с правами администратора (можно без права публикации).\n\n` +
        `👤 Имя бота: @${process.env.TELEGRAM_USERNAME}\n\n` +
        `📡 После этого нажмите кнопку ниже — мы проверим доступ и начнём анализ.`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Проверить и начать анализ", callback_data: "check_connection" }],
                ],
            },
        }
    );
};
