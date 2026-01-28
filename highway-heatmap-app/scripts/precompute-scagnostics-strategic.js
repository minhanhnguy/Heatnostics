/**
 * Script to precompute scagnostics for all highway-location pairs
 * with STRATEGIC assignments for K=0, K=1 and K=2 cases
 *
 * For 0 points: All scagnostic measures = 0 (no damage data - highway in good condition)
 *
 * For 1 point: All scagnostic measures = 0
 *
 * For 2 points:
 *   - Monotonic = 1 (2 points define a line)
 *   - Stringy = 1 (MST is just 1 edge)
 *   - Skinny = 1 (a line is skinny)
 *   - Outlying = 0 (no outlier)
 *   - Skewed = 0 (no distribution or group)
 *   - Clumpy = 0 (no cluster)
 *   - Convex = 1 (points fill the hull because the hull is a line)
 *   - Sparse = 0 (no sparsity)
 *   - Striated = 0 (need multiple lines for parallel detection)
 *
 * Run with: node scripts/precompute-scagnostics-strategic.js
 */

const fs = require('fs')
const path = require('path')
const Papa = require('papaparse')

// ============================================================
// SCAGNOSTICS COMPUTATION (copied from geometricUtils.ts)
// ============================================================

function distance(p1, p2) {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  return Math.sqrt(dx * dx + dy * dy)
}

function computeMST(points) {
  if (points.length < 2) return []

  const n = points.length
  const inMST = new Array(n).fill(false)
  const key = new Array(n).fill(Infinity)
  const parent = new Array(n).fill(-1)

  key[0] = 0

  for (let count = 0; count < n - 1; count++) {
    let minKey = Infinity
    let u = -1
    for (let v = 0; v < n; v++) {
      if (!inMST[v] && key[v] < minKey) {
        minKey = key[v]
        u = v
      }
    }

    if (u === -1) break
    inMST[u] = true

    for (let v = 0; v < n; v++) {
      if (!inMST[v]) {
        const dist = distance(points[u], points[v])
        if (dist < key[v]) {
          key[v] = dist
          parent[v] = u
        }
      }
    }
  }

  const edges = []
  for (let i = 1; i < n; i++) {
    if (parent[i] !== -1) {
      edges.push({
        p1: points[parent[i]],
        p2: points[i],
        length: distance(points[parent[i]], points[i])
      })
    }
  }

  return edges
}

function computeConvexHull(points) {
  if (points.length < 3) return [...points]

  let minIdx = 0
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < points[minIdx].y ||
      (points[i].y === points[minIdx].y && points[i].x < points[minIdx].x)) {
      minIdx = i
    }
  }

  const pivot = points[minIdx]

  const sorted = points
    .filter((_, i) => i !== minIdx)
    .map(p => ({
      point: p,
      angle: Math.atan2(p.y - pivot.y, p.x - pivot.x),
      dist: distance(pivot, p)
    }))
    .sort((a, b) => {
      if (Math.abs(a.angle - b.angle) < 1e-10) {
        return a.dist - b.dist
      }
      return a.angle - b.angle
    })
    .map(item => item.point)

  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  }

  const hull = [pivot]

  for (const p of sorted) {
    while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
      hull.pop()
    }
    hull.push(p)
  }

  return hull
}

