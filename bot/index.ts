import { Telegraf } from "telegraf";
import * as dotenv from "dotenv";
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN!);

bot.start(ctx => {
    return ctx.replyWithMarkdown(
        `👋 *Привет!* Я — *Deepgram Bot*.\n\n` +
        `Я помогу провести AI‑анализ подписчиков вашего канала и отправлю подробный PDF‑отчёт.\n\n` +
        `📊 Анализ включает:\n` +
        `– Портреты подписчиков (тональность, интересы, профессия)\n` +
        `– Речевые паттерны\n` +
        `– Рекомендации для роста\n\n` +
        `Нажмите *Start*, чтобы начать.`
    );
});

bot.launch()
    .then(() => console.log("Telegram bot started"))
    .catch(console.error);
