/**
 * Skeleton Module - Zhang-Suen thinning, topology analysis, branch extraction
 */
import type { BinaryGrid, FloatGrid, Point, SkeletonBranch } from '../types'

/**
 * SkeletonTopology interface
 */
export interface SkeletonTopology {
    endpoints: Point[]
    junctions: Point[]
    branches: SkeletonBranch[]
    displayJunctions: Point[]
    loopTops: Point[]
    loopCount: number
}

const MIN_BRANCH_LENGTH = 3

/**
 * Zhang-Suen Thinning Algorithm for skeleton extraction
 */
export function zhangSuenThinning(grid: BinaryGrid): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    let current = grid.map(row => [...row])
    let changed = true

    const getNeighbors = (img: BinaryGrid, y: number, x: number): number[] => {
        return [
            img[y - 1]?.[x] || 0,
            img[y - 1]?.[x + 1] || 0,
            img[y]?.[x + 1] || 0,
            img[y + 1]?.[x + 1] || 0,
            img[y + 1]?.[x] || 0,
            img[y + 1]?.[x - 1] || 0,
            img[y]?.[x - 1] || 0,
            img[y - 1]?.[x - 1] || 0
        ]
    }

    const countTransitions = (neighbors: number[]): number => {
        let count = 0
        for (let i = 0; i < 8; i++) {
            if (neighbors[i] === 0 && neighbors[(i + 1) % 8] === 1) count++
        }
        return count
    }

    const countNeighbors = (neighbors: number[]): number => {
        return neighbors.reduce((sum, n) => sum + n, 0)
    }

    while (changed) {
        changed = false
        const toRemove: [number, number][] = []

        for (let y = 1; y < rows - 1; y++) {
            for (let x = 1; x < cols - 1; x++) {
                if (current[y][x] !== 1) continue
                const neighbors = getNeighbors(current, y, x)
                const B = countNeighbors(neighbors)
                const A = countTransitions(neighbors)
                if (B >= 2 && B <= 6 && A === 1 &&
                    neighbors[0] * neighbors[2] * neighbors[4] === 0 &&
                    neighbors[2] * neighbors[4] * neighbors[6] === 0) {
                    toRemove.push([y, x])
                }
            }
        }

        for (const [y, x] of toRemove) {
            current[y][x] = 0
            changed = true
        }
        toRemove.length = 0

        for (let y = 1; y < rows - 1; y++) {
            for (let x = 1; x < cols - 1; x++) {
                if (current[y][x] !== 1) continue
                const neighbors = getNeighbors(current, y, x)
                const B = countNeighbors(neighbors)
                const A = countTransitions(neighbors)
                if (B >= 2 && B <= 6 && A === 1 &&
                    neighbors[0] * neighbors[2] * neighbors[6] === 0 &&
                    neighbors[0] * neighbors[4] * neighbors[6] === 0) {
                    toRemove.push([y, x])
                }
            }
        }

        for (const [y, x] of toRemove) {
            current[y][x] = 0
            changed = true
        }
    }

    // Post-process to ensure strictly 1-pixel width
    return ensureOnePixelWidth(current)
}

/**
 * Ensure skeleton is strictly 1-pixel wide by iteratively removing redundant pixels.
 * Uses a connectivity-preserving approach: removes pixels that don't disconnect the skeleton.
 */