// Simple Delaunay triangulation using Bowyer-Watson algorithm
function computeDelaunay(points) {
  if (points.length < 3) return { triangles: [], halfedges: [] }

  // Create super triangle
  const minX = Math.min(...points.map(p => p.x))
  const maxX = Math.max(...points.map(p => p.x))
  const minY = Math.min(...points.map(p => p.y))
  const maxY = Math.max(...points.map(p => p.y))

  const dx = maxX - minX
  const dy = maxY - minY
  const dmax = Math.max(dx, dy)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  const p1 = { x: midX - 20 * dmax, y: midY - dmax, idx: -1 }
  const p2 = { x: midX, y: midY + 20 * dmax, idx: -2 }
  const p3 = { x: midX + 20 * dmax, y: midY - dmax, idx: -3 }

  let triangles = [{ p1, p2, p3 }]

  // Add each point
  for (let i = 0; i < points.length; i++) {
    const p = { ...points[i], idx: i }
    const badTriangles = []

    // Find triangles whose circumcircle contains the point
    for (const tri of triangles) {
      if (isInsideCircumcircle(p, tri)) {
        badTriangles.push(tri)
      }
    }

    // Find boundary of polygonal hole
    const polygon = []
    for (const tri of badTriangles) {
      const edges = [
        [tri.p1, tri.p2],
        [tri.p2, tri.p3],
        [tri.p3, tri.p1]
      ]
      for (const edge of edges) {
        let shared = false
        for (const other of badTriangles) {
          if (other === tri) continue
          if (hasEdge(other, edge[0], edge[1])) {
            shared = true
            break
          }
        }
        if (!shared) {
          polygon.push(edge)
        }
      }
    }

    // Remove bad triangles
    triangles = triangles.filter(t => !badTriangles.includes(t))

    // Create new triangles
    for (const edge of polygon) {
      triangles.push({ p1: edge[0], p2: edge[1], p3: p })
    }
  }

  // Remove triangles with super triangle vertices
  triangles = triangles.filter(t =>
    t.p1.idx >= 0 && t.p2.idx >= 0 && t.p3.idx >= 0
  )

  return {
    triangles: triangles.flatMap(t => [t.p1.idx, t.p2.idx, t.p3.idx])
  }
}

function isInsideCircumcircle(p, tri) {
  const ax = tri.p1.x, ay = tri.p1.y
  const bx = tri.p2.x, by = tri.p2.y
  const cx = tri.p3.x, cy = tri.p3.y
  const dx = p.x, dy = p.y

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-10) return false

  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d

  const r2 = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy)
  const dist2 = (dx - ux) * (dx - ux) + (dy - uy) * (dy - uy)

  return dist2 < r2
}

function hasEdge(tri, p1, p2) {
  const pts = [tri.p1, tri.p2, tri.p3]
  let found1 = false, found2 = false
  for (const pt of pts) {
    if (pt.idx === p1.idx) found1 = true
    if (pt.idx === p2.idx) found2 = true
  }
  return found1 && found2
}

function computeAlphaShape(points, alpha) {
  if (points.length < 3) return [points]

  const delaunay = computeDelaunay(points)
  const triangles = []

  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    triangles.push([
      delaunay.triangles[i],
      delaunay.triangles[i + 1],
      delaunay.triangles[i + 2]
    ])
  }

  if (alpha === undefined) {
    const mstEdges = computeMST(points)
    if (mstEdges.length === 0) {
      alpha = 1
    } else {
      const lengths = mstEdges.map(e => e.length).sort((a, b) => a - b)
      const idx = Math.floor(lengths.length * 0.9)
      alpha = lengths[Math.min(idx, lengths.length - 1)] * 1.5
    }
  }

  const validTriangles = []

  for (const tri of triangles) {
    const p0 = points[tri[0]]
    const p1 = points[tri[1]]
    const p2 = points[tri[2]]

    const a = distance(p0, p1)
    const b = distance(p1, p2)
    const c = distance(p2, p0)
    const s = (a + b + c) / 2
    const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)))

    if (area > 1e-10) {
      const circumradius = (a * b * c) / (4 * area)
      if (circumradius <= alpha) {
        validTriangles.push(tri)
      }
    }
  }

  if (validTriangles.length === 0) {
    return [computeConvexHull(points)]
  }

  // Compute total area of valid triangles
  let totalArea = 0
  for (const tri of validTriangles) {
    const p0 = points[tri[0]]
    const p1 = points[tri[1]]
    const p2 = points[tri[2]]
    const a = distance(p0, p1)
    const b = distance(p1, p2)
    const c = distance(p2, p0)
    const s = (a + b + c) / 2
    totalArea += Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)))
  }

  return { polygons: [computeConvexHull(points)], area: totalArea }
}

function computePolygonArea(polygon) {
  if (polygon.length < 3) return 0
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    area += polygon[i].x * polygon[j].y
    area -= polygon[j].x * polygon[i].y
  }
  return Math.abs(area) / 2
}

