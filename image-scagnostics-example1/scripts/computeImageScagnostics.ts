/**
 * Compute Image-Based Scagnostics for All Highways
 * 
 * This script reads the existing graph-theoretic scagnostics and computes
 * the equivalent image-based metrics for comparison.
 * 
 * Usage: npx tsx scripts/computeImageScagnostics.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// ============================================================
// IMAGE PROCESSING FUNCTIONS (copied from imageProcessing.ts)
// ============================================================

type BinaryGrid = number[][]

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
    const closed = erode(dilated, radius)
    return closed
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
        const dist = bfsRidgePath(ridgeGrid, ey, ex)
        maxDist = Math.max(maxDist, dist)
    }
    return maxDist
}

function countFilledPixels(grid: BinaryGrid): number {
    return grid.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0)
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

function contourConvexHull(grid: BinaryGrid): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const points: [number, number][] = []

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                const isEdge = y === 0 || y === rows - 1 || x === 0 || x === cols - 1 ||
                    grid[y - 1][x] === 0 || grid[y + 1][x] === 0 ||
                    grid[y][x - 1] === 0 || grid[y][x + 1] === 0
                if (isEdge) points.push([x, y])
            }
        }
    }

    if (points.length < 3) {
        const result: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
        for (const [x, y] of points) result[y][x] = 1
        return result
    }

    // Graham scan
    const pivot = points.reduce((min, p) => p[1] < min[1] || (p[1] === min[1] && p[0] < min[0]) ? p : min)
    const sorted = points.filter(p => p !== pivot).sort((a, b) => {
        const angleA = Math.atan2(a[1] - pivot[1], a[0] - pivot[0])
        const angleB = Math.atan2(b[1] - pivot[1], b[0] - pivot[0])
        return angleA - angleB
    })

    const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    const hull: [number, number][] = [pivot]
    for (const p of sorted) {
        while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
            hull.pop()
        }
        hull.push(p)
    }

    // Fill hull
    const result: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let inside = false
            for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
                const [xi, yi] = hull[i]
                const [xj, yj] = hull[j]
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                    inside = !inside
                }
            }
            if (inside) result[y][x] = 1
        }
    }
    return result
}

function erosionSurvivalRatio(grid: BinaryGrid, radius: number = 2): number {
    const original = countFilledPixels(grid)
    if (original === 0) return 0
    const eroded = erode(grid, radius)
    const erodedCount = countFilledPixels(eroded)
    return erodedCount / original
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

function computeStriated(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const rowFills: number[] = []

    for (let y = 0; y < rows; y++) {
        let rowCount = 0
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) rowCount++
        }
        if (rowCount > 0) rowFills.push(rowCount)
    }

    if (rowFills.length < 2) return 0
    const mean = rowFills.reduce((a, b) => a + b, 0) / rowFills.length
    const variance = rowFills.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / rowFills.length
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0
    return Math.max(0, 1 - cv)
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
    const rank = (arr: number[]): number[] => {
        const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
        const ranks = new Array(n)
        for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1
        return ranks
    }

    const rowIndices = rowCentroids.map(r => r.row)
    const centroids = rowCentroids.map(r => r.centroid)
    const rankRows = rank(rowIndices)
    const rankCentroids = rank(centroids)

    let d2Sum = 0
    for (let i = 0; i < n; i++) {
        const d = rankRows[i] - rankCentroids[i]
        d2Sum += d * d
    }

    return Math.abs(1 - (6 * d2Sum) / (n * (n * n - 1)))
}

// ============================================================
// MAIN COMPUTATION
// ============================================================

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

interface HighwayEntry {
    highway: string
    location: string
    pointCount: number
    scagnostics: ScagnosticsMetrics
}

interface PrecomputedData {
    generatedAt: string
    maxConditionScore: number
    minPointsK: number
    county: HighwayEntry[]
}

const GRID_SIZE = 256
const CLOSING_RADIUS = 3

function computeImageScagnostics(
    closedGrid: BinaryGrid,
    hullGrid: BinaryGrid,
    ridgeGrid: BinaryGrid,
    dt: number[][]
): ScagnosticsMetrics {
    const closedArea = countFilledPixels(closedGrid)
    const hullArea = countFilledPixels(hullGrid)

    const bbox = getBoundingBox(closedGrid)
    const boundingDiagonal = Math.sqrt(
        Math.pow(bbox.maxX - bbox.minX, 2) + Math.pow(bbox.maxY - bbox.minY, 2)
    ) || 1

    const perimeter = computeContourLength(closedGrid)
    const longestPath = findLongestRidgePath(ridgeGrid)
    const stringy = boundingDiagonal > 0 ? Math.min(1, longestPath / boundingDiagonal) : 0

    const convex = hullArea > 0 ? closedArea / hullArea : 0
    const sparse = 1 - convex

    const skinnyRaw = closedArea > 0 ? (perimeter * perimeter) / (4 * Math.PI * closedArea) : 0
    const skinny = Math.min(1, skinnyRaw / 50)

    const clumpy = erosionSurvivalRatio(closedGrid, 2)

    const erodedGrid = erode(closedGrid, 1)
    const erodedArea = countFilledPixels(erodedGrid)
    const erosionResidue = closedArea - erodedArea
    const outlying = closedArea > 0 ? erosionResidue / closedArea : 0

    const skewed = computeSkewed(closedGrid, dt)
    const striated = computeStriated(closedGrid)
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
// Downsample a grid to a smaller size for storage
function downsampleGrid(grid: BinaryGrid, targetSize: number): BinaryGrid {
    const srcSize = grid.length
    const result: BinaryGrid = Array.from({ length: targetSize }, () => Array(targetSize).fill(0))
    const scale = srcSize / targetSize

    for (let ty = 0; ty < targetSize; ty++) {
        for (let tx = 0; tx < targetSize; tx++) {
            // Check if any pixel in the source region is filled
            const srcY1 = Math.floor(ty * scale)
            const srcY2 = Math.floor((ty + 1) * scale)
            const srcX1 = Math.floor(tx * scale)
            const srcX2 = Math.floor((tx + 1) * scale)

            let filled = false
            for (let sy = srcY1; sy < srcY2 && !filled; sy++) {
                for (let sx = srcX1; sx < srcX2 && !filled; sx++) {
                    if (sy < srcSize && sx < srcSize && grid[sy][sx] === 1) {
                        filled = true
                    }
                }
            }
            result[ty][tx] = filled ? 1 : 0
        }
    }
    return result
}


function rasterizePoints(
    points: { x: number; y: number }[],
    minX: number, maxX: number,
    minY: number, maxY: number,
    gridSize: number
): BinaryGrid {
    const grid: BinaryGrid = Array.from({ length: gridSize }, () => Array(gridSize).fill(0))

    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1

    for (const p of points) {
        const gx = Math.floor(((p.x - minX) / rangeX) * (gridSize - 1))
        const gy = Math.floor(((p.y - minY) / rangeY) * (gridSize - 1))
        if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
            grid[gy][gx] = 1
        }
    }
    return grid
}

async function main() {
    console.log('Loading PMIS combined data...')

    // Use PMIS_combined.csv from public/data
    const pmisPath = path.join(__dirname, '../public/data/PMIS_combined.csv')
    const pmisContent = fs.readFileSync(pmisPath, 'utf-8')
    const lines = pmisContent.split('\n')
    const headers = lines[0].split(',')

    // Find column indices
    const yearIdx = headers.findIndex(h => h === 'EFF_YEAR')
    const highwayIdx = headers.findIndex(h => h.includes('TX_SIGNED_HIGHWAY_RDBD_ID'))
    const countyIdx = headers.findIndex(h => h === 'COUNTY')
    const begMarkerIdx = headers.findIndex(h => h === 'TX_BEG_REF_MARKER_NBR')
    const begDispIdx = headers.findIndex(h => h === 'TX_BEG_REF_MRKR_DISP')
    const endMarkerIdx = headers.findIndex(h => h === 'TX_END_REF_MARKER_NBR')
    const endDispIdx = headers.findIndex(h => h === 'TX_END_REF_MARKER_DISP')
    const scoreIdx = headers.findIndex(h => h === 'TX_CONDITION_SCORE')

    console.log(`Column indices: year=${yearIdx}, highway=${highwayIdx}, county=${countyIdx}, begMarker=${begMarkerIdx}, score=${scoreIdx}`)

    // Group data by highway + county (like Step 1 heatmap structure)
    interface HeatmapPoint {
        year: number
        position: number      // TX_BEG_REF_MARKER_NBR + TX_BEG_REF_MRKR_DISP
        endPosition: number   // TX_END_REF_MARKER_NBR + TX_END_REF_MARKER_DISP (or approximated)
        score: number
    }

    const dataByHighwayCounty: Map<string, HeatmapPoint[]> = new Map()

    console.log(`Processing ${lines.length} lines...`)
    for (let i = 1; i < lines.length; i++) {
        if (i % 500000 === 0) console.log(`  Line ${i}/${lines.length}...`)
        const line = lines[i]
        if (!line.trim()) continue

        const cols = line.split(',')
        const highway = cols[highwayIdx]?.trim()
        const countyRaw = cols[countyIdx]?.trim()
        const year = parseInt(cols[yearIdx])
        const begMarker = parseFloat(cols[begMarkerIdx])
        const begDisp = parseFloat(cols[begDispIdx]) || 0
        const endMarker = parseFloat(cols[endMarkerIdx])
        const endDisp = parseFloat(cols[endDispIdx]) || 0
        const score = parseFloat(cols[scoreIdx])

        // Compute position as marker + displacement (e.g., marker 741 + disp 0.3 = 741.3)
        const position = begMarker + begDisp / 10
        let endPosition = endMarker + endDisp / 10

        // If endPosition is not valid, approximate it
        if (isNaN(endPosition) || endPosition <= position) {
            endPosition = position + 0.5  // Default segment length
        }

        // Parse county: " 92 - GRAYSON" -> "Grayson"
        const countyMatch = countyRaw?.match(/^\s*\d+\s*-\s*(.+)$/)
        const county = countyMatch
            ? countyMatch[1].trim().charAt(0).toUpperCase() + countyMatch[1].trim().slice(1).toLowerCase()
            : countyRaw?.trim()

        if (!highway || !county || isNaN(year) || isNaN(position) || isNaN(score)) continue

        const key = `${highway}|${county}`
        if (!dataByHighwayCounty.has(key)) dataByHighwayCounty.set(key, [])
        dataByHighwayCounty.get(key)!.push({ year, position, endPosition, score })
    }

    console.log(`Found ${dataByHighwayCounty.size} unique highway-county combinations`)

    // Compute image scagnostics for each highway-county pair
    const DISPLAY_GRID_SIZE = 64  // Smaller grid for storage/display

    const results: {
        highway: string
        location: string  // county
        pointCount: number
        imageScagnostics: ScagnosticsMetrics
        binaryGrid: BinaryGrid  // 64x64 downsampled grid for display
    }[] = []

    let processed = 0
    const entries = Array.from(dataByHighwayCounty.entries())

    for (const [key, points] of entries) {
        processed++
        if (processed % 200 === 0) {
            console.log(`  Computed ${processed}/${entries.length} highway-county pairs...`)
        }

        // Filter damage points only (0 < score < 50)
        const damagePoints = points.filter(p => p.score > 0 && p.score < 50)

        if (damagePoints.length < 3) continue  // Need minimum points

        const [highway, location] = key.split('|')

        // Compute ranges for this highway-county
        const years = [...new Set(points.map(p => p.year))].sort((a, b) => b - a)  // Descending (newest at top)
        const allPositions = points.flatMap(p => [p.position, p.endPosition])
        const minPos = Math.min(...allPositions)
        const maxPos = Math.max(...allPositions)

        if (years.length < 2 || maxPos <= minPos) continue

        // Rasterize: Y-axis = year, X-axis = position (matching Step 1 heatmap)
        const binaryGrid = rasterizeHeatmap(
            damagePoints,
            years,
            minPos,
            maxPos,
            GRID_SIZE
        )

        // Check if grid has enough filled pixels
        const filledCount = countFilledPixels(binaryGrid)
        if (filledCount < 10) continue

        // Apply pipeline
        const closedGrid = morphologicalClosing(binaryGrid, CLOSING_RADIUS)
        const hullGrid = contourConvexHull(closedGrid)
        const dt = euclideanDistanceTransform(closedGrid)
        const ridgeGrid = findRidgePixels(dt, closedGrid)

        // Compute metrics
        const imageScag = computeImageScagnostics(closedGrid, hullGrid, ridgeGrid, dt)

        // Downsample grid for storage/display
        const displayGrid = downsampleGrid(closedGrid, DISPLAY_GRID_SIZE)

        results.push({
            highway,
            location,
            pointCount: damagePoints.length,
            imageScagnostics: imageScag,
            binaryGrid: displayGrid
        })
    }

    console.log(`\nComputed image scagnostics for ${results.length} highway-county pairs`)

    // Save results
    const outputPath = path.join(__dirname, '../public/image_scagnostics_computed.json')
    const output = {
        generatedAt: new Date().toISOString(),
        gridSize: GRID_SIZE,
        displayGridSize: DISPLAY_GRID_SIZE,
        closingRadius: CLOSING_RADIUS,
        method: 'Distance Transform + Ridge Detection',
        dataSource: 'PMIS_combined.csv',
        totalHighwayCountyPairs: results.length,
        results
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
    console.log(`\nSaved to ${outputPath}`)

    // Print statistics
    console.log('\n=== METRIC DISTRIBUTIONS ===')
    const metrics = ['stringy', 'sparse', 'convex', 'skinny', 'clumpy', 'outlying', 'skewed', 'striated', 'monotonic'] as const

    for (const metric of metrics) {
        const values = results.map(r => r.imageScagnostics[metric])
        const mean = values.reduce((a, b) => a + b, 0) / values.length
        const min = Math.min(...values)
        const max = Math.max(...values)
        console.log(`${metric.padEnd(10)}: mean=${mean.toFixed(3)} min=${min.toFixed(3)} max=${max.toFixed(3)}`)
    }
}

// Rasterize heatmap data to binary grid (matching Step 1 format)
// Y-axis = year (newest at top), X-axis = position
function rasterizeHeatmap(
    points: { year: number; position: number; endPosition: number; score: number }[],
    years: number[],  // Sorted descending (newest first)
    minPos: number,
    maxPos: number,
    gridSize: number
): BinaryGrid {
    const grid: BinaryGrid = Array.from({ length: gridSize }, () => Array(gridSize).fill(0))

    const yearToRow = new Map(years.map((y, i) => [y, i]))
    const rowsPerYear = gridSize / years.length
    const posRange = maxPos - minPos

    for (const p of points) {
        const yearIdx = yearToRow.get(p.year)
        if (yearIdx === undefined) continue

        const rowStart = Math.floor(yearIdx * rowsPerYear)
        const rowEnd = Math.floor((yearIdx + 1) * rowsPerYear)
        const colStart = Math.floor(((p.position - minPos) / posRange) * gridSize)
        const colEnd = Math.ceil(((p.endPosition - minPos) / posRange) * gridSize)

        for (let row = rowStart; row < rowEnd && row < gridSize; row++) {
            for (let col = Math.max(0, colStart); col < Math.min(gridSize, colEnd); col++) {
                grid[row][col] = 1
            }
        }
    }

    return grid
}

main().catch(console.error)
