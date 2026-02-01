/**
 * Distance Transform Module - Euclidean distance transform
 */
import type { BinaryGrid, FloatGrid } from '../types'

/**
 * Euclidean Distance Transform (2-pass algorithm)
 */
export function euclideanDistanceTransform(grid: BinaryGrid): FloatGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const INF = rows + cols

    // Initialize: 0 for background, INF for foreground
    const dt: number[][] = Array.from({ length: rows }, (_, y) =>
        Array.from({ length: cols }, (_, x) => grid[y][x] === 1 ? INF * INF : 0)
    )

    // Pass 1: top-left to bottom-right
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (dt[y][x] === 0) continue
            const top = y > 0 ? dt[y - 1][x] + 1 : INF * INF
            const left = x > 0 ? dt[y][x - 1] + 1 : INF * INF
            dt[y][x] = Math.min(dt[y][x], top, left)
        }
    }

    // Pass 2: bottom-right to top-left
    for (let y = rows - 1; y >= 0; y--) {
        for (let x = cols - 1; x >= 0; x--) {
            if (dt[y][x] === 0) continue
            const bottom = y < rows - 1 ? dt[y + 1][x] + 1 : INF * INF
            const right = x < cols - 1 ? dt[y][x + 1] + 1 : INF * INF
            dt[y][x] = Math.min(dt[y][x], bottom, right)
        }
    }

    return dt.map(row => row.map(v => Math.sqrt(v)))
}