function computePolygonPerimeter(polygon) {
  if (polygon.length < 2) return 0
  let perimeter = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    perimeter += distance(polygon[i], polygon[j])
  }
  return perimeter
}

function computeMSTDiameter(edges, points) {
  if (edges.length === 0 || points.length < 2) return 0

  const adj = new Map()

  const getPointIndex = (p) => {
    return points.findIndex(pt => pt.x === p.x && pt.y === p.y)
  }

  edges.forEach(e => {
    const i1 = getPointIndex(e.p1)
    const i2 = getPointIndex(e.p2)
    if (i1 === -1 || i2 === -1) return

    if (!adj.has(i1)) adj.set(i1, [])
    if (!adj.has(i2)) adj.set(i2, [])
    adj.get(i1).push({ neighbor: i2, dist: e.length })
    adj.get(i2).push({ neighbor: i1, dist: e.length })
  })

  const bfs = (start) => {
    const visited = new Set()
    const queue = [{ node: start, dist: 0 }]
    let farthest = start
    let maxDist = 0

    while (queue.length > 0) {
      const { node, dist } = queue.shift()
      if (visited.has(node)) continue
      visited.add(node)

      if (dist > maxDist) {
        maxDist = dist
        farthest = node
      }

      const neighbors = adj.get(node) || []
      for (const { neighbor, dist: edgeDist } of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push({ node: neighbor, dist: dist + edgeDist })
        }
      }
    }
    return { farthest, distance: maxDist }
  }

  const first = bfs(0)
  const second = bfs(first.farthest)
  return second.distance
}

function spearmanCorrelation(x, y) {
  if (x.length !== y.length || x.length < 3) return 0

  const n = x.length

  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
    const ranks = new Array(n)
    for (let i = 0; i < n; i++) {
      ranks[sorted[i].i] = i + 1
    }
    return ranks
  }

  const rankX = rank(x)
  const rankY = rank(y)

  let d2Sum = 0
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i]
    d2Sum += d * d
  }

  return 1 - (6 * d2Sum) / (n * (n * n - 1))
}

/**
 * Compute scagnostics with STRATEGIC assignments for edge cases
 *
 * For 0 points: All scagnostic measures = 0 (no damage data)
 *
 * For 1 point: All scagnostic measures = 0
 *
 * For 2 points:
 *   - Monotonic = 1 (2 points define a line)
 *   - Stringy = 1 (MST is just 1 edge)
 *   - Skinny = 1 (a line is skinny)
 *   - Outlying = 0 (no outlier)
 *   - Skewed = 0 (no distribution or group)
 *   - Clumpy = 0 (no cluster)
 *   - Convex = 1 (points fill the hull because the hull is a line)
 *   - Sparse = 0 (no sparsity)
 *   - Striated = 0 (need multiple lines for parallel detection)
 */
