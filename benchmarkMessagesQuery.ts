import { createClient } from '@clickhouse/client';
import { performance } from 'perf_hooks';

const ch = createClient({
    url: "https://s296gamsmf.eu-central-1.aws.clickhouse.cloud:8443",
    username: "default",
    password: "oy1esxoO_X_k_",
    request_timeout: 600_000
});

// 🔢 Укажи 100 userId

const userIds = [
    7328976332, 7343652039, 368851350, 1446468606, 535295071,
    397887229, 490491732, 6925442879, 673095917, 50900,
    301572425, 334138917, 134337463, 786030328, 728314411,
    778797438, 77946519, 439635067, 152194349, 166775,
    702111008, 287136503, 354754371, 445748742, 156018441,
    47549966, 6150987140, 536696008, 7000916432, 931559965,
    6721274477, 5555957845, 2011307173, 648498388, 125847872,
    105090163, 1039810422, 414865875, 615691264, 239065625,
    5221834483, 376793317, 405014265, 533718665, 988987559,
    1436557153, 5472092917, 318525342, 5082586382, 234049631,
    294899989, 5279082969, 5289132670, 1774770032, 429651605,
    1317886930, 1194789766, 1135031217, 253770738, 386648014,
    2101350948, 1401902764, 847239845, 138613664, 8139117013,
    71859489, 339472623, 359858902, 1276790090, 473126870,
    15122270, 671523497, 419247865, 518625886, 487346545,
    6495676972, 5176703681, 5092116606, 7139058034, 641458447,
    577237, 908944271, 5904315995, 1481200184, 5611902022,
    71122881, 1503365380, 832510061, 5182260832, 933035909,
    1906213077, 275249787, 6489793171, 1001149617, 564679057,
    117146498, 74250336, 1287425555, 5373311582, 6075955656,
];

async function benchmarkJoin(userId: number) {
    await ch.query({
        query: `
            SELECT text, c.channel_name
            FROM default.messages m
                     LEFT JOIN default.channels c ON m.channel_id = c.id
            WHERE m.user_id = ${userId} AND length(text) > 10
                LIMIT 1000
        `,
        format: 'JSONEachRow',
    }).then(r => r.json());
}

async function benchmarkSplit(userId: number) {
    const messages = await ch.query({
        query: `
      SELECT channel_id, text
      FROM default.messages
      WHERE user_id = ${userId} AND length(text) > 10
      LIMIT 1000
    `,
        format: 'JSONEachRow',
    }).then(r => r.json()) as { channel_id: number; text: string }[];

    const channelIds = [...new Set(messages.map((m) => m.channel_id))];
    if (!channelIds.length) return;

    await ch.query({
        query: `
            SELECT id, channel_name
            FROM default.channels
            WHERE id IN (${channelIds.join(',')})
        `,
        format: 'JSONEachRow',
    }).then(r => r.json());
}

async function benchmarkBatchJoin(userIds: number[]) {
    const t1 = performance.now();
    await ch.query({
        query: `
            SELECT m.user_id, m.text, c.channel_name
            FROM default.messages m
                     LEFT JOIN default.channels c ON m.channel_id = c.id
            WHERE m.user_id IN (${userIds.join(',')}) AND length(text) > 10
        `,
        format: 'JSONEachRow',
    }).then(r => r.json());
    return +(performance.now() - t1).toFixed(1);
}

async function benchmarkBatchSplit(userIds: number[]) {
    const t1 = performance.now();
    const messages = await ch.query({
        query: `
            SELECT user_id, channel_id, text
            FROM default.messages
            WHERE user_id IN (${userIds.join(',')}) AND length(text) > 10
        `,
        format: 'JSONEachRow',
    }).then(r => r.json()) as { user_id: number; channel_id: number; text: string }[];

    const channelIds = [...new Set(messages.map(m => m.channel_id))];
    if (!channelIds.length) return +(performance.now() - t1).toFixed(1);

    await ch.query({
        query: `
            SELECT id, channel_name
            FROM default.channels
            WHERE id IN (${channelIds.join(',')})
        `,
        format: 'JSONEachRow',
    }).then(r => r.json());

    return +(performance.now() - t1).toFixed(1);
}

async function main() {
    console.log('📊 Benchmark 100 пользователей:\n');

    const batchJoinStart = performance.now();
    const batchJoin = await benchmarkBatchJoin(userIds);
    const batchJoinTotal = +(performance.now() - batchJoinStart).toFixed(1);

    console.log('batchJoin');
    console.log(batchJoin);

    const batchSplitStart = performance.now();
    const batchSplit = await benchmarkBatchSplit(userIds);
    const batchSplitTotal = +(performance.now() - batchSplitStart).toFixed(1);

    console.log('batchSplit');
    console.log(batchSplit);

    const parallelJoinStart = performance.now();
    const parallelJoin = await Promise.all(userIds.map(userId => benchmarkJoin(userId)));
    const parallelJoinTotal = +(performance.now() - parallelJoinStart).toFixed(1);

    console.log('parallelJoin');
    console.log(parallelJoin);

    const parallelSplitStart = performance.now();
    await Promise.all(userIds.map(userId => benchmarkSplit(userId)));
    const parallelSplitTotal = +(performance.now() - parallelSplitStart).toFixed(1);

    console.log('───────────────────────────────────');
    console.log(`👥 Пользователей: ${userIds.length}`);
    console.log(`⏳ BATCH JOIN (1 запрос):        ${batchJoinTotal} ms`);
    console.log(`⏳ BATCH SPLIT (2 запроса):      ${batchSplitTotal} ms`);
    console.log(`⚡ PARALLEL JOIN (100 x async):  ${parallelJoinTotal} ms`);
    console.log(`⚡ PARALLEL SPLIT (100 x async): ${parallelSplitTotal} ms`);
}

main().catch(err => {
    console.error('🔥 Ошибка:', err);
    process.exit(1);
});
