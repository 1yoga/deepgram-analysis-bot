import { Context } from "telegraf";
import { upsertUser } from "../db/queries/users";
import { posthog } from "../posthog";
import path from "path";

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

    await ctx.replyWithPhoto(
        {
            source: path.resolve(__dirname, "../welcome.png") // ← переименуй файл без пробелов
        },
        {
            caption:
                `👋 Привет! Я — *Inflexo Bot*.\n\n` +
                `Готов помочь вам узнать всё о вашей аудитории.\n\n` +
                `🔍 Введите *@username* канала или группы, которую хотите проанализировать.`,
            parse_mode: "MarkdownV2"
        }
    );
};