function computeScagnosticsStrategic(points) {
  // CASE 0: No points - all measures = 0 (highway in good condition, no damage)
  if (points.length === 0) {
    return {
      outlying: 0,
      skewed: 0,
      stringy: 0,
      sparse: 0,
      convex: 0,
      clumpy: 0,
      skinny: 0,
      striated: 0,
      monotonic: 0
    }
  }

  // CASE 1: Single point - all measures = 0
  if (points.length === 1) {
    return {
      outlying: 0,
      skewed: 0,
      stringy: 0,
      sparse: 0,
      convex: 0,
      clumpy: 0,
      skinny: 0,
      striated: 0,
      monotonic: 0
    }
  }

  // CASE 2: Two points - strategic assignments
  if (points.length === 2) {
    return {
      outlying: 0,   // No outlier possible with 2 points
      skewed: 0,     // No distribution or group
      stringy: 1,    // MST is just 1 edge - maximum stringiness
      sparse: 0,     // No sparsity - points are the only entities
      convex: 1,     // Points fill the hull (hull is a line)
      clumpy: 0,     // No cluster possible
      skinny: 1,     // A line is definitely skinny
      striated: 0,   // Need multiple lines for parallel detection
      monotonic: 1   // 2 points always define a perfect monotonic relationship
    }
  }

  // CASE 3: 3-4 points - compute normally but with adjusted expectations
  // For 3 points, some measures need special handling
  if (points.length < 5) {
    const mstEdges = computeMST(points)
    const hull = computeConvexHull(points)

    // For 3-4 points, alpha shape computation may be unstable
    let alphaArea = 0
    if (points.length >= 3) {
      const alphaResult = computeAlphaShape(points)
      alphaArea = alphaResult.area || 0
    }

    const edgeLengths = mstEdges.map(e => e.length).sort((a, b) => a - b)
    const totalMSTLength = edgeLengths.reduce((s, l) => s + l, 0)

    // With few points, quartiles may not be meaningful
    const q1Idx = Math.floor(edgeLengths.length * 0.25)
    const q3Idx = Math.floor(edgeLengths.length * 0.75)
    const q1 = edgeLengths[q1Idx] || 0
    const q3 = edgeLengths[q3Idx] || 0
    const iqr = q3 - q1

    // 1. OUTLYING
    const outlierThreshold = q3 + 1.5 * iqr
    const outlierLength = edgeLengths
      .filter(l => l > outlierThreshold)
      .reduce((s, l) => s + l, 0)
    const outlying = totalMSTLength > 0 ? Math.min(1, outlierLength / totalMSTLength) : 0

    // 2. SKEWED
    const meanEdge = totalMSTLength / Math.max(1, edgeLengths.length)
    const maxEdge = edgeLengths[edgeLengths.length - 1] || 1
    const skewed = 1 - (meanEdge / Math.max(meanEdge, maxEdge))

    // 3. STRINGY
    const diameter = computeMSTDiameter(mstEdges, points)
    const stringy = points.length > 1
      ? Math.min(1, diameter / (points.length - 1))
      : 0

    // 4. SPARSE & 5. CONVEX
    const hullArea = computePolygonArea(hull)
    const sparse = hullArea > 0 ? 1 - Math.min(1, alphaArea / hullArea) : 0
    const convex = hullArea > 0 ? Math.min(1, alphaArea / hullArea) : 0

    // 6. CLUMPY
    const shortThreshold = q1 - 1.5 * iqr
    const shortEdges = edgeLengths.filter(l => l < Math.max(0, shortThreshold))
    const clumpy = edgeLengths.length > 0
      ? shortEdges.length / edgeLengths.length
      : 0

    // 7. SKINNY
    const hullPerimeter = computePolygonPerimeter(hull)
    const skinnyRaw = alphaArea > 0
      ? (hullPerimeter * hullPerimeter) / (4 * Math.PI * alphaArea)
      : 1
    const skinny = Math.min(1, 1 - 1 / Math.max(1, skinnyRaw))

    // 8. STRIATED - with 3-4 points, striation detection is limited
    let striated = 0
    if (points.length >= 3) {
      const delaunay = computeDelaunay(points)
      const angles = []
      for (let i = 0; i < delaunay.triangles.length; i += 3) {
        for (let j = 0; j < 3; j++) {
          const p1 = points[delaunay.triangles[i + j]]
          const p2 = points[delaunay.triangles[i + (j + 1) % 3]]
          if (p1 && p2) {
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
            angles.push(angle)
          }
        }
      }
      const angleThreshold = 5 * Math.PI / 180
      let parallelCount = 0
      for (let i = 0; i < angles.length; i++) {
        for (let j = i + 1; j < angles.length; j++) {
          const diff = Math.abs(angles[i] - angles[j])
          if (diff < angleThreshold || Math.abs(diff - Math.PI) < angleThreshold) {
            parallelCount++
          }
        }
      }
      const maxPairs = (angles.length * (angles.length - 1)) / 2
      striated = maxPairs > 0 ? Math.min(1, parallelCount / maxPairs * 10) : 0
    }

    // 9. MONOTONIC - for 3+ points, compute Spearman correlation
    const xCoords = points.map(p => p.x)
    const yCoords = points.map(p => p.y)
    const monotonic = Math.abs(spearmanCorrelation(xCoords, yCoords))

    return {
      outlying: Math.max(0, Math.min(1, outlying)),
      skewed: Math.max(0, Math.min(1, skewed)),
      stringy: Math.max(0, Math.min(1, stringy)),
      sparse: Math.max(0, Math.min(1, sparse)),
      convex: Math.max(0, Math.min(1, convex)),
      clumpy: Math.max(0, Math.min(1, clumpy)),
      skinny: Math.max(0, Math.min(1, skinny)),
      striated: Math.max(0, Math.min(1, striated)),
      monotonic: Math.max(0, Math.min(1, monotonic))
    }
  }

  // CASE 4: 5+ points - standard computation
  const mstEdges = computeMST(points)
  const hull = computeConvexHull(points)
  const alphaResult = computeAlphaShape(points)
  const alphaArea = alphaResult.area || 0

  const edgeLengths = mstEdges.map(e => e.length).sort((a, b) => a - b)
  const totalMSTLength = edgeLengths.reduce((s, l) => s + l, 0)

  const q1Idx = Math.floor(edgeLengths.length * 0.25)
  const q3Idx = Math.floor(edgeLengths.length * 0.75)
  const q1 = edgeLengths[q1Idx] || 0
  const q3 = edgeLengths[q3Idx] || 0
  const iqr = q3 - q1

  // 1. OUTLYING
  const outlierThreshold = q3 + 1.5 * iqr
  const outlierLength = edgeLengths
    .filter(l => l > outlierThreshold)
    .reduce((s, l) => s + l, 0)
  const outlying = totalMSTLength > 0 ? Math.min(1, outlierLength / totalMSTLength) : 0

  // 2. SKEWED
  const meanEdge = totalMSTLength / Math.max(1, edgeLengths.length)
  const maxEdge = edgeLengths[edgeLengths.length - 1] || 1
  const skewed = 1 - (meanEdge / Math.max(meanEdge, maxEdge))

  // 3. STRINGY
  const diameter = computeMSTDiameter(mstEdges, points)
  const stringy = points.length > 1
    ? Math.min(1, diameter / (points.length - 1))
    : 0

  // 4. SPARSE & 5. CONVEX
  const hullArea = computePolygonArea(hull)
  const sparse = hullArea > 0 ? 1 - Math.min(1, alphaArea / hullArea) : 0
  const convex = hullArea > 0 ? Math.min(1, alphaArea / hullArea) : 0

  // 6. CLUMPY
  const shortThreshold = q1 - 1.5 * iqr
  const shortEdges = edgeLengths.filter(l => l < Math.max(0, shortThreshold))
  const clumpy = edgeLengths.length > 0
    ? shortEdges.length / edgeLengths.length
    : 0

  // 7. SKINNY
  const hullPerimeter = computePolygonPerimeter(hull)
  const skinnyRaw = alphaArea > 0
    ? (hullPerimeter * hullPerimeter) / (4 * Math.PI * alphaArea)
    : 1
  const skinny = Math.min(1, 1 - 1 / Math.max(1, skinnyRaw))

  // 8. STRIATED
  const delaunay = computeDelaunay(points)
  const angles = []
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const p1 = points[delaunay.triangles[i + j]]
      const p2 = points[delaunay.triangles[i + (j + 1) % 3]]
      if (p1 && p2) {
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
        angles.push(angle)
      }
    }
  }
  const angleThreshold = 5 * Math.PI / 180
  let parallelCount = 0
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      const diff = Math.abs(angles[i] - angles[j])
      if (diff < angleThreshold || Math.abs(diff - Math.PI) < angleThreshold) {
        parallelCount++
      }
    }
  }
  const maxPairs = (angles.length * (angles.length - 1)) / 2
  const striated = maxPairs > 0 ? Math.min(1, parallelCount / maxPairs * 10) : 0

  // 9. MONOTONIC
  const xCoords = points.map(p => p.x)
  const yCoords = points.map(p => p.y)
  const monotonic = Math.abs(spearmanCorrelation(xCoords, yCoords))

  return {
    outlying: Math.max(0, Math.min(1, outlying)),
    skewed: Math.max(0, Math.min(1, skewed)),
    stringy: Math.max(0, Math.min(1, stringy)),
    sparse: Math.max(0, Math.min(1, sparse)),
    convex: Math.max(0, Math.min(1, convex)),
    clumpy: Math.max(0, Math.min(1, clumpy)),
    skinny: Math.max(0, Math.min(1, skinny)),
    striated: Math.max(0, Math.min(1, striated)),
    monotonic: Math.max(0, Math.min(1, monotonic))
  }
}