function ensureOnePixelWidth(skeleton: BinaryGrid): BinaryGrid {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const result = skeleton.map(row => [...row])

    // 8-connected neighbor offsets (ordered: NW, N, NE, E, SE, S, SW, W)
    const dx8 = [-1, 0, 1, 1, 1, 0, -1, -1]
    const dy8 = [-1, -1, -1, 0, 1, 1, 1, 0]

    // Count 8-connected neighbors
    const countNeighbors = (x: number, y: number): number => {
        let count = 0
        for (let i = 0; i < 8; i++) {
            const nx = x + dx8[i]
            const ny = y + dy8[i]
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && result[ny][nx] === 1) {
                count++
            }
        }
        return count
    }

    // Get neighbor pattern as 8-bit binary (for connectivity check)
    const getNeighborPattern = (x: number, y: number): number => {
        let pattern = 0
        for (let i = 0; i < 8; i++) {
            const nx = x + dx8[i]
            const ny = y + dy8[i]
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && result[ny][nx] === 1) {
                pattern |= (1 << i)
            }
        }
        return pattern
    }

    // Count 0-1 transitions in the 8-neighborhood (clockwise)
    // This tells us how many connected components surround the pixel
    const countTransitions = (pattern: number): number => {
        let transitions = 0
        for (let i = 0; i < 8; i++) {
            const curr = (pattern >> i) & 1
            const next = (pattern >> ((i + 1) % 8)) & 1
            if (curr === 0 && next === 1) transitions++
        }
        return transitions
    }

    // A pixel can be removed if:
    // 1. It has 2+ neighbors (not an endpoint)
    // 2. Removing it doesn't disconnect neighbors (transitions == 1)
    // 3. It has neighbors on "opposite" sides (characteristic of thick sections)
    const canRemove = (x: number, y: number): boolean => {
        const neighbors = countNeighbors(x, y)
        if (neighbors <= 1) return false  // Endpoint, keep it

        const pattern = getNeighborPattern(x, y)
        const transitions = countTransitions(pattern)

        // Only 1 transition means all neighbors are in one connected group
        // Removing this pixel won't disconnect them
        if (transitions !== 1) return false

        // Check if this is a "thick" pixel (has neighbors in both directions of an axis)
        // North and South (bits 1 and 5)
        // East and West (bits 3 and 7)
        // NW and SE (bits 0 and 4)
        // NE and SW (bits 2 and 6)
        const hasNS = ((pattern >> 1) & 1) && ((pattern >> 5) & 1)
        const hasEW = ((pattern >> 3) & 1) && ((pattern >> 7) & 1)
        const hasNWSE = ((pattern >> 0) & 1) && ((pattern >> 4) & 1)
        const hasNESW = ((pattern >> 2) & 1) && ((pattern >> 6) & 1)

        // If neighbors exist on opposite sides, this is likely a thick section pixel
        if (hasNS || hasEW || hasNWSE || hasNESW) return true

        // Also remove if there are 4+ neighbors (definitely thick)
        if (neighbors >= 4) return true

        return false
    }

    let changed = true
    while (changed) {
        changed = false

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (result[y][x] === 1 && canRemove(x, y)) {
                    result[y][x] = 0
                    changed = true
                }
            }
        }
    }

    return result
}

function getSkeletonEndpoints(skeleton: BinaryGrid): Point[] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const endpoints: Point[] = []

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (skeleton[y]?.[x] !== 1) continue
            let neighbors = 0
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const ny = y + dy
                    const nx = x + dx
                    if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                        if (skeleton[ny][nx] === 1) neighbors++
                    }
                }
            }
            if (neighbors <= 1) endpoints.push({ x, y })
        }
    }
    return endpoints
}

function getSkeletonJunctions(skeleton: BinaryGrid): Point[] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const junctions: Point[] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (skeleton[y][x] !== 1) continue
            let neighbors = 0
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (skeleton[y + dy]?.[x + dx] === 1) neighbors++
                }
            }
            if (neighbors >= 3) junctions.push({ x, y })
        }
    }
    return junctions
}

/**
 * Fill in "corridor" pixels along the path.
 * Only includes adjacent skeleton pixels that are part of a thick corridor,
 * not pixels that lead to separate branches.
 * A pixel is considered a corridor pixel if most of its skeleton neighbors are already in the path.
 */
