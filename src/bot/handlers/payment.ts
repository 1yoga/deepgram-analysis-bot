import { Context } from "telegraf";

export const handlePayment = async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await ctx.replyWithInvoice({
        title: "AI-анализ Telegram-канала",
        description: "Глубокий анализ подписчиков и поведенческих данных.",
        payload: "analyze_channel",
        provider_token: process.env.PAYMENT_PROVIDER_TOKEN!,
        currency: "USD",
        prices: [{ label: "AI-анализ", amount: 10000 }], // $100 = 10000 (в копейках)
        start_parameter: "analyze",
        photo_url: "https://telegra.ph/file/123abc456def.jpg",
    });
};