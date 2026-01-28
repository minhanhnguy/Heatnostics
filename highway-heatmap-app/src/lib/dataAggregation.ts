import Papa from 'papaparse';
import { routePublic } from '@/config';

export interface AggregatedRow {
  COUNTY?: string;
  RESPONSIBLE_DISTRICT?: string;
  TX_SIGNED_HIGHWAY_RDBD_ID: string;
  TX_LENGTH_TOTAL: number;
  SEGMENT_COUNT: number;
  TX_CONDITION_SCORE: number;
  TX_DISTRESS_SCORE: number;
  TX_RIDE_SCORE: number;
  TX_AADT_CURRENT: number;
  TX_MAINTENANCE_COST_AMT: number;
}

interface RawRow {
  EFF_YEAR?: string | number;
  RESPONSIBLE_DISTRICT?: string;
  TX_SIGNED_HIGHWAY_RDBD_ID?: string;
  COUNTY?: string;
  TX_LENGTH?: string | number;
  TX_CONDITION_SCORE?: string | number;
  TX_DISTRESS_SCORE?: string | number;
  TX_RIDE_SCORE?: string | number;
  TX_AADT_CURRENT?: string | number;
  TX_MAINTENANCE_COST_AMT?: string | number;
  [key: string]: unknown;
}

/**
 * Loads PMIS_combined.csv (pre-combined from PMIS_2024_trimmed.csv and Concrete_distresses.csv),
 * then aggregates by Highway + County or Highway + District.
 */
export async function aggregateHighwayData(
  viewType: 'county' | 'district'
): Promise<AggregatedRow[]> {
  // Load the combined CSV file
  const allData = await loadCSV(`${routePublic}/files/PMIS_combined.csv`);

  // Aggregate by Highway + Location
  const aggregated = aggregateByLocation(allData, viewType);

  return aggregated;
}

function loadCSV(url: string): Promise<RawRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve(results.data as RawRow[]);
      },
      error: (error: Error) => {
        reject(error);
      },
    });
  });
}

function aggregateByLocation(
  data: RawRow[],
  viewType: 'county' | 'district'
): AggregatedRow[] {
  const groups = new Map<string, RawRow[]>();

  // Group rows by Highway + Location
  for (const row of data) {
    const highway = row.TX_SIGNED_HIGHWAY_RDBD_ID;
    if (!highway) continue;

    const location = viewType === 'district'
      ? row.RESPONSIBLE_DISTRICT
      : row.COUNTY;
    if (!location) continue;

    const key = `${highway}|${location}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(row);
  }

  // Compute averages for each group
  const results: AggregatedRow[] = [];

  for (const [key, rows] of groups) {
    const [highway, location] = key.split('|');

    let totalLength = 0;
    let conditionSum = 0, conditionCount = 0;
    let distressSum = 0, distressCount = 0;
    let rideSum = 0, rideCount = 0;
    let aadtSum = 0, aadtCount = 0;
    let costSum = 0, costCount = 0;

    for (const row of rows) {
      const length = toNumber(row.TX_LENGTH);
      if (length > 0) totalLength += length;

      const condition = toNumber(row.TX_CONDITION_SCORE);
      if (condition > 0) { conditionSum += condition; conditionCount++; }

      const distress = toNumber(row.TX_DISTRESS_SCORE);
      if (distress > 0) { distressSum += distress; distressCount++; }

      const ride = toNumber(row.TX_RIDE_SCORE);
      if (ride > 0) { rideSum += ride; rideCount++; }

      const aadt = toNumber(row.TX_AADT_CURRENT);
      if (aadt > 0) { aadtSum += aadt; aadtCount++; }

      const cost = toNumber(row.TX_MAINTENANCE_COST_AMT);
      if (cost > 0) { costSum += cost; costCount++; }
    }

    const aggregatedRow: AggregatedRow = {
      TX_SIGNED_HIGHWAY_RDBD_ID: highway,
      TX_LENGTH_TOTAL: round(totalLength, 2),
      SEGMENT_COUNT: rows.length,
      TX_CONDITION_SCORE: conditionCount > 0 ? round(conditionSum / conditionCount, 2) : 0,
      TX_DISTRESS_SCORE: distressCount > 0 ? round(distressSum / distressCount, 2) : 0,
      TX_RIDE_SCORE: rideCount > 0 ? round(rideSum / rideCount, 2) : 0,
      TX_AADT_CURRENT: aadtCount > 0 ? round(aadtSum / aadtCount, 2) : 0,
      TX_MAINTENANCE_COST_AMT: costCount > 0 ? round(costSum / costCount, 2) : 0,
    };

    if (viewType === 'district') {
      aggregatedRow.RESPONSIBLE_DISTRICT = location;
    } else {
      aggregatedRow.COUNTY = location;
    }

    results.push(aggregatedRow);
  }

  return results;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
