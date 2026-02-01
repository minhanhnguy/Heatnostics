/**
 * Blobs Module - Watershed segmentation for clumpy detection
 */
import type { FloatGrid, BinaryGrid, Point, Blob } from '../types'

function findLocalMaxima(grid: FloatGrid, minHeight: number = 0.1): Point[] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const maxima: Point[] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            const val = grid[y][x]
            if (val < minHeight) continue

            let isMax = true
            for (let dy = -1; dy <= 1 && isMax; dy++) {
                for (let dx = -1; dx <= 1 && isMax; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (grid[y + dy][x + dx] > val) isMax = false
                }
            }

            if (isMax) maxima.push({ x, y })
        }
    }
    return maxima
}

export function watershedBlobSegmentation(grid: FloatGrid, mask: BinaryGrid, minBlobSize: number = 10): Blob[] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const blobs: Blob[] = []

    const maxima = findLocalMaxima(grid, 0.1)
    if (maxima.length === 0) return blobs

    const labels: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-1))

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y][x] === 0) labels[y][x] = 0
        }
    }

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y][x] === 0) continue

            let cx = x, cy = y
            const path: Point[] = [{ x: cx, y: cy }]
            const maxSteps = rows + cols

            for (let step = 0; step < maxSteps; step++) {
                let maxVal = grid[cy][cx]
                let nx = cx, ny = cy

                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dy === 0 && dx === 0) continue
                        const px = cx + dx, py = cy + dy
                        if (px >= 0 && px < cols && py >= 0 && py < rows &&
                            mask[py][px] === 1 && grid[py][px] > maxVal) {
                            maxVal = grid[py][px]
                            nx = px
                            ny = py
                        }
                    }
                }

                if (nx === cx && ny === cy) break
                cx = nx
                cy = ny
                path.push({ x: cx, y: cy })
            }

            const maxIdx = maxima.findIndex(m => m.x === cx && m.y === cy)
            const label = maxIdx >= 0 ? maxIdx + 1 : 0

            for (const p of path) {
                if (labels[p.y][p.x] === -1) labels[p.y][p.x] = label
            }
        }
    }

    const blobMap = new Map<number, Point[]>()
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const label = labels[y][x]
            if (label > 0) {
                if (!blobMap.has(label)) blobMap.set(label, [])
                blobMap.get(label)!.push({ x, y })
            }
        }
    }

    for (const [, pixels] of blobMap) {
        if (pixels.length < minBlobSize) continue
        let sumX = 0, sumY = 0, peakVal = 0
        for (const p of pixels) {
            sumX += p.x
            sumY += p.y
            peakVal = Math.max(peakVal, grid[p.y][p.x])
        }
        blobs.push({
            pixels,
            area: pixels.length,
            centroid: { x: sumX / pixels.length, y: sumY / pixels.length },
            peakValue: peakVal
        })
    }

    return blobs
}

export function computeClumpyFromBlobs(blobs: Blob[], totalArea: number): number {
    const B = blobs.length
    if (B <= 1 || totalArea === 0) return 0

    const areas = blobs.map(b => b.area)
    const meanArea = areas.reduce((s, a) => s + a, 0) / B
    const variance = areas.reduce((s, a) => s + (a - meanArea) ** 2, 0) / B

    const raw = (B * variance) / (totalArea * totalArea)
    return Math.min(1, Math.sqrt(raw) * 10)
}

export function countHoles(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    if (rows === 0 || cols === 0) return 0

    const visited = Array.from({ length: rows }, () => Array(cols).fill(false))
    let backgroundComponents = 0

    const floodFill = (startY: number, startX: number) => {
        const queue: [number, number][] = [[startY, startX]]
        while (queue.length > 0) {
            const [y, x] = queue.shift()!
            if (y < 0 || y >= rows || x < 0 || x >= cols) continue
            if (visited[y][x] || grid[y][x] === 1) continue
            visited[y][x] = true
            queue.push([y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1])
        }
    }

    for (let x = 0; x < cols; x++) { if (!visited[0][x] && grid[0][x] === 0) { floodFill(0, x); backgroundComponents++ } }
    for (let x = 0; x < cols; x++) { if (!visited[rows - 1][x] && grid[rows - 1][x] === 0) { floodFill(rows - 1, x); backgroundComponents++ } }
    for (let y = 0; y < rows; y++) { if (!visited[y][0] && grid[y][0] === 0) { floodFill(y, 0); backgroundComponents++ } }
    for (let y = 0; y < rows; y++) { if (!visited[y][cols - 1] && grid[y][cols - 1] === 0) { floodFill(y, cols - 1); backgroundComponents++ } }

    let holes = 0
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (!visited[y][x] && grid[y][x] === 0) { floodFill(y, x); holes++ }
        }
    }
    return holes
}

export function countConnectedComponents(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    if (rows === 0 || cols === 0) return 0

    const visited = Array.from({ length: rows }, () => Array(cols).fill(false))
    let components = 0

    const floodFill = (startY: number, startX: number) => {
        const stack: [number, number][] = [[startY, startX]]
        while (stack.length > 0) {
            const [y, x] = stack.pop()!
            if (y < 0 || y >= rows || x < 0 || x >= cols) continue
            if (visited[y][x] || grid[y][x] === 0) continue
            visited[y][x] = true
            stack.push([y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1])
            stack.push([y - 1, x - 1], [y - 1, x + 1], [y + 1, x - 1], [y + 1, x + 1])
        }
    }

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (!visited[y][x] && grid[y][x] === 1) { floodFill(y, x); components++ }
        }
    }
    return components
}

export function countFilledCells(grid: BinaryGrid): number {
    let count = 0
    for (const row of grid) {
        for (const cell of row) {
            if (cell === 1) count++
        }
    }
    return count
}
