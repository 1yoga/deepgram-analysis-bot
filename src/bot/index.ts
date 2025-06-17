import { Telegraf, Markup } from "telegraf";
import { config } from "dotenv";
config();

import { onboardingHandler } from "./handlers/onboarding";
import { checkChannelHandler } from "./handlers/checkChannel";
import {handlePayment} from "./handlers/payment";

const bot = new Telegraf(process.env.BOT_TOKEN!);

bot.start(onboardingHandler);
bot.on("text", checkChannelHandler);
bot.on("pre_checkout_query", (ctx) => {
    ctx.answerPreCheckoutQuery(true);
});

bot.on("successful_payment", async (ctx) => {
    const payload = ctx.message.successful_payment?.invoice_payload;
    const orderId = parseInt(payload, 10);
    if (!orderId) return;

    await markOrderAsPaid(orderId);

    // ✅ Запуск анализа (Trigger, очередь, вручную)
    await analyzeChannelByOrder(orderId); // или вызов trigger.dev

    await ctx.reply("✅ Оплата прошла! Анализ начался, это займёт 1–3 часа.");
});
bot.hears("✅ Оплатить", handlePayment);

bot.launch().then(() => console.log("🤖 Bot started"));
