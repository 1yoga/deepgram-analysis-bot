import { Context } from "telegraf";
import { Markup } from "telegraf";

export const onboardingHandler = async (ctx: Context) => {
    await ctx.reply(
        `👋 Привет! Я — *Deepgram Bot*.\n\n` +
        `Я помогу провести AI-анализ подписчиков вашего канала и отправлю подробный отчет.\n\n` +
        `Нажмите кнопку ниже, чтобы начать.`,
        Markup.keyboard([["🚀 Start"]]).resize()
    );
};
