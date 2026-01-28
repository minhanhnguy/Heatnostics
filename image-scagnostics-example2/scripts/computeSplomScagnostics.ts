/**
 * Compute Image Scagnostics for SPLOM (Scatterplot Matrix) Data
 *
 * This script reads the normalized YearPredictionMSD data and computes
 * image-theoretic scagnostics for each column pair.
 *
 * Usage: npx tsx scripts/computeSplomScagnostics.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// Import image processing functions (these work in Node.js)
type BinaryGrid = number[][]

// ============================================================
// Image Processing Functions (copied from imageProcessing.ts)
// ============================================================

function createDiskElement(radius: number): boolean[][] {
    const size = radius * 2 + 1
    const element: boolean[][] = []
    for (let y = 0; y < size; y++) {
        element[y] = []
        for (let x = 0; x < size; x++) {
            const dx = x - radius
            const dy = y - radius
            element[y][x] = dx * dx + dy * dy <= radius * radius
        }
    }
    return element
}

function dilate(grid: BinaryGrid, radius: number): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const result: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const element = createDiskElement(radius)
    const elemSize = radius * 2 + 1

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                for (let ey = 0; ey < elemSize; ey++) {
                    for (let ex = 0; ex < elemSize; ex++) {
                        if (element[ey][ex]) {
                            const ny = y + ey - radius
                            const nx = x + ex - radius
                            if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                                result[ny][nx] = 1
                            }
                        }
                    }
                }
            }
        }
    }
    return result
}

function erode(grid: BinaryGrid, radius: number): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const result: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const element = createDiskElement(radius)
    const elemSize = radius * 2 + 1

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let allSet = true
            for (let ey = 0; ey < elemSize && allSet; ey++) {
                for (let ex = 0; ex < elemSize && allSet; ex++) {
                    if (element[ey][ex]) {
                        const ny = y + ey - radius
                        const nx = x + ex - radius
                        if (ny < 0 || ny >= rows || nx < 0 || nx >= cols || grid[ny][nx] !== 1) {
                            allSet = false
                        }
                    }
                }
            }
            result[y][x] = allSet ? 1 : 0
        }
    }
    return result
}

function morphologicalClosing(grid: BinaryGrid, radius: number = 3): BinaryGrid {
    const dilated = dilate(grid, radius)
    return erode(dilated, radius)
}

function findBoundaryPixels(grid: BinaryGrid): [number, number][] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const boundary: [number, number][] = []

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                const hasBackgroundNeighbor =
                    (y === 0 || grid[y - 1][x] === 0) ||
                    (y === rows - 1 || grid[y + 1][x] === 0) ||
                    (x === 0 || grid[y][x - 1] === 0) ||
                    (x === cols - 1 || grid[y][x + 1] === 0)

                if (hasBackgroundNeighbor) {
                    boundary.push([x, y])
                }
            }
        }
    }
    return boundary
}

function grahamScan(points: [number, number][]): [number, number][] {
    if (points.length < 3) return points

    let minIdx = 0
    for (let i = 1; i < points.length; i++) {
        if (points[i][1] < points[minIdx][1] ||
            (points[i][1] === points[minIdx][1] && points[i][0] < points[minIdx][0])) {
            minIdx = i
        }
    }
    const pivot = points[minIdx]

    const sorted = points
        .filter((_, i) => i !== minIdx)
        .map(p => ({
            point: p,
            angle: Math.atan2(p[1] - pivot[1], p[0] - pivot[0])
        }))
        .sort((a, b) => a.angle - b.angle)
        .map(p => p.point)

    const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    const hull: [number, number][] = [pivot]
    for (const p of sorted) {
        while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
            hull.pop()
        }
        hull.push(p)
    }

    return hull
}

function isPointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
    let inside = false
    const n = polygon.length
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = polygon[i]
        const [xj, yj] = polygon[j]
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside
        }
    }
    return inside
}

function contourConvexHull(grid: BinaryGrid): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const result: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    const boundary = findBoundaryPixels(grid)
    if (boundary.length < 3) {
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                result[y][x] = grid[y][x]
            }
        }
        return result
    }

    const hull = grahamScan(boundary)

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (isPointInPolygon(x, y, hull)) {
                result[y][x] = 1
            }
        }
    }

    return result
}

function euclideanDistanceTransform(grid: BinaryGrid): number[][] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const INF = rows + cols

    const dt: number[][] = Array.from({ length: rows }, (_, y) =>
        Array.from({ length: cols }, (_, x) => grid[y][x] === 1 ? INF * INF : 0)
    )

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (dt[y][x] === 0) continue
            const fromTop = y > 0 ? dt[y - 1][x] + 1 : INF * INF
            const fromLeft = x > 0 ? dt[y][x - 1] + 1 : INF * INF
            const fromTopLeft = (y > 0 && x > 0) ? dt[y - 1][x - 1] + 2 : INF * INF
            dt[y][x] = Math.min(dt[y][x], fromTop, fromLeft, fromTopLeft)
        }
    }

    for (let y = rows - 1; y >= 0; y--) {
        for (let x = cols - 1; x >= 0; x--) {
            if (dt[y][x] === 0) continue
            const fromBottom = y < rows - 1 ? dt[y + 1][x] + 1 : INF * INF
            const fromRight = x < cols - 1 ? dt[y][x + 1] + 1 : INF * INF
            const fromBottomRight = (y < rows - 1 && x < cols - 1) ? dt[y + 1][x + 1] + 2 : INF * INF
            dt[y][x] = Math.min(dt[y][x], fromBottom, fromRight, fromBottomRight)
        }
    }

    return dt
}

function findRidgePixels(dt: number[][], grid: BinaryGrid): BinaryGrid {
    const rows = dt.length
    const cols = dt[0]?.length || 0
    const ridges: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (grid[y][x] !== 1) continue
            const val = dt[y][x]
            if (val <= 0) continue

            let isRidge = true
            let strictlyGreater = false

            for (let dy = -1; dy <= 1 && isRidge; dy++) {
                for (let dx = -1; dx <= 1 && isRidge; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const neighborVal = dt[y + dy][x + dx]
                    if (neighborVal > val) isRidge = false
                    if (neighborVal < val) strictlyGreater = true
                }
            }

            if (isRidge && (strictlyGreater || val <= 2)) {
                ridges[y][x] = 1
            }
        }
    }

    return ridges
}

function findEndpoints(ridgeGrid: BinaryGrid): [number, number][] {
    const rows = ridgeGrid.length
    const cols = ridgeGrid[0]?.length || 0
    const endpoints: [number, number][] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (ridgeGrid[y][x] !== 1) continue
            let neighborCount = 0
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (ridgeGrid[y + dy][x + dx] === 1) neighborCount++
                }
            }
            if (neighborCount === 1) endpoints.push([y, x])
        }
    }
    return endpoints
}

function bfsRidgePath(ridgeGrid: BinaryGrid, startY: number, startX: number): number {
    const rows = ridgeGrid.length
    const cols = ridgeGrid[0]?.length || 0
    const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))

    const queue: [number, number, number][] = [[startY, startX, 0]]
    visited[startY][startX] = true
    let maxDist = 0

    while (queue.length > 0) {
        const [y, x, dist] = queue.shift()!
        maxDist = Math.max(maxDist, dist)

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols &&
                    !visited[ny][nx] && ridgeGrid[ny][nx] === 1) {
                    visited[ny][nx] = true
                    const stepDist = (dy !== 0 && dx !== 0) ? 1.414 : 1
                    queue.push([ny, nx, dist + stepDist])
                }
            }
        }
    }
    return maxDist
}

function findLongestRidgePath(ridgeGrid: BinaryGrid): number {
    const endpoints = findEndpoints(ridgeGrid)

    if (endpoints.length === 0) {
        const rows = ridgeGrid.length
        const cols = ridgeGrid[0]?.length || 0
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (ridgeGrid[y][x] === 1) {
                    return bfsRidgePath(ridgeGrid, y, x)
                }
            }
        }
        return 0
    }

    const MAX_ENDPOINTS = 20
    const sampledEndpoints = endpoints.length > MAX_ENDPOINTS
        ? endpoints.filter((_, i) => i % Math.ceil(endpoints.length / MAX_ENDPOINTS) === 0).slice(0, MAX_ENDPOINTS)
        : endpoints

    let maxDist = 0
    for (const [ey, ex] of sampledEndpoints) {
        maxDist = Math.max(maxDist, bfsRidgePath(ridgeGrid, ey, ex))
    }
    return maxDist
}

function countFilledPixels(grid: BinaryGrid): number {
    return grid.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0)
}

function computeContourLength(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    let perimeter = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                if (y === 0 || grid[y - 1][x] === 0) perimeter++
                if (y === rows - 1 || grid[y + 1][x] === 0) perimeter++
                if (x === 0 || grid[y][x - 1] === 0) perimeter++
                if (x === cols - 1 || grid[y][x + 1] === 0) perimeter++
            }
        }
    }
    return perimeter
}

function getBoundingBox(grid: BinaryGrid): { minX: number, maxX: number, minY: number, maxY: number } {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    let minX = cols, maxX = 0, minY = rows, maxY = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                minX = Math.min(minX, x)
                maxX = Math.max(maxX, x)
                minY = Math.min(minY, y)
                maxY = Math.max(maxY, y)
            }
        }
    }
    return { minX, maxX, minY, maxY }
}

function computeOutlying(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const pixels: [number, number][] = []
    let sumX = 0, sumY = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                pixels.push([x, y])
                sumX += x
                sumY += y
            }
        }
    }

    const n = pixels.length
    if (n < 5) return 0

    const cx = sumX / n
    const cy = sumY / n
    const distances = pixels.map(([x, y]) => Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2)))

    distances.sort((a, b) => a - b)
    const q1Idx = Math.floor(n * 0.25)
    const q3Idx = Math.floor(n * 0.75)
    const q1 = distances[q1Idx]
    const q3 = distances[q3Idx]
    const iqr = q3 - q1
    const threshold = q3 + 1.5 * iqr

    const outlierCount = distances.filter(d => d > threshold).length
    return Math.min(1, outlierCount / n)
}

function computeClumpy(grid: BinaryGrid): number {
    // V2: Dense Component Analysis
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
    const components: { size: number, bboxArea: number }[] = []

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1 && !visited[y][x]) {
                // BFS for component
                const queue: [number, number][] = [[y, x]]
                visited[y][x] = true
                let size = 0
                let minX = cols, maxX = 0, minY = rows, maxY = 0

                while (queue.length > 0) {
                    const [cy, cx] = queue.shift()!
                    size++
                    minX = Math.min(minX, cx)
                    maxX = Math.max(maxX, cx)
                    minY = Math.min(minY, cy)
                    maxY = Math.max(maxY, cy)

                    const neighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]]
                    for (const [dy, dx] of neighbors) {
                        const ny = cy + dy, nx = cx + dx
                        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols &&
                            grid[ny][nx] === 1 && !visited[ny][nx]) {
                            visited[ny][nx] = true
                            queue.push([ny, nx])
                        }
                    }
                }
                const bboxArea = (maxX - minX + 1) * (maxY - minY + 1)
                components.push({ size, bboxArea })
            }
        }
    }

    // Filter for DENSE components (fill ratio > 0.3)
    const denseComponents = components.filter(c => c.size / c.bboxArea > 0.3)
    const kDense = denseComponents.length
    if (kDense <= 1) return 0

    // Size balance factor (0.5 to 1.0)
    const sizes = denseComponents.map(c => c.size)
    const minSize = Math.min(...sizes)
    const maxSize = Math.max(...sizes)
    const balanceFactor = 0.5 + 0.5 * (minSize / maxSize)

    return Math.min(1, ((kDense - 1) / 4) * balanceFactor)
}

function computeStriated(grid: BinaryGrid): number {
    // V2: Row Occupancy Transitions + Gaps
    const rows = grid.length
    const cols = grid[0]?.length || 0
    let transitions = 0
    let gapRows = 0
    let occupiedRows = 0
    let lastOccupied = false

    // Horizontal extent and band consistency
    const bandWidths: number[] = []
    let currentBandWidth = 0
    let totalSpan = 0

    for (let y = 0; y < rows; y++) {
        let rowSpan = 0
        let isOccupied = false
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                isOccupied = true
                rowSpan++
            }
        }

        if (isOccupied) {
            occupiedRows++
            totalSpan += rowSpan / cols
            currentBandWidth++
            if (!lastOccupied) transitions++
        } else {
            if (lastOccupied) {
                transitions++
                bandWidths.push(currentBandWidth)
                currentBandWidth = 0
            }
            if (transitions > 0) gapRows++ // Only count gaps between bands
        }
        lastOccupied = isOccupied
    }
    if (currentBandWidth > 0) bandWidths.push(currentBandWidth)

    if (occupiedRows === 0) return 0

    const tNorm = Math.min(1, transitions / 20) // Normalize transitions (expecting < 20 for typical grids)
    const gRatio = gapRows / rows
    const hExtent = totalSpan / occupiedRows

    // Consistency of band widths (1 - CV)
    let sConsistency = 0
    if (bandWidths.length > 1) {
        const mean = bandWidths.reduce((a, b) => a + b, 0) / bandWidths.length
        const variance = bandWidths.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / bandWidths.length
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0
        sConsistency = Math.max(0, 1 - cv)
    }

    // Weighted combination (Tunable parameters from paper)
    return Math.min(1, 0.4 * tNorm + 0.25 * gRatio + 0.2 * hExtent + 0.15 * sConsistency)
}

function computeSkewed(grid: BinaryGrid, dt: number[][]): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const distances: number[] = []

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1 && dt[y][x] > 0) {
                distances.push(dt[y][x])
            }
        }
    }

    if (distances.length < 2) return 0
    const sum = distances.reduce((a, b) => a + b, 0)
    const mean = sum / distances.length
    const max = Math.max(...distances)
    if (max === 0) return 0
    return Math.max(0, Math.min(1, 1 - (mean / max)))
}

function computeMonotonic(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const rowCentroids: { row: number; centroid: number }[] = []

    for (let y = 0; y < rows; y++) {
        let sumX = 0, count = 0
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                sumX += x
                count++
            }
        }
        if (count > 0) {
            rowCentroids.push({ row: y, centroid: sumX / count })
        }
    }

    if (rowCentroids.length < 3) return 0
    const n = rowCentroids.length
    const rankRow = rowCentroids.map((_, i) => i + 1)
    const sortedCentroids = [...rowCentroids].sort((a, b) => a.centroid - b.centroid)
    const centroidRanks = new Map<number, number>()
    sortedCentroids.forEach((item, i) => centroidRanks.set(item.row, i + 1))
    const rankCentroid = rowCentroids.map(item => centroidRanks.get(item.row) || 0)

    let sumD2 = 0
    for (let i = 0; i < n; i++) {
        const d = rankRow[i] - rankCentroid[i]
        sumD2 += d * d
    }

    const rho = 1 - (6 * sumD2) / (n * (n * n - 1))
    return Math.abs(rho)
}

interface ScagnosticsMetrics {
    stringy: number
    sparse: number
    convex: number
    skinny: number
    clumpy: number
    outlying: number
    skewed: number
    striated: number
    monotonic: number
}

function computeScagnostics(
    originalGrid: BinaryGrid,
    closedGrid: BinaryGrid,
    hullGrid: BinaryGrid,
    ridgeGrid: BinaryGrid,
    dt: number[][]
): ScagnosticsMetrics {
    const originalArea = countFilledPixels(originalGrid)
    const closedArea = countFilledPixels(closedGrid)
    const hullArea = countFilledPixels(hullGrid)
    const bbox = getBoundingBox(closedGrid)
    const boundingDiagonal = Math.sqrt(Math.pow(bbox.maxX - bbox.minX, 2) + Math.pow(bbox.maxY - bbox.minY, 2)) || 1
    const perimeter = computeContourLength(closedGrid)

    // STRINGY V2: Path / Diagonal with Thickness Penalty
    const longestPath = findLongestRidgePath(ridgeGrid)
    const skeletonPixels = countFilledPixels(ridgeGrid)
    // Penalty: if skeleton is much smaller than area, it's a thick shape (not stringy)
    const thicknessPenalty = Math.max(0, 1 - 2 * (skeletonPixels / Math.max(1, closedArea)))
    const stringyRaw = boundingDiagonal > 0 ? longestPath / boundingDiagonal : 0
    // Tunable weight lambda = 0.6
    const stringy = Math.min(1, stringyRaw * (1 - 0.6 * thicknessPenalty))

    // CONVEX & SPARSE V2
    const convex = hullArea > 0 ? closedArea / hullArea : 0
    // Sparse V2: Uses ORIGINAL area (before closing) + Hole Bonus
    // We approximate "Holes" as (Hull - Closed)
    const holeArea = Math.max(0, hullArea - closedArea)
    const sparseRaw = hullArea > 0 ? (1 - originalArea / hullArea) : 0
    // Tunable weights: 0.7 base + 0.8 hole bonus
    const sparse = Math.min(1, 0.7 * sparseRaw + 0.8 * (holeArea / Math.max(1, hullArea)))

    // SKINNY (Unchanged)
    const skinnyRaw = closedArea > 0 ? (perimeter * perimeter) / (4 * Math.PI * closedArea) : 0
    const skinny = Math.min(1, skinnyRaw / 50)

    // CLUMPY V2 (Dense Components)
    const clumpy = computeClumpy(closedGrid)

    // OUTLYING V2 (Centroid Distance Count)
    const outlying = computeOutlying(originalGrid) // Use original points for outliers

    // SKEWED V2 (Distance Transform Distribution)
    const skewed = computeSkewed(closedGrid, dt)

    // STRIATED V2 (Transitions + Gaps)
    const striated = computeStriated(closedGrid)

    // MONOTONIC (Unchanged)
    const monotonic = computeMonotonic(closedGrid)

    return {
        stringy: Math.round(stringy * 1000) / 1000,
        sparse: Math.round(sparse * 1000) / 1000,
        convex: Math.round(convex * 1000) / 1000,
        skinny: Math.round(skinny * 1000) / 1000,
        clumpy: Math.round(clumpy * 1000) / 1000,
        outlying: Math.round(outlying * 1000) / 1000,
        skewed: Math.round(skewed * 1000) / 1000,
        striated: Math.round(striated * 1000) / 1000,
        monotonic: Math.round(monotonic * 1000) / 1000,
    }
}

// ============================================================
// SPLOM Data Processing
// ============================================================

const GRID_SIZE = 64  // Size of the binary grid for each scatterplot
const CLOSING_RADIUS = 2  // Morphological closing radius

interface ScatterplotResult {
    col_x: number
    col_y: number
    pointCount: number
    scagnostics: ScagnosticsMetrics
    binaryGrid: number[][]  // Store 64x64 grid for visualization
}

function rasterizeScatterplot(
    data: number[][],  // Each row is a data point with 90 columns
    colX: number,
    colY: number,
    gridSize: number
): BinaryGrid {
    const grid: BinaryGrid = Array.from({ length: gridSize }, () => Array(gridSize).fill(0))

    // Data is normalized to 0-255, map to gridSize
    const scale = gridSize / 256

    for (const row of data) {
        const x = Math.floor(row[colX] * scale)
        const y = gridSize - 1 - Math.floor(row[colY] * scale)  // Flip Y for visual consistency

        // Clamp to grid bounds
        const gx = Math.max(0, Math.min(gridSize - 1, x))
        const gy = Math.max(0, Math.min(gridSize - 1, y))
        grid[gy][gx] = 1
    }

    return grid
}

function processScatterplot(
    data: number[][],
    colX: number,
    colY: number
): ScatterplotResult {
    // Step 1: Rasterize to binary grid
    const binaryGrid = rasterizeScatterplot(data, colX, colY, GRID_SIZE)

    // Step 2: Adaptive Morphological Closing (V2)
    // Check if shape is thin using Distance Transform of ORIGINAL image
    const dtOriginal = euclideanDistanceTransform(binaryGrid)
    let maxDist = 0
    for (const row of dtOriginal) {
        for (const val of row) {
            if (val > maxDist && val < 1000) maxDist = val // 1000 is approx INF
        }
    }

    // Threshold tau = 3
    const isThinShape = maxDist <= 3

    // If thin, use Gentle Closing (Radius 1) to connect nearby dots. If thick, use Standard Closing (Radius 2).
    const closedGrid = isThinShape ? morphologicalClosing(binaryGrid, 1) : morphologicalClosing(binaryGrid, CLOSING_RADIUS)

    // Step 3: Convex hull
    const hullGrid = contourConvexHull(closedGrid)

    // Step 4: Distance transform and ridge detection
    const dt = euclideanDistanceTransform(closedGrid)
    const ridgeGrid = findRidgePixels(dt, closedGrid)

    // Step 5: Compute scagnostics
    // Pass binaryGrid as originalGrid
    const scagnostics = computeScagnostics(binaryGrid, closedGrid, hullGrid, ridgeGrid, dt)

    return {
        col_x: colX,
        col_y: colY,
        pointCount: countFilledPixels(binaryGrid),
        scagnostics,
        binaryGrid: closedGrid  // Store the closed grid for visualization
    }
}

async function main() {
    console.log('SPLOM Image Scagnostics Computation')
    console.log('===================================\n')

    // Read the normalized CSV data
    const dataDir = path.join(__dirname, '../../data')
    const csvPath = path.join(dataDir, 'YearPredictionMSD_normalized.csv')

    console.log(`Reading data from: ${csvPath}`)

    if (!fs.existsSync(csvPath)) {
        console.error(`Error: File not found: ${csvPath}`)
        process.exit(1)
    }

    const csvContent = fs.readFileSync(csvPath, 'utf-8')
    const lines = csvContent.trim().split('\n')

    // Parse CSV (no header, just values)
    const data: number[][] = []
    for (const line of lines) {
        const values = line.split(',').map(v => parseInt(v.trim(), 10))
        if (values.length > 0 && !values.some(isNaN)) {
            data.push(values)
        }
    }

    const numRows = data.length
    const numCols = data[0]?.length || 0

    console.log(`Loaded ${numRows} rows with ${numCols} columns`)

    // Process scatterplots
    // For efficiency, we'll only process off-diagonal pairs (col_x < col_y)
    // This gives us n*(n-1)/2 = 90*89/2 = 4005 scatterplots
    // We can also sample for faster processing
    const SAMPLE_SIZE = 200  // Limit to 200 scatterplots for faster loading

    const results: ScatterplotResult[] = []
    const pairs: [number, number][] = []

    // Generate all off-diagonal pairs
    for (let x = 0; x < numCols; x++) {
        for (let y = x + 1; y < numCols; y++) {
            pairs.push([x, y])
        }
    }

    // Sample pairs if there are too many
    const selectedPairs = pairs.length > SAMPLE_SIZE
        ? pairs.sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE)
        : pairs

    console.log(`Processing ${selectedPairs.length} scatterplots...\n`)

    const startTime = Date.now()

    for (let i = 0; i < selectedPairs.length; i++) {
        const [colX, colY] = selectedPairs[i]
        const result = processScatterplot(data, colX, colY)
        results.push(result)

        // Progress indicator
        if ((i + 1) % 50 === 0 || i === selectedPairs.length - 1) {
            const elapsed = (Date.now() - startTime) / 1000
            const rate = (i + 1) / elapsed
            console.log(`  Processed ${i + 1}/${selectedPairs.length} (${rate.toFixed(1)}/sec)`)
        }
    }

    const totalTime = (Date.now() - startTime) / 1000
    console.log(`\nCompleted in ${totalTime.toFixed(1)} seconds`)

    // Save results
    const output = {
        generatedAt: new Date().toISOString(),
        gridSize: GRID_SIZE,
        closingRadius: CLOSING_RADIUS,
        method: 'image-theoretic',
        numColumns: numCols,
        numRows: numRows,
        totalScatterplots: results.length,
        results: results
    }

    const outputPath = path.join(__dirname, '../public/splom_scagnostics_computed.json')
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))

    console.log(`\nSaved results to: ${outputPath}`)
    console.log(`Output file size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`)

    // Print some statistics
    console.log('\n--- Scagnostics Statistics ---')
    const metrics = ['stringy', 'sparse', 'convex', 'skinny', 'clumpy', 'outlying', 'skewed', 'striated', 'monotonic'] as const
    for (const metric of metrics) {
        const values = results.map(r => r.scagnostics[metric])
        const min = Math.min(...values)
        const max = Math.max(...values)
        const avg = values.reduce((a, b) => a + b, 0) / values.length
        console.log(`${metric.padEnd(10)}: min=${min.toFixed(3)}, max=${max.toFixed(3)}, avg=${avg.toFixed(3)}`)
    }
}

main().catch(console.error)
