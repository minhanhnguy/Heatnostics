// ───────────────── Types ─────────────────
export type MetricKey = "condition" | "distress" | "ride" | "aadt" | "cost";

export interface FeatureLike {
    type?: string;
    properties: Record<string, unknown>;
    geometry?: unknown;
}

export interface BuildOptions {
    /** Which metric the user wants to rank by (Condition, Distress, Ride, AADT, Cost) */
    metric: MetricKey;
    /** Get all raw segment records for a Highway|Location row (for per-span / per-year calculations) */
    getSegmentsForPair: (highway: string, location: string) => any[];
}

export interface RankingMechanism {
    id: string;
    label: string;
    /** Short, human-friendly descriptor for tooltips/menus */
    shortLabel?: string;
    /** Return score for a given row feature (higher ranks first in UI) */
    score: (row: FeatureLike) => number;
    /** Optional: How to display score units */
    units?: string;
}

export interface BuildResult {
    mechanisms: RankingMechanism[];
    errors: string[];
}

// ─────────────── Helpers ────────────────

/** Map metric key → dataset field */
const metricFieldMap: Record<MetricKey, string> = {
    condition: "TX_CONDITION_SCORE",
    distress: "TX_DISTRESS_SCORE",
    ride: "TX_RIDE_SCORE",
    aadt: "TX_AADT_CURRENT",
    cost: "TX_MAINTENANCE_COST_AMT",
};

/** Labels you can import for headers */
export const metricLabelMap: Record<MetricKey, string> = {
    condition: "Condition",
    distress: "Distress",
    ride: "Ride",
    aadt: "AADT",
    cost: "Cost",
};

function toNumber(v: unknown): number | null {
    const n = typeof v === "string" ? Number(v) : (v as number);
    return Number.isFinite(n) ? n : null;
}

function cleanAndRound(value: any): number {
    if (value === null || typeof value === "undefined") return 0.0;
    const cleaned = String(value).replace(/[^0-9.]/g, "");
    if (cleaned === "") return 0.0;
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0.0;
    return Number(num.toFixed(3));
}

function beginFull(seg: any): number | null {
    const bfd = toNumber(seg?.properties?.TX_BEG_FULL_DIST);
    if (bfd != null) return bfd;
    const bm = cleanAndRound(seg?.properties?.TX_BEG_REF_MARKER_NBR);
    const bd = cleanAndRound(seg?.properties?.TX_BEG_REF_MRKR_DISP);
    return bm + bd;
}

function endFull(seg: any): number | null {
    const efd = toNumber(seg?.properties?.TX_END_FULL_DIST);
    if (efd != null) return efd;
    const len = cleanAndRound(seg?.properties?.TX_LENGTH);
    const b = beginFull(seg);
    if (b == null) return null;
    return b + len;
}

function spanLen(seg: any, beg: number, end: number): number {
    // Prefer provided length if sane; else compute from beg/end
    const l = toNumber(seg?.properties?.TX_LENGTH);
    const computed = end - beg;
    const length = (l != null && l > 0 ? l : computed);
    return Number.isFinite(length) && length > 0 ? length : 0;
}

/** Key spans with 3-decimal precision to avoid float jitter */
function spanKey(beg: number, end: number): string {
    return `${beg.toFixed(3)}-${end.toFixed(3)}`;
}

/** Group a segment list by exact span [begin,end) and ignore GAP_BRIDGE; carry length */
function groupBySpan(segments: any[]): Map<string, { beg: number; end: number; len: number; seg: any }[]> {
    const bySpan = new Map<string, { beg: number; end: number; len: number; seg: any }[]>();
    for (const s of segments || []) {
        if (s?.properties?.IS_GAP_BRIDGE) continue;
        const beg = beginFull(s);
        const end = endFull(s);
        if (beg == null || end == null) continue;
        if (!(end > beg)) continue;

        const key = spanKey(beg, end);
        const len = spanLen(s, beg, end);
        if (len <= 0) continue;

        if (!bySpan.has(key)) bySpan.set(key, []);
        bySpan.get(key)!.push({ beg, end, len, seg: s });
    }
    return bySpan;
}

/**
 * Build a year->value map for a field within a span group.
 * - For performance-like metrics: average duplicates within the same year.
 * - For cost: sum duplicates within the same year.
 */
