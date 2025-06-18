export function calculatePrice(members: number = 0): number {
    const base = Number(process.env.PRICE_BASE ?? 20);
    const multiplier = Number(process.env.PRICE_MULTIPLIER ?? 10);
    return Math.round(base + Math.log10(members + 1) * multiplier);
}
