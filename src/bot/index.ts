import {Context, Telegraf} from "telegraf";
import { config } from "dotenv";
import { session } from "telegraf";
config();

import { onboardingHandler } from "../handlers/onboarding";
import { checkChannelHandler } from "../handlers/checkChannel";
import { handleSuccessfulPayment } from "../handlers/payment";
import { checkConnectionHandler } from "../handlers/checkConnection";
import {BotContext, SessionData} from "../types/session";

const bot = new Telegraf<BotContext>(process.env.BOT_TOKEN!);
import { configure } from "@trigger.dev/sdk/v3";

configure({
    secretKey: process.env.TRIGGER_SECRET_KEY!,
});

bot.use(session({ defaultSession: (): SessionData => ({}) }) as any);

bot.start(onboardingHandler);
bot.on("text", checkChannelHandler);
bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));
bot.on("successful_payment", handleSuccessfulPayment);
bot.action("check_connection", checkConnectionHandler);

bot.launch().then(() => console.log("🤖 Bot started"));
