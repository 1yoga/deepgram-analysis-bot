import { Context } from "telegraf";
import { upsertUser } from "../db/queries/users";
import {posthog} from "../posthog";

export const onboardingHandler = async (ctx: Context) => {
    await upsertUser(ctx);
    posthog.capture({
        distinctId: ctx.from!.id.toString(),
        event: "start_bot",
        properties: {
            username: ctx.from?.username,
            first_name: ctx.from?.first_name,
        },
    });

    await ctx.reply(
        `👋 Привет! Я — Inflexo Bot.\n` +
        `Я помогу провести AI-анализ подписчиков вашего канала и отправлю подробный отчет.\n\n` +
        `Введите @username канала, чтобы начать.`
    );
};