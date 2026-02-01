/**
 * Scagnostics Module - Main scagnostic metrics computation
 */
import type { FloatGrid, BinaryGrid, Polyline, AllScagnostics } from '../types'
import { computeContinuousArea, computeContinuousPerimeter, computeSkinnyIQ } from './geometry'
import { euclideanDistanceTransform } from './distanceTransform'
import { zhangSuenThinning, pruneSkeletonBranches, computeSkeletonLongestPath, computeSkeletonArcLength, computeSkeletonWidthStats } from './skeleton'
import { computeStructureTensor, computeCircularVariance } from './orientation'
import { watershedBlobSegmentation, computeClumpyFromBlobs, countHoles, countConnectedComponents, countFilledCells } from './blobs'
import { spearmanCorrelation, computeOutlyingMahalanobis, computeSkewedPrincipalAxis, sampleSkeletonPath } from './statistics'

function computeStringySimple(longestPath: number, totalSkeletonLength: number): number {
    if (totalSkeletonLength <= 0) return 0
    return Math.min(1, longestPath / totalSkeletonLength)
}

/**
 * Compute all 9 scagnostic metrics
 */
export function computeAllScagnostics(
    floatGrid: FloatGrid,
    binaryGrid: BinaryGrid,
    contours: Polyline[],
    convexHull: Polyline
): AllScagnostics {
    const gridSize = floatGrid.length
    const diag = Math.sqrt(2) * gridSize

    // Basic geometry from all contours
    const area = contours.reduce((sum, c) => sum + computeContinuousArea(c), 0)
    const perimeter = contours.reduce((sum, c) => sum + computeContinuousPerimeter(c), 0)
    const hullArea = computeContinuousArea(convexHull)

    // Distance transform
    const dt = euclideanDistanceTransform(binaryGrid)

    // Skeleton with pruning
    const rawSkeleton = zhangSuenThinning(binaryGrid)
    const pruneLength = diag * 0.01
    const skeleton = pruneSkeletonBranches(rawSkeleton, pruneLength)

    const skeletonArcLength = computeSkeletonArcLength(skeleton)
    const { meanRadius } = computeSkeletonWidthStats(skeleton, dt)

    // Structure tensor for striated
    const { orientation } = computeStructureTensor(floatGrid, 5)
    const circularVar = computeCircularVariance(orientation, binaryGrid)

    // Blob segmentation for clumpy
    const filledPixels = countFilledCells(binaryGrid)
    const blobs = watershedBlobSegmentation(floatGrid, binaryGrid, 5)

    // 1. STRINGY
    const longestPath = computeSkeletonLongestPath(skeleton)
    const stringy = computeStringySimple(longestPath, skeletonArcLength)

    // 2. SPARSE
    const sparse = hullArea > 0 ? Math.max(0, Math.min(1, 1 - filledPixels / hullArea)) : 0

    // 3. CONVEX
    const convex = hullArea > 0 ? Math.min(1, area / hullArea) : 1

    // 4. SKINNY
    const skinny = computeSkinnyIQ(area, perimeter)

    // 5. CLUMPY
    const numComponents = countConnectedComponents(binaryGrid)
    const blobClumpy = computeClumpyFromBlobs(blobs, filledPixels)
    const componentClumpy = numComponents > 1 ? 1 - (1 / numComponents) : 0
    const clumpy = Math.max(blobClumpy, componentClumpy)

    // 6. OUTLYING
    const outlyingMahalanobis = computeOutlyingMahalanobis(floatGrid, binaryGrid)
    const outlying = outlyingMahalanobis

    // 7. STRIATED
    const striated = Math.max(0, Math.min(1, 1 - circularVar))

    // 8. SKEWED
    const skewed = computeSkewedPrincipalAxis(floatGrid, binaryGrid)

    // 9. MONOTONIC
    const samples = sampleSkeletonPath(skeleton, 50)
    let monotonic = 0
    if (samples.length >= 10) {
        const xCoords = samples.map(p => p.x)
        const yCoords = samples.map(p => p.y)
        const positions = samples.map((_, i) => i)
        const rhoX = Math.abs(spearmanCorrelation(positions, xCoords))
        const rhoY = Math.abs(spearmanCorrelation(positions, yCoords))
        monotonic = Math.max(rhoX, rhoY)
    }

    return {
        stringy, sparse, convex, skinny, clumpy,
        outlying, striated, skewed, monotonic
    }
}
