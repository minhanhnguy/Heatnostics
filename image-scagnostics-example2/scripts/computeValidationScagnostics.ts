/**
 * Compute Image Scagnostics for Validation Dataset
 *
 * This script reads the validation dataset (synthetic patterns) and computes
 * image-theoretic scagnostics for each pattern, comparing with expected values.
 *
 * Usage: npx tsx scripts/computeValidationScagnostics.ts
 */

import * as fs from 'fs'
import * as path from 'path'

import {
    morphologicalClosing,
    fillInteriorHoles,
    contourConvexHull,
    euclideanDistanceTransform,
    findRidgePixels,
    computeScagnostics,
    type BinaryGrid,
    type ScagnosticsMetrics
} from '../src/lib/imageProcessing'








// ============================================================
// Main Processing
// ============================================================

const GRID_SIZE = 256
const CLOSING_RADIUS_CONNECTIVITY = 12
const CLOSING_RADIUS_SHAPE = 2

interface ValidationScatterplot {
    name: string
    category: string
    description: string
    expected_high: string[]
    expected_low: string[]
    n_points: number
    points: number[][]
}

interface ValidationDataset {
    scatterplots: ValidationScatterplot[]
}

interface ProcessedResult {
    name: string
    category: string
    description: string
    expected_high: string[]
    expected_low: string[]
    n_points: number
    scagnostics: ScagnosticsMetrics
    binaryGrid: number[][]
    validation: {
        metric: string
        expected: string
        actual: number
        pass: boolean
    }[]
}

function rasterizePoints(points: number[][], gridSize: number): BinaryGrid {
    const grid: BinaryGrid = Array.from({ length: gridSize }, () => Array(gridSize).fill(0))
    // Points in validation_dataset_large.json are already normalized to [0, 255]?
    // Let's assume they are in [0, 255] or [0, 100].
    // Actually, looking at previous code, it scaled by gridSize / 256.
    // If points are [0..255], and gridSize is 256, scale is 1.
    const scale = gridSize / 256

    for (const [x, y] of points) {
        const gx = Math.max(0, Math.min(gridSize - 1, Math.floor(x * scale)))
        const gy = Math.max(0, Math.min(gridSize - 1, Math.floor(y * scale))) // Y is often inverted in screen coords, but let's keep consistent
        grid[gy][gx] = 1
    }

    return grid
}

function processScatterplot(sp: ValidationScatterplot): ProcessedResult {
    // Rasterize
    const binaryGrid = rasterizePoints(sp.points, GRID_SIZE)

    // PIPELINE A: Connectivity (Radius 12)
    // Good for: Stringy, Sparse, Clumpy (detection), Skewed, Skinny
    const closedGridConnectivity = morphologicalClosing(binaryGrid, CLOSING_RADIUS_CONNECTIVITY)
    const hullGridConnectivity = contourConvexHull(closedGridConnectivity)
    const dtConnectivity = euclideanDistanceTransform(closedGridConnectivity)
    const ridgeGridConnectivity = findRidgePixels(dtConnectivity, closedGridConnectivity)
    // Pass binaryGrid as 4th argument (was 5th) for proper Sparse calculation
    // Note: computeScagnostics from library does NOT take 'dt' as argument
    const metricsConnectivity = computeScagnostics(closedGridConnectivity, hullGridConnectivity, ridgeGridConnectivity, binaryGrid)

    // PIPELINE B: Shape (Radius 2)
    // Good for: Convex, Striated, Monotonic, Outlying
    // ALWAYS fill interior holes for Shape pipeline to stabilize area-based metrics (Convex, Outlying)
    const closedMorphShape = morphologicalClosing(binaryGrid, CLOSING_RADIUS_SHAPE)
    const closedGridShape = fillInteriorHoles(closedMorphShape)

    const hullGridShape = contourConvexHull(closedGridShape)
    const dtShape = euclideanDistanceTransform(closedGridShape)
    const ridgeGridShape = findRidgePixels(dtShape, closedGridShape)
    // Pass binaryGrid as 4th argument (was 5th) for proper Sparse calculation
    // Note: computeScagnostics from library does NOT take 'dt' as argument
    const metricsShape = computeScagnostics(closedGridShape, hullGridShape, ridgeGridShape, binaryGrid)

    // Merge metrics
    const scagnostics: ScagnosticsMetrics = {
        // From Shape (Radius 2)
        convex: metricsShape.convex,
        striated: metricsShape.striated,
        monotonic: metricsShape.monotonic,
        clumpy: metricsShape.clumpy, // Usually better with finer detail
        outlying: metricsShape.outlying, // Needs to see small separated points

        // From Connectivity (Radius 12) - keeps "dotted lines" connected
        stringy: metricsConnectivity.stringy,
        sparse: metricsConnectivity.sparse,
        skewed: metricsConnectivity.skewed,
        skinny: metricsConnectivity.skinny
    }

    // Validate expectations
    const validation: ProcessedResult['validation'] = []

    for (const metric of sp.expected_high) {
        const value = scagnostics[metric as keyof ScagnosticsMetrics]
        validation.push({
            metric,
            expected: 'high',
            actual: value,
            pass: value > 0.4  // Threshold for "high"
        })
    }

    for (const metric of sp.expected_low) {
        const value = scagnostics[metric as keyof ScagnosticsMetrics]
        validation.push({
            metric,
            expected: 'low',
            actual: value,
            pass: value < 0.4  // Threshold for "low"
        })
    }

    return {
        name: sp.name,
        category: sp.category,
        description: sp.description,
        expected_high: sp.expected_high,
        expected_low: sp.expected_low,
        n_points: sp.n_points,
        scagnostics,
        binaryGrid: binaryGrid, // Store raw grid for visualization
        validation
    }
}

