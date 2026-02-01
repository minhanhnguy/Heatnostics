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

    return current
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

export function computeSkeletonLongestPathData(skeleton: BinaryGrid): Point[] {
    const endpoints = getSkeletonEndpoints(skeleton)
    if (endpoints.length === 0) return []

    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    const bfs = (start: Point): Point[] => {
        const visited = new Set<string>()
        const queue: { p: Point; path: Point[] }[] = [{ p: start, path: [start] }]
        let longest: Point[] = []

        while (queue.length > 0) {
            const { p, path } = queue.shift()!
            const key = `${p.x},${p.y}`
            if (visited.has(key)) continue
            visited.add(key)

            if (path.length > longest.length) longest = path

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = p.x + dx
                    const ny = p.y + dy
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                        skeleton[ny][nx] === 1 && !visited.has(`${nx},${ny}`)) {
                        queue.push({ p: { x: nx, y: ny }, path: [...path, { x: nx, y: ny }] })
                    }
                }
            }
        }
        return longest
    }

    let maxPath: Point[] = []
    for (const ep of endpoints) {
        const path = bfs(ep)
        if (path.length > maxPath.length) maxPath = path
    }
    return maxPath
}

export function computeSkeletonLongestPath(skeleton: BinaryGrid): number {
    const endpoints = getSkeletonEndpoints(skeleton)
    if (endpoints.length === 0) return 0

    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    const bfs = (start: Point): number => {
        const visited = new Set<string>()
        const queue: { p: Point; dist: number }[] = [{ p: start, dist: 0 }]
        let maxDist = 0

        while (queue.length > 0) {
            const { p, dist } = queue.shift()!
            const key = `${p.x},${p.y}`
            if (visited.has(key)) continue
            visited.add(key)
            maxDist = Math.max(maxDist, dist)

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = p.x + dx
                    const ny = p.y + dy
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                        skeleton[ny][nx] === 1 && !visited.has(`${nx},${ny}`)) {
                        const edgeDist = (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1
                        queue.push({ p: { x: nx, y: ny }, dist: dist + edgeDist })
                    }
                }
            }
        }
        return maxDist
    }

    let longestPath = 0
    for (const ep of endpoints) {
        longestPath = Math.max(longestPath, bfs(ep))
    }
    return longestPath
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

export function analyzeSkeletonTopology(skeleton: BinaryGrid, dt: FloatGrid): SkeletonTopology {
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
            let radiusSum = dt[startNode.y]?.[startNode.x] || 0
            let iterations = 0

            while (iterations < rows * cols) {
                iterations++
                pixels.push(current)
                radiusSum += dt[current.y]?.[current.x] || 0

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
