import { config } from "dotenv";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

config(); // загружаем .env

let client: TelegramClient;
let isStarted = false;

export const getTelegramClient = async (): Promise<TelegramClient> => {
    if (!client) {
        const apiId = Number(process.env.TELEGRAM_API_ID);
        const apiHash = process.env.TELEGRAM_API_HASH!;
        const stringSession = new StringSession(process.env.TELEGRAM_SESSION!);

        client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
        });
    }

    if (!isStarted) {
        await client.start({
            phoneNumber: async () => "",
            password: async () => "",
            phoneCode: async () => "",
            onError: (err) => console.error("TelegramClient error:", err),
        });
        isStarted = true;
        console.log("✅ Telegram client started");
    }

    return client;
};