function fillPathCorridor(initialPath: Point[], skeleton: BinaryGrid): Point[] {
    if (initialPath.length === 0) return []

    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    // Set of path pixels
    const pathSet = new Set<string>()
    for (const p of initialPath) {
        pathSet.add(`${p.x},${p.y}`)
    }

    const result: Point[] = [...initialPath]

    // Count how many skeleton neighbors a pixel has
    const countSkeletonNeighbors = (x: number, y: number): number => {
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const nx = x + dx
                const ny = y + dy
                if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && skeleton[ny][nx] === 1) {
                    count++
                }
            }
        }
        return count
    }

    // Count how many of a pixel's skeleton neighbors are in the path
    const countPathNeighbors = (x: number, y: number): number => {
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const nx = x + dx
                const ny = y + dy
                if (pathSet.has(`${nx},${ny}`)) {
                    count++
                }
            }
        }
        return count
    }

    // Iteratively add corridor pixels until no more can be added
    let changed = true
    while (changed) {
        changed = false
        for (const p of [...result]) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = p.x + dx
                    const ny = p.y + dy
                    const nkey = `${nx},${ny}`

                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                        skeleton[ny][nx] === 1 && !pathSet.has(nkey)) {
                        // Only add if this pixel is a "corridor" pixel:
                        // Most of its skeleton neighbors should already be in the path
                        const skeletonNeighbors = countSkeletonNeighbors(nx, ny)
                        const pathNeighbors = countPathNeighbors(nx, ny)

                        // If at least half of skeleton neighbors are in path, it's a corridor pixel
                        if (pathNeighbors >= skeletonNeighbors / 2 && pathNeighbors >= 2) {
                            pathSet.add(nkey)
                            result.push({ x: nx, y: ny })
                            changed = true
                        }
                    }
                }
            }
        }
    }

    return result
}

/**
 * Compute the longest path in the skeleton, returning the actual pixel coordinates.
 *
 * ALGORITHM CHOICE: BFS vs DFS
 *
 * DFS with backtracking would find the TRUE longest path (visiting maximum pixels),
 * but has O(N!) worst-case complexity for skeletons with branches/loops, making it
 * impractical for real-time use (causes page to hang for seconds/minutes).
 *
 * BFS is O(N) and finds a path from endpoint to the farthest reachable pixel.
 * TRADEOFF: BFS may miss some skeleton pixels if there are parallel segments or
 * branches, because it commits to the first path discovered and won't backtrack.
 *
 * For a perfectly 1-pixel-wide skeleton with no branches, BFS gives the same result
 * as DFS. The difference only appears when the skeleton has extra pixels.
 *
 * POST-PROCESSING: After BFS finds the main path, we fill in any "corridor" pixels
 * that are adjacent to the path but were missed. This only includes pixels that are
 * part of the same corridor (not branch pixels). Maintains O(N) complexity.
 */
export function computeSkeletonLongestPathData(skeleton: BinaryGrid): Point[] {
    const endpoints = getSkeletonEndpoints(skeleton)
    if (endpoints.length === 0) return []

    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    // BFS that tracks parent pointers to reconstruct the path
    const bfsWithPath = (start: Point): { path: Point[], pixelCount: number } => {
        const visited = new Map<string, Point | null>()
        const queue: Point[] = [start]
        visited.set(`${start.x},${start.y}`, null)

        let farthest = start
        let maxPixels = 1

        while (queue.length > 0) {
            const current = queue.shift()!

            // Count pixels in path to this point
            let pixelCount = 0
            let p: Point | null = current
            while (p) {
                pixelCount++
                p = visited.get(`${p.x},${p.y}`) ?? null
            }

            if (pixelCount > maxPixels) {
                maxPixels = pixelCount
                farthest = current
            }

            // Explore neighbors
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = current.x + dx
                    const ny = current.y + dy
                    const nkey = `${nx},${ny}`

                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                        skeleton[ny][nx] === 1 && !visited.has(nkey)) {
                        visited.set(nkey, current)
                        queue.push({ x: nx, y: ny })
                    }
                }
            }
        }

        // Reconstruct path from start to farthest
        const path: Point[] = []
        let curr: Point | null = farthest
        while (curr) {
            path.unshift(curr)
            curr = visited.get(`${curr.x},${curr.y}`) ?? null
        }

        return { path, pixelCount: maxPixels }
    }

    // Find the longest path from any endpoint
    let bestPath: Point[] = []
    let bestCount = 0

    for (const ep of endpoints) {
        const result = bfsWithPath(ep)
        if (result.pixelCount > bestCount) {
            bestCount = result.pixelCount
            bestPath = result.path
        }
    }

    // Fill in any corridor pixels that BFS missed
    return fillPathCorridor(bestPath, skeleton)
}

