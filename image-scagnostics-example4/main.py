import json
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import matplotlib.colors as mcolors
import os
import glob
import numpy as np

def get_color(score):
    if score >= 90: return "#15803d"    # Very Good - Dark Green
    if score >= 70: return "#22c55e"    # Good - Green
    if score >= 50: return "#eab308"    # Fair - Yellow
    if score >= 35: return "#f97316"    # Poor - Orange
    if score < 1:   return "#c8c8c8"    # Invalid - Gray
    return "#ef4444"                    # Very Poor - Red

def get_common_data(data):
    """
    Extracts common data needed for plotting (years, min/max pos).
    """
    years = sorted(list(set(d['year'] for d in data)))
    if not years:
        return None, None, None, None, None
    min_year, max_year = min(years), max(years)

    positions = [d.get('position', 0) for d in data] + [d.get('endPosition', 0) for d in data]
    positions = [p for p in positions if p is not None]
    
    if not positions:
        return None, None, None, None, None
    min_pos, max_pos = min(positions), max(positions)
    
    return years, min_year, max_year, min_pos, max_pos

def save_faithful_heatmap(data, output_path, years, min_year, max_year, min_pos, max_pos):
    """
    Generates the Faithful Heatmap (Discrete Colors, Grid/Axes).
    Saved with prefix 0.
    """
    # Use larger figure size as in the notebook for faithful representation
    fig = plt.figure(figsize=(15, 10))
    ax = plt.gca()

    height_per_year = 0.8

    for d in data:
        year = d.get('year')
        start_pos = d.get('position')
        end_pos = d.get('endPosition')
        score = d.get('score', 0)
        
        if year is None or start_pos is None or end_pos is None:
            continue

        color = get_color(score)
        
        width = end_pos - start_pos
        if width <= 0: width = 0.05
        
        rect = patches.Rectangle(
            (start_pos, year - height_per_year/2),
            width,
            height_per_year,
            linewidth=0,
            facecolor=color
        )
        ax.add_patch(rect)

    ax.set_xlim(min_pos, max_pos)
    ax.set_ylim(min_year - 0.5, max_year + 0.5)
    ax.set_yticks(years)
    ax.set_yticklabels(years)
    plt.xlabel("Segment (Position)")
    plt.ylabel("Year")
    plt.title("Heatmap of Scores (Faithful Replica)")
    plt.tight_layout()
    
    plt.savefig(output_path)
    plt.close(fig)
    print(f"Saved faithful heatmap to {output_path}")

def save_normalized_heatmap(data, output_path, years, min_year, max_year, min_pos, max_pos):
    """
    Generates the Normalized Heatmap (Grayscale, 512x512, No Axes).
    Saved with prefix 1.
    """
    # Set dimensions to 512x512 pixels
    dpi = 100
    fig_size_inches = 512 / dpi

    fig = plt.figure(figsize=(fig_size_inches, fig_size_inches), dpi=dpi)
    ax = plt.gca()
    # Make axis fill the entire figure (no margins)
    ax.set_position([0, 0, 1, 1])

    height_per_year = 1.0 # Use 1.0 for solid coverage

    for d in data:
        year = d.get('year')
        start_pos = d.get('position')
        end_pos = d.get('endPosition')
        score = d.get('score', 0)
        
        if year is None or start_pos is None or end_pos is None:
            continue
            
        if score == 0:
            continue
            
        # Transform score to 0..1 floating point
        val = 1.0 - (score / 100.0)
        color = plt.cm.Greys(val)
        
        width = end_pos - start_pos
        if width <= 0: width = 0.05
        
        rect = patches.Rectangle(
            (start_pos, year - height_per_year/2),
            width,
            height_per_year,
            linewidth=0,
            facecolor=color
        )
        ax.add_patch(rect)

    ax.set_xlim(min_pos, max_pos)
    ax.set_ylim(min_year - 0.5, max_year + 0.5)

    # Remove grid, axis, and all decorations
    ax.axis('off')

    plt.savefig(output_path, dpi=dpi, pad_inches=0)
    plt.close(fig)
    print(f"Saved normalized heatmap to {output_path}")

def process_file(json_path, output_dir):
    try:
        with open(json_path, 'r') as f:
            data_json = json.load(f)
    except Exception as e:
        print(f"Error loading {json_path}: {e}")
        return

    data = data_json.get('data', [])
    if not data:
        print(f"No 'data' field found in {json_path}")
        return

    years, min_year, max_year, min_pos, max_pos = get_common_data(data)
    if years is None:
        print(f"Insufficient data in {json_path}")
        return

    base_name = os.path.basename(json_path)
    name_no_ext = os.path.splitext(base_name)[0]
    
    # Generate 0. prefix (Faithful)
    output_path_0 = os.path.join(output_dir, f"0.{name_no_ext}.png")
    save_faithful_heatmap(data, output_path_0, years, min_year, max_year, min_pos, max_pos)

    # Generate 1. prefix (Normalized)
    output_path_1 = os.path.join(output_dir, f"1.{name_no_ext}.png")
    save_normalized_heatmap(data, output_path_1, years, min_year, max_year, min_pos, max_pos)

