
const GRID_SIZE = 64;

// Mock types
type BinaryGrid = number[][];

// Mock basic helper functions needed for the pipeline
function createGrid(size: number): BinaryGrid {
    return Array.from({ length: size }, () => Array(size).fill(0));
}

function countFilledPixels(grid: BinaryGrid): number {
    let count = 0;
    for (let row of grid) for (let val of row) if (val === 1) count++;
    return count;
}

// ---------------------------------------------------------
// SIMULATED LOGIC FROM imageProcessing.ts (simplified)
// ---------------------------------------------------------

// Morphological dilation (simplified)
function dilate(grid: BinaryGrid, radius: number): BinaryGrid {
    const size = grid.length;
    const newGrid = createGrid(size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (grid[y][x] === 1) {
                // Draw circle
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        if (dx * dx + dy * dy <= radius * radius) {
                            const ny = y + dy, nx = x + dx;
                            if (ny >= 0 && ny < size && nx >= 0 && nx < size) newGrid[ny][nx] = 1;
                        }
                    }
                }
            }
        }
    }
    return newGrid;
}

// Morphological erosion (simplified)
function erode(grid: BinaryGrid, radius: number): BinaryGrid {
    const size = grid.length;
    const newGrid = createGrid(size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // Check if circle fits
            let fits = true;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (dx * dx + dy * dy <= radius * radius) {
                        const ny = y + dy, nx = x + dx;
                        if (ny < 0 || ny >= size || nx < 0 || nx >= size || grid[ny][nx] !== 1) {
                            fits = false;
                            break;
                        }
                    }
                }
                if (!fits) break;
            }
            if (fits) newGrid[y][x] = 1;
        }
    }
    return newGrid;
}

function morphologicalClosing(grid: BinaryGrid, radius: number): BinaryGrid {
    return erode(dilate(grid, radius), radius);
}

// Simple convex hull area approximation (bounding box for simplicity in this mock, 
// or simpler: just Count(Dilate(Grid, LargeRadius))?? 
// Actually let's just make a simple "fill gaps" for hull simulation 
// effectively: Hull Area = logical envelope area.
// For a line: Hull Area approx Length * Width.
// For a dotted line: Hull Area is same.
function mockHullArea(grid: BinaryGrid): number {
    let minX = GRID_SIZE, maxX = 0, minY = GRID_SIZE, maxY = 0;
    let count = 0;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (grid[y][x] === 1) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                count++;
            }
        }
    }
    if (count === 0) return 0;
    // Box approximation of hull
    return (maxX - minX + 1) * (maxY - minY + 1) * 0.7; // 0.7 fudge factor for convex hull vs box
}

function computeSparse(closedGrid: BinaryGrid, hullArea: number): number {
    const closedPixels = countFilledPixels(closedGrid);
    if (hullArea === 0) return 0;

    // My Mod: Uses closedGrid pixels
    const baseSparseness = 1 - (closedPixels / hullArea);
    return Math.max(0, Math.min(1, baseSparseness));
}

// ---------------------------------------------------------
// TEST CASES
// ---------------------------------------------------------

function runTest() {
    console.log("=== VERIFYING SPARSE METRIC UNITY ===");

    // 1. Solid Line
    const solidGrid = createGrid(GRID_SIZE);
    for (let x = 10; x < 54; x++) solidGrid[32][x] = 1; // Horizontal line

    // 2. Dotted Line (every 4th pixel)
    const dottedGrid = createGrid(GRID_SIZE);
    for (let x = 10; x < 54; x += 4) dottedGrid[32][x] = 1;

    // --- PIPELINE SIMULATION ---

    console.log("\n--- Scenario 1: Solid Line ---");
    const closingR2_Solid = morphologicalClosing(solidGrid, 2);
    const closingR4_Solid = morphologicalClosing(solidGrid, 4);

    const hullArea_Solid = mockHullArea(closingR2_Solid); // Hull is roughly same for both

    const sparseR2_Solid = computeSparse(closingR2_Solid, hullArea_Solid);
    const sparseR4_Solid = computeSparse(closingR4_Solid, hullArea_Solid);

    console.log(`Radius 2 (Shape) Sparse: ${sparseR2_Solid.toFixed(3)}`);
    console.log(`Radius 4 (Conn)  Sparse: ${sparseR4_Solid.toFixed(3)}`);

    console.log("\n--- Scenario 2: Dotted Line ---");
    const closingR2_Dotted = morphologicalClosing(dottedGrid, 2); // Might still have gaps
    const closingR4_Dotted = morphologicalClosing(dottedGrid, 4); // Should be solid

    const hullArea_Dotted = mockHullArea(closingR4_Dotted); // Use R4 hull (envelope)

    const sparseR2_Dotted = computeSparse(closingR2_Dotted, hullArea_Dotted);
    const sparseR4_Dotted = computeSparse(closingR4_Dotted, hullArea_Dotted);

    console.log(`Radius 2 (Shape) Pixels: ${countFilledPixels(closingR2_Dotted)}`);
    console.log(`Radius 4 (Conn)  Pixels: ${countFilledPixels(closingR4_Dotted)}`);
    console.log(`Hull Area: ${hullArea_Dotted}`);

    console.log(`Radius 2 (Shape) Sparse: ${sparseR2_Dotted.toFixed(3)} (Likely HIGH - BAD)`);
    console.log(`Radius 4 (Conn)  Sparse: ${sparseR4_Dotted.toFixed(3)} (Likely LOW - GOOD)`);

    // Check Separation
    console.log("\n--- Result Analysis ---");
    console.log(`Difference in Sparse (R2): ${Math.abs(sparseR2_Solid - sparseR2_Dotted).toFixed(3)}`);
    console.log(`Difference in Sparse (R4): ${Math.abs(sparseR4_Solid - sparseR4_Dotted).toFixed(3)}`);
}

runTest();
