import {Context} from "telegraf";

export interface SessionData {
    channelUsername?: string;
    orderId?: number;
}

export type BotContext = Context & { session: SessionData };