function yearAggForField(
    items: { seg: any }[],
    field: string,
    mode: "avg" | "sum" = "avg"
): Map<number, number> {
    const acc = new Map<number, { s: number; c: number }>();
    for (const it of items) {
        const y = toNumber(it.seg?.properties?.EFF_YEAR);
        if (y == null) continue;
        const raw = toNumber((it.seg?.properties as any)?.[field]);
        if (raw == null) continue;
        if (!acc.has(y)) acc.set(y, { s: 0, c: 0 });
        const e = acc.get(y)!;
        e.s += raw;
        e.c += 1;
    }
    const out = new Map<number, number>();
    for (const [y, { s, c }] of acc) {
        out.set(y, mode === "sum" ? s : s / Math.max(1, c));
    }
    return out;
}

// ───────────── Core mechanism builders (per-span, length-weighted) ─────────────

/** Absolute sum of year-over-year differences, per span, weighted by span length */
function makeSumOfDifferences(
    metric: MetricKey,
    getSegmentsForPair: BuildOptions["getSegmentsForPair"]
): RankingMechanism {
    const field = metricFieldMap[metric];
    return {
        id: "sum-of-differences",
        label: "Absolute sum of differences",
        shortLabel: "Abs sum of diffs",
        score: (row) => {
            const hwy = String(row.properties._ID_HWY ?? "");
            const loc = String(row.properties._ID_LOC ?? "");
            const segs = getSegmentsForPair(hwy, loc);
            if (!segs?.length) return -Infinity;

            const bySpan = groupBySpan(segs);
            let total = 0;

            bySpan.forEach((list) => {
                const len = list[0].len;
                const byYear = yearAggForField(list, field, "avg");
                const years = [...byYear.keys()].sort((a, b) => a - b);
                if (years.length < 2) return;

                let sumAbs = 0;
                for (let i = 1; i < years.length; i++) {
                    const prev = byYear.get(years[i - 1])!;
                    const cur = byYear.get(years[i])!;
                    sumAbs += Math.abs(cur - prev);
                }
                total += len * sumAbs;
            });

            return total;
        },
    };
}

/** Net change (latest − earliest) per span, weighted by span length, then summed */
function makeImprovementOverTime(
    metric: MetricKey,
    getSegmentsForPair: BuildOptions["getSegmentsForPair"]
): RankingMechanism {
    const field = metricFieldMap[metric];
    return {
        id: "improvement-over-time",
        label: "Net change",
        shortLabel: "Net change",
        score: (row) => {
            const hwy = String(row.properties._ID_HWY ?? "");
            const loc = String(row.properties._ID_LOC ?? "");
            const segs = getSegmentsForPair(hwy, loc);
            if (!segs?.length) return -Infinity;

            const bySpan = groupBySpan(segs);
            let total = 0;

            bySpan.forEach((list) => {
                const len = list[0].len;
                const byYear = yearAggForField(list, field, "avg");
                const years = [...byYear.keys()].sort((a, b) => a - b);
                if (years.length < 2) return;

                const earliest = byYear.get(years[0])!;
                const latest = byYear.get(years[years.length - 1])!;
                total += len * (latest - earliest);
            });

            return total;
        },
    };
}

/**
 * Improvement per Cost (per span) = ( L_span · (latest − earliest) ) / (sum of costs over the window)
 * Skip span if improvement not computable (need >=2 years) or cost_sum <= 0. Sum ratios across spans.
 */
