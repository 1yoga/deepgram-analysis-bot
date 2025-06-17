import { TriggerClient } from "@trigger.dev/sdk";
import * as dotenv from "dotenv";
dotenv.config();

const client = new TriggerClient({
    project: process.env.TRIGGER_PROJECT_ID!,
    apiKey: process.env.TRIGGER_API_KEY!,
});

client.listen(); // Ждём jobs
