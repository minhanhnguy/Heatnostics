/**
 * Shared types for Image Scagnostics Pipeline
 * Based on: image_scagnostics_pipeline2.tex
 */

export type FloatGrid = number[][]         // 0.0 to 1.0 (density)
export type BinaryGrid = number[][]        // 0 or 1
export interface Point { x: number; y: number }
export type Polyline = Point[]

export interface AllScagnostics {
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

/**
 * Extended scagnostics result with intermediate values
 */
export interface ExtendedScagnostics extends AllScagnostics {
    skeletonArcLength: number
    weightedSkeletonIntegral: number
    longestPath: number
    skeletonPixels: number
    numBranches: number
    numBlobs: number
    circularVariance: number
}

/**
 * Multi-scale scagnostics result
 */
export interface MultiScaleScagnostics {
    aggregated: AllScagnostics
    perThreshold: { percentile: number; metrics: AllScagnostics }[]
    slopes: Partial<AllScagnostics>
}

/**
 * Skeleton branch structure
 */
export interface SkeletonBranch {
    pixels: Point[]
    length: number
    meanRadius: number
    startPoint: Point
    endPoint: Point
}

/**
 * Blob structure for clumpy analysis
 */
export interface Blob {
    pixels: Point[]
    area: number
    centroid: Point
    peakValue: number
}