/**
 * Compute the arc length of a set of path pixels.
 * Sums the edge lengths between adjacent pixels in the path.
 */
function computePathArcLength(pathPoints: Point[]): number {
    if (pathPoints.length === 0) return 0

    const pathSet = new Set<string>()
    for (const p of pathPoints) {
        pathSet.add(`${p.x},${p.y}`)
    }

    let totalLength = 0
    const visitedEdges = new Set<string>()

    for (const p of pathPoints) {
        // Check all 8 neighbors
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const nx = p.x + dx
                const ny = p.y + dy
                const nkey = `${nx},${ny}`

                if (pathSet.has(nkey)) {
                    // Create a unique edge key (smaller coord first)
                    const edgeKey = `${Math.min(p.x, nx)},${Math.min(p.y, ny)}-${Math.max(p.x, nx)},${Math.max(p.y, ny)}`
                    if (!visitedEdges.has(edgeKey)) {
                        visitedEdges.add(edgeKey)
                        totalLength += (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1
                    }
                }
            }
        }
    }

    return totalLength
}

export function computeSkeletonLongestPath(skeleton: BinaryGrid): number {
    // Get the filled path data (same as what's shown in blue)
    const pathPoints = computeSkeletonLongestPathData(skeleton)
    // Calculate arc length from the path points
    return computePathArcLength(pathPoints)
}

export function pruneSkeletonBranches(skeleton: BinaryGrid, minLength: number): BinaryGrid {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const pruned = skeleton.map(row => [...row])

    let changed = true
    while (changed) {
        changed = false
        const endpoints = getSkeletonEndpoints(pruned)

        for (const ep of endpoints) {
            const visited = new Set<string>()
            let current = ep
            let branchLength = 0
            const branchPixels: Point[] = [current]

            while (true) {
                visited.add(`${current.x},${current.y}`)
                let next: Point | null = null
                let neighbors = 0

                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dy === 0 && dx === 0) continue
                        const nx = current.x + dx
                        const ny = current.y + dy
                        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && pruned[ny][nx] === 1) {
                            neighbors++
                            if (!visited.has(`${nx},${ny}`)) {
                                next = { x: nx, y: ny }
                                branchLength += (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1
                            }
                        }
                    }
                }

                if (!next || neighbors >= 3) break
                branchPixels.push(next)
                current = next
            }

            if (branchLength < minLength && branchLength > 0) {
                for (const p of branchPixels) {
                    let neighborCount = 0
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dy === 0 && dx === 0) continue
                            const nx = p.x + dx
                            const ny = p.y + dy
                            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && pruned[ny][nx] === 1) {
                                neighborCount++
                            }
                        }
                    }
                    if (neighborCount <= 2) {
                        pruned[p.y][p.x] = 0
                        changed = true
                    }
                }
            }
        }
    }

    return pruned
}