function makeImprovementPerCost(
    metric: MetricKey,
    getSegmentsForPair: BuildOptions["getSegmentsForPair"]
): RankingMechanism {
    const perfField = metricFieldMap[metric];
    const costField = metricFieldMap["cost"]; // TX_MAINTENANCE_COST_AMT

    return {
        id: "improvement-per-cost",
        label: "Improvement per Cost",
        shortLabel: "Improvement/$",
        units: `${metricLabelMap[metric]} per $`,
        score: (row) => {
            // Guard: “improvement” is undefined for these metrics
            if (metric === "cost" || metric === "aadt") return -Infinity;

            const hwy = String(row.properties._ID_HWY ?? "");
            const loc = String(row.properties._ID_LOC ?? "");
            const segs = getSegmentsForPair(hwy, loc);
            if (!segs?.length) return -Infinity;

            const bySpan = groupBySpan(segs);
            let total = 0;

            bySpan.forEach((list) => {
                const len = list[0].len;

                const perfByYear = yearAggForField(list, perfField, "avg");
                const years = [...perfByYear.keys()].sort((a, b) => a - b);
                if (years.length < 2) return;

                const y0 = years[0];
                const yN = years[years.length - 1];
                const earliest = perfByYear.get(y0)!;
                const latest = perfByYear.get(yN)!;
                const benefit = len * (latest - earliest);

                // Sum cost across the same window [y0..yN]
                const costByYear = yearAggForField(list, costField, "sum");
                let costSum = 0;
                for (const y of costByYear.keys()) {
                    if (y < y0 || y > yN) continue;
                    const c = costByYear.get(y);
                    if (c != null && Number.isFinite(c)) costSum += c;
                }
                if (!(costSum > 0)) return; // skip if no/invalid cost

                total += (benefit / costSum);
            });

            return Number.isFinite(total) ? total : -Infinity;
        },
    };
}

/**
 * Condition × AADT Exposure (per span, latest available in each stream):
 * contribution = L_span · deficiency · ln(1 + AADT_latest)
 * where deficiency = max(0, 100 − latest_condition).
 */
function makeConditionAadtExposure(
    _metric: MetricKey,
    getSegmentsForPair: BuildOptions["getSegmentsForPair"]
): RankingMechanism {
    const condField = metricFieldMap["condition"]; // TX_CONDITION_SCORE
    const aadtField = metricFieldMap["aadt"];      // TX_AADT_CURRENT

    return {
        id: "condition-aadt-exposure",
        label: "Condition × AADT Exposure",
        shortLabel: "Cond×AADT",
        units: "deficiency × log(1+AADT) × miles",
        score: (row) => {
            const hwy = String(row.properties._ID_HWY ?? "");
            const loc = String(row.properties._ID_LOC ?? "");
            const segs = getSegmentsForPair(hwy, loc);
            if (!segs?.length) return -Infinity;

            const bySpan = groupBySpan(segs);
            let total = 0;

            bySpan.forEach((list) => {
                const len = list[0].len;

                const condByYear = yearAggForField(list, condField, "avg");
                const aadtByYear = yearAggForField(list, aadtField, "avg");
                if (condByYear.size === 0 || aadtByYear.size === 0) return;

                // latest condition (by its own latest year)
                const condYears = [...condByYear.keys()];
                const latestCondYear = Math.max(...condYears);
                const latestCond = condByYear.get(latestCondYear);
                if (latestCond == null || !Number.isFinite(latestCond)) return;

                // latest AADT (by its own latest year)
                const aadtYears = [...aadtByYear.keys()];
                const latestAadtYear = Math.max(...aadtYears);
                const latestAadt = aadtByYear.get(latestAadtYear) ?? 0;

                const deficiency = Math.max(0, Math.min(100, 100 - latestCond));
                const weight = Math.log1p(Math.max(0, latestAadt));
                const contrib = len * deficiency * weight;

                if (Number.isFinite(contrib)) total += contrib;
            });

            return Number.isFinite(total) ? total : -Infinity;
        },
    };
}

// ─────────────── Build (export) ───────────────
export function buildMechanisms(_rows: FeatureLike[], opts: BuildOptions): BuildResult {
    const errors: string[] = [];
    if (!opts?.getSegmentsForPair) errors.push("getSegmentsForPair callback is required.");

    const m = opts.metric;

    const mechanisms: RankingMechanism[] = [
        makeSumOfDifferences(m, opts.getSegmentsForPair),     // Absolute sum of year-to-year differences (per span, length-weighted)
        makeImprovementOverTime(m, opts.getSegmentsForPair),  // Net change (per span, length-weighted)
        makeImprovementPerCost(m, opts.getSegmentsForPair),   // Improvement per $ (per span, length-weighted)
        makeConditionAadtExposure(m, opts.getSegmentsForPair) // Cond×AADT (latest per stream, per span, length-weighted)
    ];

    return { mechanisms, errors };
}