async function main() {
    console.log('Validation Dataset Image Scagnostics Computation')
    console.log('='.repeat(50) + '\n')

    // Read validation dataset
    const dataPath = path.join(__dirname, '../public/validation_dataset_large.json')

    if (!fs.existsSync(dataPath)) {
        console.error(`Error: Validation dataset not found at ${dataPath}`)
        process.exit(1)
    }

    const dataset: ValidationDataset = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    console.log(`Loaded ${dataset.scatterplots.length} validation patterns\n`)

    const results: ProcessedResult[] = []
    let passCount = 0
    let totalChecks = 0

    // const startIdx = 0
    // const endIdx = 1000 // Process all

    for (const sp of dataset.scatterplots) {
        // console.log(`Processing ${sp.name}...`)
        const result = processScatterplot(sp)
        results.push(result)

        // Count validations
        for (const v of result.validation) {
            totalChecks++
            if (v.pass) passCount++
        }
    }

    // Print results by category
    const categories = [...new Set(results.map(r => r.category))]

    for (const cat of categories) {
        console.log(`\n--- ${cat.toUpperCase()} ---`)
        const catResults = results.filter(r => r.category === cat)

        // Print summary average for category
        const avgMetrics: any = {}
        for (const k of Object.keys(catResults[0].scagnostics)) {
            const sum = catResults.reduce((s, r) => s + (r.scagnostics as any)[k], 0)
            avgMetrics[k] = (sum / catResults.length).toFixed(3)
        }
        console.log(`Average Metrics:`, avgMetrics)

        // Debug output for first few
        // for (const r of catResults.slice(0, 3)) {
        //     console.log(`\n${r.name}:`)
        //     console.log(`  Metrics: str=${r.scagnostics.stringy}, spa=${r.scagnostics.sparse}, cvx=${r.scagnostics.convex}`)
        // }
    }

    console.log('\n' + '='.repeat(50))
    console.log(`Overall Validation: ${passCount}/${totalChecks} checks passed (${(passCount / totalChecks * 100).toFixed(1)}%)`)

    // Save results
    const output = {
        generatedAt: new Date().toISOString(),
        gridSize: GRID_SIZE,
        pipeline: "dual-radius (connectivity=4, shape=2)",
        totalPatterns: results.length,
        validationSummary: {
            passed: passCount,
            total: totalChecks,
            percentage: Math.round(passCount / totalChecks * 1000) / 10
        },
        results
    }

    const outputPath = path.join(__dirname, '../public/data/precomputed_scagnostics.json')
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))

    console.log(`\nSaved to: ${outputPath}`)
    console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`)
}

main().catch(console.error)
