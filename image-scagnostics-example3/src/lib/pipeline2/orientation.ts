/**
 * Orientation Module - Structure tensor and striated detection
 */
import type { FloatGrid, BinaryGrid } from '../types'

/**
 * Compute structure tensor and coherence for striated detection
 */
export function computeStructureTensor(grid: FloatGrid, windowSize: number = 5): {
    coherence: FloatGrid
    orientation: FloatGrid
    meanCoherence: number
} {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const coherence: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const orientation: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    const Ix: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const Iy: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            Ix[y][x] = (grid[y][x + 1] - grid[y][x - 1]) / 2
            Iy[y][x] = (grid[y + 1][x] - grid[y - 1][x]) / 2
        }
    }

    const half = Math.floor(windowSize / 2)
    let totalCoherence = 0
    let count = 0

    for (let y = half; y < rows - half; y++) {
        for (let x = half; x < cols - half; x++) {
            let Jxx = 0, Jyy = 0, Jxy = 0

            for (let wy = -half; wy <= half; wy++) {
                for (let wx = -half; wx <= half; wx++) {
                    const ix = Ix[y + wy][x + wx]
                    const iy = Iy[y + wy][x + wx]
                    Jxx += ix * ix
                    Jyy += iy * iy
                    Jxy += ix * iy
                }
            }

            const trace = Jxx + Jyy
            const det = Jxx * Jyy - Jxy * Jxy
            const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det))
            const lambda1 = trace / 2 + discriminant
            const lambda2 = trace / 2 - discriminant

            const coh = (lambda1 + lambda2 > 0.001) ? (lambda1 - lambda2) / (lambda1 + lambda2) : 0
            coherence[y][x] = coh
            totalCoherence += coh
            count++

            orientation[y][x] = Math.atan2(2 * Jxy, Jxx - Jyy) / 2
        }
    }

    return { coherence, orientation, meanCoherence: count > 0 ? totalCoherence / count : 0 }
}

/**
 * Compute circular variance of orientation angles within mask
 */
export function computeCircularVariance(orientation: FloatGrid, mask: BinaryGrid): number {
    const rows = orientation.length
    const cols = orientation[0]?.length || 0
    let sumCos = 0, sumSin = 0, count = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y]?.[x] !== 1) continue
            const theta = orientation[y][x]
            sumCos += Math.cos(2 * theta)
            sumSin += Math.sin(2 * theta)
            count++
        }
    }

    if (count === 0) return 1
    const R = Math.sqrt(sumCos * sumCos + sumSin * sumSin) / count
    return 1 - R
}
