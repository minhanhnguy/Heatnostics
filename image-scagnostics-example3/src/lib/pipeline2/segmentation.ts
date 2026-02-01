/**
 * Segmentation Module - Threshold-based binary segmentation
 */
import type { FloatGrid, BinaryGrid } from '../types'

/**
 * Calculate percentile value from grid
 */
export function getPercentileValue(grid: FloatGrid, percentile: number): number {
    const values: number[] = []
    for (const row of grid) {
        for (const val of row) {
            if (val > 0) values.push(val)
        }
    }

    if (values.length === 0) return 0

    values.sort((a, b) => a - b)
    const index = Math.floor((percentile / 100) * (values.length - 1))
    return values[index]
}

/**
 * Segment grid by threshold (value-based)
 */
function segmentByThreshold(grid: FloatGrid, threshold: number): BinaryGrid {
    return grid.map(row => row.map(val => val >= threshold ? 1 : 0))
}

/**
 * Multi-threshold segmentation (emulates alpha-shape family)
 * Returns binary masks at multiple percentile thresholds
 */
export function multiThresholdSegmentation(
    grid: FloatGrid,
    percentiles: number[] = [60, 65, 70, 75, 80, 85, 90, 95]
): { percentile: number; threshold: number; binary: BinaryGrid }[] {
    return percentiles.map(p => {
        const threshold = getPercentileValue(grid, p)
        return {
            percentile: p,
            threshold,
            binary: segmentByThreshold(grid, threshold)
        }
    })
}