def main():
    # Define directories
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, 'data')
    output_dir = os.path.join(base_dir, 'output')

    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    # Find JSON files
    json_pattern = os.path.join(data_dir, '*.json')
    json_files = glob.glob(json_pattern)
    
    if not json_files:
        print(f"No JSON files found in {data_dir}")
        return

    print(f"Found {len(json_files)} JSON file(s). Processing...")

    for json_file in json_files:
        process_file(json_file, output_dir)

def create_smoothed_image(input_path, output_path, sigma=0.75):
    """
    Applies Gaussian smoothing to an image file.
    """
    try:
        import scipy.ndimage
        import matplotlib.image as mpimg
    except ImportError as e:
        print(f"Error importing libraries for smoothing: {e}")
        return

    # Load image
    img = mpimg.imread(input_path)
    
    # Check if image has alpha channel, if so, strip it or handle it
    # Matplotlib usually saves as RGBA 0-1 float or 0-255 uint8
    if img.ndim == 3 and img.shape[2] == 4:
         # Convert RGBA to Grayscale if needed, or just blur all channels (including alpha?)
         # Usually for scagnostics we care about the pattern. 
         # The 1. images are Grayscale saved as PNG (likely RGBA or RGB).
         # Let's take the first channel since it's grayscale.
         img_gray = img[:, :, 0]
    elif img.ndim == 3:
         img_gray = img[:, :, 0]
    else:
         img_gray = img

    # Apply Gaussian filter
    # User specified sigma=0.75 for heatmaps
    smoothed = scipy.ndimage.gaussian_filter(img_gray, sigma=sigma)

    # Save output
    # Ensure it's saved in a way that preserves the 0-1 range or scales correctly.
    # We can use plt.imsave
    plt.imsave(output_path, smoothed, cmap='gray', vmin=0, vmax=1)
    print(f"Saved smoothed heatmap to {output_path}")

def process_file(json_path, output_dir):
    try:
        with open(json_path, 'r') as f:
            data_json = json.load(f)
    except Exception as e:
        print(f"Error loading {json_path}: {e}")
        return

    data = data_json.get('data', [])
    if not data:
        print(f"No 'data' field found in {json_path}")
        return

    years, min_year, max_year, min_pos, max_pos = get_common_data(data)
    if years is None:
        print(f"Insufficient data in {json_path}")
        return

    base_name = os.path.basename(json_path)
    name_no_ext = os.path.splitext(base_name)[0]
    
    # Generate 0. prefix (Faithful)
    output_path_0 = os.path.join(output_dir, f"1.input.png")
    save_faithful_heatmap(data, output_path_0, years, min_year, max_year, min_pos, max_pos)

    # Generate 1. prefix (Normalized)
    output_path_1 = os.path.join(output_dir, f"2.normalization.png")
    save_normalized_heatmap(data, output_path_1, years, min_year, max_year, min_pos, max_pos)

    # Generate 2. prefix (Smoothed)
    # Using sigma=0.75 for heatmaps as requested
    output_path_2 = os.path.join(output_dir, f"3.gaussian_smoothing.png")
    create_smoothed_image(output_path_1, output_path_2, sigma=1.5)

    # Generate 3. prefix (Contour)
    output_path_3 = os.path.join(output_dir, f"4.contour.png")
    create_contour_image(output_path_2, output_path_3, percentile=75)

def create_contour_image(input_path, output_path, percentile=75):
    """
    Thresholds the image at the given percentile of non-zero values.
    Saves a binary image (0 or 1).
    """
    try:
        import matplotlib.image as mpimg
        import numpy as np
    except ImportError as e:
        print(f"Error importing libraries: {e}")
        return

    # Load image
    img = mpimg.imread(input_path)
    if img.ndim == 3:
        img = img[:, :, 0] # Assume grayscale

    # Filter non-zero values
    non_zero_values = img[img > 0]
    
    if len(non_zero_values) == 0:
        print(f"No non-zero values in {input_path}")
        return

    # Calculate threshold
    threshold = np.percentile(non_zero_values, percentile)
    
    # Apply threshold
    binary = (img >= threshold).astype(float)
    
    # Save
    plt.imsave(output_path, binary, cmap='gray', vmin=0, vmax=1)
    print(f"Saved contour (binary) image to {output_path}")

if __name__ == "__main__":
    main()
