import { Context } from "telegraf";
import { getTelegramClient } from "../telegram/client";
import { Api } from "telegram";
import { parseAndSummarizeChannel } from "../trigger/jobs/parseAndSummarizeChannel";

export const checkConnectionHandler = async (ctx: Context & { session?: any }) => {
    await ctx.answerCbQuery(); // Снимаем "часики"

    const channelUsername = ctx.session?.channelUsername;
    if (!channelUsername) {
        await ctx.reply("❌ Канал не найден. Попробуйте заново ввести @username.");
        return;
    }

    try {
        const client = await getTelegramClient();
        const entity = await client.getEntity(`@${channelUsername}`);

        if (!(entity instanceof Api.Channel)) {
            await ctx.reply("⚠️ Это не канал.");
            return;
        }

        const myAccount = await client.getMe();

        // 👇 Пытаемся получить информацию о себе в канале
        const participantInfo = await client.invoke(
            new Api.channels.GetParticipant({
                channel: entity,
                participant: myAccount,
            })
        );

        const participant = (participantInfo as any).participant;

        const isAdmin =
            participant.className === "ChannelParticipantAdmin" ||
            participant.className === "ChannelParticipantCreator";

        if (!isAdmin) {
            await ctx.reply(
                `❌ Наш аккаунт @${process.env.TELEGRAM_USERNAME} не является админом канала.\n\n` +
                `Пожалуйста, добавьте его и нажмите кнопку ещё раз.`
            );
            return;
        }

        const channelId = BigInt(entity.id.toString());

        await ctx.reply("✅ Подключение подтверждено. Начинаем анализ подписчиков...");
        await parseAndSummarizeChannel.trigger({
            channelId,
            channelUsername,
        });

    } catch (err: any) {
        if (err.errorMessage === "USER_NOT_PARTICIPANT") {
            await ctx.reply(
                `❌ Наш аккаунт @${process.env.TELEGRAM_USERNAME} не добавлен в канал.\n\n` +
                `Пожалуйста, добавьте его и нажмите кнопку ещё раз.`
            );
        } else {
            console.error("❌ Ошибка при проверке подключения:", err);
            await ctx.reply("❌ Не удалось проверить подключение. Попробуйте позже.");
        }
    }
};
