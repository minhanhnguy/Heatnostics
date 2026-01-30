import { type FloatGrid, type BinaryGrid } from "./types"

/**
 * Convert point cloud to a float grid (density representation)
 * Uses kernel density estimation with Gaussian kernel
 */
export function pointsToFloatGrid(
    points: [number, number][],
    gridSize: number,
    sigma: number = 3.0
): FloatGrid {
    const grid: FloatGrid = Array.from({ length: gridSize }, () =>
        Array(gridSize).fill(0)
    )

    // For each point, add Gaussian contribution to nearby cells
    const radius = Math.ceil(sigma * 3) // 3-sigma rule

    for (const [px, py] of points) {
        const centerX = Math.floor(px)
        const centerY = Math.floor(py)

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = centerX + dx
                const y = centerY + dy

                if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
                    const dist2 = dx * dx + dy * dy
                    const weight = Math.exp(-dist2 / (2 * sigma * sigma))
                    grid[y][x] += weight
                }
            }
        }
    }

    // Normalize to [0, 1]
    let maxVal = 0
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            maxVal = Math.max(maxVal, grid[y][x])
        }
    }

    if (maxVal > 0) {
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                grid[y][x] /= maxVal
            }
        }
    }

    return grid
}

/**
 * Convert point cloud to binary grid (simple rasterization)
 */
export function pointsToBinaryGrid(
    points: [number, number][],
    gridSize: number
): BinaryGrid {
    const grid: BinaryGrid = Array.from({ length: gridSize }, () =>
        Array(gridSize).fill(0)
    )

    for (const [px, py] of points) {
        const x = Math.floor(px)
        const y = Math.floor(py)
        if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
            grid[y][x] = 1
        }
    }

    return grid
}