export function computeSkeletonArcLength(skeleton: BinaryGrid): number {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    let L = 0
    const visited = new Set<string>()

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (skeleton[y][x] !== 1) continue
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = x + dx
                    const ny = y + dy
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && skeleton[ny][nx] === 1) {
                        const edgeKey = `${Math.min(x, nx)},${Math.min(y, ny)}-${Math.max(x, nx)},${Math.max(y, ny)}`
                        if (!visited.has(edgeKey)) {
                            visited.add(edgeKey)
                            L += Math.sqrt(dx * dx + dy * dy)
                        }
                    }
                }
            }
        }
    }
    return L
}

function findPathBetween(
    start: Point, end: Point, exclude: Point,
    skeleton: BinaryGrid, rows: number, cols: number, junctions: Point[]
): { found: boolean; path: Point[] } {
    const visited = new Set<string>()
    visited.add(`${exclude.x},${exclude.y}`)
    const endKey = `${end.x},${end.y}`
    const queue: { point: Point; path: Point[] }[] = [{ point: start, path: [start] }]

    const getNeighbors = (x: number, y: number): Point[] => {
        const neighbors: Point[] = []
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && skeleton[ny][nx] === 1) {
                    neighbors.push({ x: nx, y: ny })
                }
            }
        }
        return neighbors
    }

    let iterations = 0
    while (queue.length > 0 && iterations < rows * cols) {
        iterations++
        const { point, path } = queue.shift()!
        const key = `${point.x},${point.y}`
        if (visited.has(key)) continue
        visited.add(key)
        if (key === endKey) return { found: true, path }
        if (path.length > 100) continue

        for (const n of getNeighbors(point.x, point.y)) {
            if (!visited.has(`${n.x},${n.y}`)) {
                queue.push({ point: n, path: [...path, n] })
            }
        }
    }
    return { found: false, path: [] }
}

