import { createClient } from "@clickhouse/client";

export const ch = createClient({
    url: process.env.CLICKHOUSE_URL!,
    username: process.env.CLICKHOUSE_USER!,
    password: process.env.CLICKHOUSE_PASS!,
    request_timeout: 60_000,
});