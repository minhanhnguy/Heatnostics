/**
 * Statistics Module - Statistical computations for scagnostics
 */
import type { FloatGrid, BinaryGrid, Point } from '../types'

function computeRanks(values: number[]): number[] {
    const indexed = values.map((v, i) => ({ v, i }))
    indexed.sort((a, b) => a.v - b.v)
    const ranks = new Array(values.length)
    for (let i = 0; i < indexed.length; i++) {
        ranks[indexed[i].i] = i + 1
    }
    return ranks
}

export function spearmanCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 3) return 0
    const n = x.length
    const rankX = computeRanks(x)
    const rankY = computeRanks(y)
    let sumD2 = 0
    for (let i = 0; i < n; i++) {
        const d = rankX[i] - rankY[i]
        sumD2 += d * d
    }
    return 1 - (6 * sumD2) / (n * (n * n - 1))
}

export function computeWeightedStats(grid: FloatGrid, mask: BinaryGrid): {
    centroid: Point
    covariance: number[][]
    totalWeight: number
} {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    let sumW = 0, sumWX = 0, sumWY = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y]?.[x] !== 1) continue
            const w = grid[y][x]
            sumW += w
            sumWX += w * x
            sumWY += w * y
        }
    }

    if (sumW === 0) return { centroid: { x: cols / 2, y: rows / 2 }, covariance: [[1, 0], [0, 1]], totalWeight: 0 }

    const cx = sumWX / sumW, cy = sumWY / sumW
    let cov_xx = 0, cov_yy = 0, cov_xy = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y]?.[x] !== 1) continue
            const w = grid[y][x]
            const dx = x - cx, dy = y - cy
            cov_xx += w * dx * dx
            cov_yy += w * dy * dy
            cov_xy += w * dx * dy
        }
    }

    return {
        centroid: { x: cx, y: cy },
        covariance: [[cov_xx / sumW, cov_xy / sumW], [cov_xy / sumW, cov_yy / sumW]],
        totalWeight: sumW
    }
}

export function computeOutlyingMahalanobis(grid: FloatGrid, mask: BinaryGrid): number {
    const { centroid, covariance, totalWeight } = computeWeightedStats(grid, mask)
    if (totalWeight === 0) return 0

    const [[a, b], [, d]] = covariance
    const det = a * d - b * b
    if (Math.abs(det) < 1e-10) return 0

    const invDet = 1 / det
    const invCov = [[d * invDet, -b * invDet], [-b * invDet, a * invDet]]

    const rows = grid.length
    const cols = grid[0]?.length || 0
    const mahalDistances: { dist: number; weight: number }[] = []

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y]?.[x] !== 1 || grid[y][x] <= 0) continue
            const dx = x - centroid.x, dy = y - centroid.y
            const mSq = invCov[0][0] * dx * dx + 2 * invCov[0][1] * dx * dy + invCov[1][1] * dy * dy
            mahalDistances.push({ dist: Math.sqrt(Math.max(0, mSq)), weight: grid[y][x] })
        }
    }

    if (mahalDistances.length === 0) return 0

    mahalDistances.sort((a, b) => a.dist - b.dist)
    const median = mahalDistances[Math.floor(mahalDistances.length / 2)].dist
    const absDevs = mahalDistances.map(d => Math.abs(d.dist - median))
    absDevs.sort((a, b) => a - b)
    const mad = absDevs[Math.floor(absDevs.length / 2)]
    const threshold = median + 3 * mad * 1.4826

    let outlierWeight = 0
    for (const d of mahalDistances) {
        if (d.dist > threshold) outlierWeight += d.weight
    }

    return Math.min(1, outlierWeight / totalWeight)
}

export function computeSkewedPrincipalAxis(grid: FloatGrid, mask: BinaryGrid): number {
    const { centroid, covariance, totalWeight } = computeWeightedStats(grid, mask)
    if (totalWeight === 0) return 0

    const [[a, b], [, d]] = covariance
    const trace = a + d, det = a * d - b * b
    const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det))
    const lambda1 = trace / 2 + discriminant

    let ux: number, uy: number
    if (Math.abs(b) > 1e-10) {
        ux = lambda1 - d
        uy = b
    } else {
        ux = 1
        uy = 0
    }
    const len = Math.sqrt(ux * ux + uy * uy)
    if (len > 0) { ux /= len; uy /= len }

    const rows = grid.length
    const cols = grid[0]?.length || 0
    let sumWZ = 0, sumWZ2 = 0, sumWZ3 = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y]?.[x] !== 1) continue
            const w = grid[y][x]
            const z = (x - centroid.x) * ux + (y - centroid.y) * uy
            sumWZ += w * z
            sumWZ2 += w * z * z
            sumWZ3 += w * z * z * z
        }
    }

    const meanZ = sumWZ / totalWeight
    const mu2 = sumWZ2 / totalWeight - meanZ * meanZ
    const mu3 = sumWZ3 / totalWeight - 3 * meanZ * sumWZ2 / totalWeight + 2 * meanZ * meanZ * meanZ

    if (mu2 <= 0) return 0
    const skewness = mu3 / Math.pow(mu2, 1.5)
    return Math.min(1, Math.abs(skewness) / 2)
}

export function sampleSkeletonPath(skeleton: BinaryGrid, numSamples: number = 50): Point[] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    const getEndpoints = (): Point[] => {
        const eps: Point[] = []
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (skeleton[y]?.[x] !== 1) continue
                let neighbors = 0
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dy === 0 && dx === 0) continue
                        const ny = y + dy, nx = x + dx
                        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && skeleton[ny][nx] === 1) neighbors++
                    }
                }
                if (neighbors <= 1) eps.push({ x, y })
            }
        }
        return eps
    }

    const endpoints = getEndpoints()
    if (endpoints.length < 2) {
        const allPixels: Point[] = []
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (skeleton[y][x] === 1) allPixels.push({ x, y })
            }
        }
        return allPixels.slice(0, numSamples)
    }

    let maxDist = 0, startEp = endpoints[0], endEp = endpoints[1]
    for (let i = 0; i < endpoints.length; i++) {
        for (let j = i + 1; j < endpoints.length; j++) {
            const d = Math.sqrt((endpoints[i].x - endpoints[j].x) ** 2 + (endpoints[i].y - endpoints[j].y) ** 2)
            if (d > maxDist) { maxDist = d; startEp = endpoints[i]; endEp = endpoints[j] }
        }
    }

    const visited = new Map<string, Point | null>()
    const queue: Point[] = [startEp]
    visited.set(`${startEp.x},${startEp.y}`, null)

    while (queue.length > 0) {
        const current = queue.shift()!
        if (current.x === endEp.x && current.y === endEp.y) break

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const nx = current.x + dx, ny = current.y + dy
                const key = `${nx},${ny}`
                if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && skeleton[ny][nx] === 1 && !visited.has(key)) {
                    visited.set(key, current)
                    queue.push({ x: nx, y: ny })
                }
            }
        }
    }

    const path: Point[] = []
    let current: Point | null = endEp
    while (current) {
        path.unshift(current)
        current = visited.get(`${current.x},${current.y}`) || null
    }

    if (path.length === 0) return []

    const samples: Point[] = []
    const step = Math.max(1, Math.floor(path.length / numSamples))
    for (let i = 0; i < path.length; i += step) {
        samples.push(path[i])
        if (samples.length >= numSamples) break
    }
    return samples
}
