/**
 * Smoothing Module - Gaussian blur for anti-aliasing
 */
import type { FloatGrid } from '../types'

/**
 * Generate 1D Gaussian kernel
 */
function generateGaussianKernel(sigma: number): number[] {
    const radius = Math.ceil(sigma * 3)
    const size = radius * 2 + 1
    const kernel: number[] = []
    let sum = 0

    for (let i = 0; i < size; i++) {
        const x = i - radius
        const value = Math.exp(-(x * x) / (2 * sigma * sigma))
        kernel.push(value)
        sum += value
    }

    return kernel.map(v => v / sum)
}

/**
 * Apply separable Gaussian blur to float grid
 * Uses separate horizontal and vertical passes for efficiency
 */
export function gaussianBlur(grid: FloatGrid, sigma: number = 1.0): FloatGrid {
    if (sigma <= 0) return grid.map(row => [...row])

    const rows = grid.length
    const cols = grid[0]?.length || 0
    const kernel = generateGaussianKernel(sigma)
    const radius = Math.floor(kernel.length / 2)

    // Horizontal pass
    const temp: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let sum = 0
            let weightSum = 0
            for (let k = -radius; k <= radius; k++) {
                const sx = x + k
                if (sx >= 0 && sx < cols) {
                    const weight = kernel[k + radius]
                    sum += grid[y][sx] * weight
                    weightSum += weight
                }
            }
            temp[y][x] = weightSum > 0 ? sum / weightSum : 0
        }
    }

    // Vertical pass
    const result: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let sum = 0
            let weightSum = 0
            for (let k = -radius; k <= radius; k++) {
                const sy = y + k
                if (sy >= 0 && sy < rows) {
                    const weight = kernel[k + radius]
                    sum += temp[sy][x] * weight
                    weightSum += weight
                }
            }
            result[y][x] = weightSum > 0 ? sum / weightSum : 0
        }
    }

    return result
}