function normalizePoints(points) {
  if (points.length === 0) return []
  if (points.length === 1) return [{ ...points[0], x: 0.5, y: 0.5 }]

  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity

  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1

  return points.map(p => ({
    ...p,
    x: (p.x - minX) / rangeX,
    y: (p.y - minY) / rangeY
  }))
}

function extractDamagePoints(features, maxScore = 49) {
  const points = []

  for (const f of features) {
    const props = f.properties || f
    const score = Number(props.TX_CONDITION_SCORE)

    if (isNaN(score) || score <= 0 || score > maxScore) continue

    const markerNbr = Number(props.TX_BEG_REF_MARKER_NBR) || 0
    const markerDisp = Number(props.TX_BEG_REF_MRKR_DISP) || 0
    const position = markerNbr + markerDisp

    const year = Number(props.EFF_YEAR) || 0
    if (year === 0) continue

    points.push({
      x: position,
      y: year,
      position,
      year,
      score
    })
  }

  return points
}

// ============================================================
// MAIN SCRIPT
// ============================================================

async function main() {
  console.log('='.repeat(60))
  console.log('Precomputing Scagnostics with Strategic K=3 Assignments')
  console.log('='.repeat(60))
  console.log('')
  console.log('Strategic assignments for edge cases:')
  console.log('  1 point:  All measures = 0')
  console.log('  2 points: monotonic=1, stringy=1, skinny=1, convex=1')
  console.log('            outlying=0, skewed=0, clumpy=0, sparse=0, striated=0')
  console.log('')

  console.log('Loading PMIS data...')

  const csvPath = path.join(__dirname, '../public/files/PMIS_combined.csv')
  const csvContent = fs.readFileSync(csvPath, 'utf-8')

  const parsed = Papa.parse(csvContent, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true
  })

  const features = parsed.data
  console.log(`Loaded ${features.length} features`)

  // Group by highway + county
  console.log('Grouping features by highway + county...')
  const groupedByCounty = new Map()
  const groupedByDistrict = new Map()

  for (const f of features) {
    const highway = f.TX_SIGNED_HIGHWAY_RDBD_ID
    const county = f.COUNTY
    const district = f.RESPONSIBLE_DISTRICT

    if (highway && county) {
      const formattedCounty = county.replace(/^\s*\d+\s*-\s*/, "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
      const key = `${highway}|${formattedCounty}`
      if (!groupedByCounty.has(key)) groupedByCounty.set(key, [])
      groupedByCounty.get(key).push(f)
    }

    if (highway && district) {
      const formattedDistrict = district.replace(/^\s*\d+\s*-\s*/, "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
      const key = `${highway}|${formattedDistrict}`
      if (!groupedByDistrict.has(key)) groupedByDistrict.set(key, [])
      groupedByDistrict.get(key).push(f)
    }
  }

  console.log(`Found ${groupedByCounty.size} highway-county pairs`)
  console.log(`Found ${groupedByDistrict.size} highway-district pairs`)

  const maxScore = 49
  const MIN_K = 0  // Include ALL cases, even 0-point (highways in good condition)

  // Compute scagnostics for K=3 STRATEGIC (county grouping)
  console.log('\nComputing STRATEGIC scagnostics for K>=0 (county grouping)...')
  const countyResultsStrategic = []
  let processed = 0
  let count0Point = 0
  let count1Point = 0
  let count2Point = 0
  let count3to4Point = 0
  let count5Plus = 0

  for (const [key, segments] of groupedByCounty) {
    const [highway, location] = key.split('|')
    const damagePoints = extractDamagePoints(segments, maxScore)

    if (damagePoints.length >= MIN_K) {
      const normalizedPoints = normalizePoints(damagePoints)
      const scag = computeScagnosticsStrategic(normalizedPoints)
      countyResultsStrategic.push({
        highway,
        location,
        pointCount: damagePoints.length,
        scagnostics: scag
      })

      // Track distribution
      if (damagePoints.length === 0) count0Point++
      else if (damagePoints.length === 1) count1Point++
      else if (damagePoints.length === 2) count2Point++
      else if (damagePoints.length <= 4) count3to4Point++
      else count5Plus++
    }

    processed++
    if (processed % 500 === 0) {
      console.log(`  Processed ${processed}/${groupedByCounty.size}...`)
    }
  }

  console.log(`Computed scagnostics for ${countyResultsStrategic.length} county pairs (K>=0)`)
  console.log(`  - 0 points (good condition): ${count0Point}`)
  console.log(`  - 1 point: ${count1Point}`)
  console.log(`  - 2 points: ${count2Point}`)
  console.log(`  - 3-4 points: ${count3to4Point}`)
  console.log(`  - 5+ points: ${count5Plus}`)

  // Compute scagnostics for K=3 STRATEGIC (district grouping)
  console.log('\nComputing STRATEGIC scagnostics for K>=0 (district grouping)...')
  const districtResultsStrategic = []
  processed = 0
  count0Point = 0
  count1Point = 0
  count2Point = 0
  count3to4Point = 0
  count5Plus = 0

  for (const [key, segments] of groupedByDistrict) {
    const [highway, location] = key.split('|')
    const damagePoints = extractDamagePoints(segments, maxScore)

    if (damagePoints.length >= MIN_K) {
      const normalizedPoints = normalizePoints(damagePoints)
      const scag = computeScagnosticsStrategic(normalizedPoints)
      districtResultsStrategic.push({
        highway,
        location,
        pointCount: damagePoints.length,
        scagnostics: scag
      })

      // Track distribution
      if (damagePoints.length === 0) count0Point++
      else if (damagePoints.length === 1) count1Point++
      else if (damagePoints.length === 2) count2Point++
      else if (damagePoints.length <= 4) count3to4Point++
      else count5Plus++
    }

    processed++
    if (processed % 500 === 0) {
      console.log(`  Processed ${processed}/${groupedByDistrict.size}...`)
    }
  }

  console.log(`Computed scagnostics for ${districtResultsStrategic.length} district pairs (K>=0)`)
  console.log(`  - 0 points (good condition): ${count0Point}`)
  console.log(`  - 1 point: ${count1Point}`)
  console.log(`  - 2 points: ${count2Point}`)
  console.log(`  - 3-4 points: ${count3to4Point}`)
  console.log(`  - 5+ points: ${count5Plus}`)

  // Save strategic K=3 results
  const outputPathStrategic = path.join(__dirname, '../public/files/scagnostics_precomputed_k3_strategic.json')
  const outputStrategic = {
    generatedAt: new Date().toISOString(),
    maxConditionScore: maxScore,
    minPointsK: 0,
    strategicAssignments: {
      description: 'Strategic scagnostic assignments for edge cases',
      zeroPoints: {
        all: 0,
        reason: 'No damage points - highway in good condition (all scores > 49)'
      },
      onePoint: {
        all: 0,
        reason: 'Single point has no shape characteristics'
      },
      twoPoints: {
        monotonic: 1,
        stringy: 1,
        skinny: 1,
        convex: 1,
        outlying: 0,
        skewed: 0,
        clumpy: 0,
        sparse: 0,
        striated: 0,
        reasons: {
          monotonic: '2 points define a line - perfect monotonic relationship',
          stringy: 'MST is just 1 edge - maximum stringiness',
          skinny: 'A line is definitely skinny',
          convex: 'Points fill the hull (hull is the line segment)',
          outlying: 'No outlier possible with only 2 points',
          skewed: 'No distribution or group to be skewed',
          clumpy: 'No cluster possible with 2 points',
          sparse: 'No sparsity - points are the only entities',
          striated: 'Need multiple lines for parallel detection'
        }
      }
    },
    county: countyResultsStrategic,
    district: districtResultsStrategic
  }

  fs.writeFileSync(outputPathStrategic, JSON.stringify(outputStrategic, null, 2))
  console.log(`\nSaved strategic K>=1 results to ${outputPathStrategic}`)
  console.log('Done!')
}

main().catch(console.error)