export function analyzeSkeletonTopology(skeleton: BinaryGrid, dt?: FloatGrid): SkeletonTopology {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    const countNeighbors = (x: number, y: number): number => {
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && skeleton[ny][nx] === 1) count++
            }
        }
        return count
    }

    const getNeighbors = (x: number, y: number): Point[] => {
        const neighbors: Point[] = []
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && skeleton[ny][nx] === 1) {
                    neighbors.push({ x: nx, y: ny })
                }
            }
        }
        return neighbors
    }

    const endpoints: Point[] = []
    const endpointSet = new Set<string>()
    const candidateJunctions: Point[] = []
    const candidateSet = new Set<string>()

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (skeleton[y]?.[x] !== 1) continue
            const neighbors = countNeighbors(x, y)
            if (neighbors <= 1) {
                endpoints.push({ x, y })
                endpointSet.add(`${x},${y}`)
            } else if (neighbors >= 3) {
                candidateJunctions.push({ x, y })
                candidateSet.add(`${x},${y}`)
            }
        }
    }

    const traceBranchToEndpoint = (start: Point, origin: Point): { endpoint: Point | null; length: number } => {
        const visited = new Set<string>()
        visited.add(`${origin.x},${origin.y}`)
        let current = start
        let prev = origin
        let length = Math.sqrt((current.x - prev.x) ** 2 + (current.y - prev.y) ** 2)
        let iterations = 0

        while (iterations < rows * cols) {
            iterations++
            const currentKey = `${current.x},${current.y}`
            if (visited.has(currentKey)) break
            visited.add(currentKey)

            if (endpointSet.has(currentKey)) return { endpoint: current, length }

            const neighbors = getNeighbors(current.x, current.y)
            const nextCandidates = neighbors.filter(n => !visited.has(`${n.x},${n.y}`) && (n.x !== prev.x || n.y !== prev.y))

            if (nextCandidates.length === 0) {
                if (countNeighbors(current.x, current.y) <= 1) return { endpoint: current, length }
                break
            }

            const next = nextCandidates[0]
            length += Math.sqrt((next.x - current.x) ** 2 + (next.y - current.y) ** 2)
            prev = current
            current = next
        }
        return { endpoint: null, length }
    }

    const trueJunctions: Point[] = []
    for (const candidate of candidateJunctions) {
        const neighbors = getNeighbors(candidate.x, candidate.y)
        const branchResults = neighbors.map(n => traceBranchToEndpoint(n, candidate))
        const meaningfulBranches = branchResults.filter(r => r.endpoint !== null && r.length >= MIN_BRANCH_LENGTH)
        const uniqueEndpoints = new Set(meaningfulBranches.filter(b => b.endpoint).map(b => `${b.endpoint!.x},${b.endpoint!.y}`))
        if (uniqueEndpoints.size >= 2) trueJunctions.push(candidate)
    }

    const displayJunctions: Point[] = []
    const processedJunctions = new Set<string>()
    const trueJunctionSet = new Set(trueJunctions.map(j => `${j.x},${j.y}`))

    for (const junction of trueJunctions) {
        const key = `${junction.x},${junction.y}`
        if (processedJunctions.has(key)) continue

        const cluster: Point[] = []
        const queue: Point[] = [junction]

        while (queue.length > 0) {
            const current = queue.shift()!
            const currentKey = `${current.x},${current.y}`
            if (processedJunctions.has(currentKey)) continue
            processedJunctions.add(currentKey)
            cluster.push(current)

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = current.x + dx
                    const ny = current.y + dy
                    const neighborKey = `${nx},${ny}`
                    if (trueJunctionSet.has(neighborKey) && !processedJunctions.has(neighborKey)) {
                        queue.push({ x: nx, y: ny })
                    }
                }
            }
        }

        if (cluster.length > 0) {
            const centerX = Math.round(cluster.reduce((s, p) => s + p.x, 0) / cluster.length)
            const centerY = Math.round(cluster.reduce((s, p) => s + p.y, 0) / cluster.length)
            let bestDist = Infinity
            let representative = cluster[0]
            for (const p of cluster) {
                const dist = Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2)
                if (dist < bestDist) { bestDist = dist; representative = p }
            }
            displayJunctions.push(representative)
        }
    }

    const nodeSet = new Set<string>()
    for (const ep of endpoints) nodeSet.add(`${ep.x},${ep.y}`)
    for (const j of displayJunctions) nodeSet.add(`${j.x},${j.y}`)

    const branches: SkeletonBranch[] = []
    const visitedEdges = new Set<string>()
    const meaningfulNodes = [...endpoints, ...displayJunctions]

    for (const startNode of meaningfulNodes) {
        const startNeighbors = getNeighbors(startNode.x, startNode.y)

        for (const firstStep of startNeighbors) {
            const edgeKey = `${Math.min(startNode.x, firstStep.x)},${Math.min(startNode.y, firstStep.y)}-${Math.max(startNode.x, firstStep.x)},${Math.max(startNode.y, firstStep.y)}`
            if (visitedEdges.has(edgeKey)) continue
            visitedEdges.add(edgeKey)

            const pixels: Point[] = [startNode]
            let current = firstStep
            let prev = startNode
            let length = Math.sqrt((current.x - prev.x) ** 2 + (current.y - prev.y) ** 2)
            let radiusSum = dt?.[startNode.y]?.[startNode.x] ?? 1
            let iterations = 0

            while (iterations < rows * cols) {
                iterations++
                pixels.push(current)
                radiusSum += dt?.[current.y]?.[current.x] ?? 1

                const ek = `${Math.min(prev.x, current.x)},${Math.min(prev.y, current.y)}-${Math.max(prev.x, current.x)},${Math.max(prev.y, current.y)}`
                visitedEdges.add(ek)

                if (nodeSet.has(`${current.x},${current.y}`)) break

                const currentNeighbors = getNeighbors(current.x, current.y)
                const nextCandidates = currentNeighbors.filter(n => n.x !== prev.x || n.y !== prev.y)
                if (nextCandidates.length === 0) break

                const next = nextCandidates[0]
                length += Math.sqrt((next.x - current.x) ** 2 + (next.y - current.y) ** 2)
                prev = current
                current = next
            }

            if (pixels.length >= 2) {
                branches.push({
                    pixels, length,
                    meanRadius: radiusSum / pixels.length,
                    startPoint: pixels[0],
                    endPoint: pixels[pixels.length - 1]
                })
            }
        }
    }

    const loopTops: Point[] = []
    let loopCount = 0
    const loopConnectionCandidates = candidateJunctions.filter(j => !trueJunctionSet.has(`${j.x},${j.y}`))
    const processedLoopPoints = new Set<string>()

    for (const startPoint of loopConnectionCandidates) {
        const startKey = `${startPoint.x},${startPoint.y}`
        if (processedLoopPoints.has(startKey)) continue

        const neighbors = getNeighbors(startPoint.x, startPoint.y)
        for (let i = 0; i < neighbors.length; i++) {
            for (let j = i + 1; j < neighbors.length; j++) {
                const pathResult = findPathBetween(neighbors[i], neighbors[j], startPoint, skeleton, rows, cols, candidateJunctions)
                if (pathResult.found && pathResult.path.length >= 3) {
                    loopCount++
                    let maxDist = 0
                    let loopTop = pathResult.path[0]
                    for (const p of pathResult.path) {
                        const dist = Math.sqrt((p.x - startPoint.x) ** 2 + (p.y - startPoint.y) ** 2)
                        if (dist > maxDist) { maxDist = dist; loopTop = p }
                    }
                    const topKey = `${loopTop.x},${loopTop.y}`
                    if (!endpointSet.has(topKey) && !candidateSet.has(topKey)) loopTops.push(loopTop)
                    for (const p of pathResult.path) {
                        if (candidateSet.has(`${p.x},${p.y}`)) processedLoopPoints.add(`${p.x},${p.y}`)
                    }
                    processedLoopPoints.add(startKey)
                }
            }
        }
    }

    for (const junction of displayJunctions) {
        const jKey = `${junction.x},${junction.y}`
        if (processedLoopPoints.has(jKey)) continue

        const neighbors = getNeighbors(junction.x, junction.y)
        for (let i = 0; i < neighbors.length; i++) {
            for (let j = i + 1; j < neighbors.length; j++) {
                const pathResult = findPathBetween(neighbors[i], neighbors[j], junction, skeleton, rows, cols, candidateJunctions)
                if (pathResult.found && pathResult.path.length >= 3) {
                    loopCount++
                    let maxDist = 0
                    let loopTop = pathResult.path[0]
                    for (const p of pathResult.path) {
                        const dist = Math.sqrt((p.x - junction.x) ** 2 + (p.y - junction.y) ** 2)
                        if (dist > maxDist) { maxDist = dist; loopTop = p }
                    }
                    const topKey = `${loopTop.x},${loopTop.y}`
                    if (!endpointSet.has(topKey) && !candidateSet.has(topKey)) loopTops.push(loopTop)
                    processedLoopPoints.add(jKey)
                }
            }
        }
    }

    return {
        endpoints,
        junctions: candidateJunctions,
        branches,
        displayJunctions,
        loopTops,
        loopCount
    }
}

export function computeSkeletonWidthStats(skeleton: BinaryGrid, dt: FloatGrid): { meanRadius: number; varianceRadius: number } {
    const radii: number[] = []
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (skeleton[y][x] === 1) {
                radii.push(dt[y]?.[x] || 0)
            }
        }
    }

    if (radii.length === 0) return { meanRadius: 0, varianceRadius: 0 }

    const meanRadius = radii.reduce((a, b) => a + b, 0) / radii.length
    const varianceRadius = radii.reduce((sum, r) => sum + (r - meanRadius) ** 2, 0) / radii.length
    return { meanRadius, varianceRadius: Math.max(0, varianceRadius) }
}
