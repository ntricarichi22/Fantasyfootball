// Client-side dominant-color extraction for uploaded team logos. Runs on a
// small canvas downsample; favors saturated mid-tone pixels so the pick is
// the logo's identity color, not its white background or black linework.
// Returns "#rrggbb" or null when nothing usable is found (e.g. grayscale art).

export async function dominantLogoColor(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const SIZE = 48;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

    type Bucket = { count: number; r: number; g: number; b: number; score: number };
    const buckets = new Map<number, Bucket>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 125) continue; // transparent
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const sat = max === 0 ? 0 : (max - min) / max;
      if (max > 0.92 && sat < 0.15) continue; // near-white background
      if (max < 0.08) continue; // near-black linework
      // 4 bits per channel keeps shades of one color in one bucket.
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, score: 0 };
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.score += 0.35 + sat; // saturation-weighted frequency
      buckets.set(key, bucket);
    }

    let best: Bucket | null = null;
    for (const bucket of buckets.values()) {
      if (!best || bucket.score > best.score) best = bucket;
    }
    if (!best) return null;
    const hex = (sum: number) =>
      Math.round(sum / best!.count)
        .toString(16)
        .padStart(2, "0");
    return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
  } catch {
    return null;
  }
}
