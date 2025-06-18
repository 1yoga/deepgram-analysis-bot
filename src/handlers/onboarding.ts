import { Context } from "telegraf";
import { upsertUser } from "../db/queries/users";

export const onboardingHandler = async (ctx: Context) => {
    await upsertUser(ctx);

    await ctx.reply(
        `👋 Привет! Я — Deepgram Bot.\n` +
        `Я помогу провести AI-анализ подписчиков вашего канала и отправлю подробный отчет.\n\n` +
        `Введите @username канала, чтобы начать.`
    );
};