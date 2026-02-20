/**
 * Generate PWA icons for ALLMA
 * Run: bun run scripts/generate-icons.ts
 *
 * Creates brain emoji on dark background at all required sizes.
 * Uses HTML canvas via Bun's built-in support.
 */

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const MASKABLE_SIZES = [192, 512];
const BG_COLOR = "#1A1A2E";
const OUTPUT_DIR = "./web/icons";

// Generate SVG with brain emoji on dark background
function generateIconSVG(size: number, maskable: boolean = false): string {
  // For maskable icons, the emoji needs to be smaller (safe zone = inner 80%)
  const emojiSize = maskable ? size * 0.55 : size * 0.7;
  const yOffset = maskable ? size * 0.72 : size * 0.74;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.2}" fill="${BG_COLOR}"/>
  <text x="50%" y="${yOffset}" text-anchor="middle" font-size="${emojiSize}">🧠</text>
</svg>`;
}

async function main() {
  // Check if we can use resvg or sharp for proper PNG conversion
  // Fallback: write SVGs and use them directly (browsers support SVG icons)

  console.log(`Generating ALLMA PWA icons in ${OUTPUT_DIR}/`);

  // Try to generate PNGs using resvg-js (if available)
  let hasResvg = false;
  try {
    // @ts-ignore
    const { Resvg } = await import("@resvg/resvg-js");
    hasResvg = true;

    for (const size of SIZES) {
      const svg = generateIconSVG(size);
      const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
      const pngData = resvg.render();
      const pngBuffer = pngData.asPng();
      await Bun.write(`${OUTPUT_DIR}/icon-${size}.png`, pngBuffer);
      console.log(`  ✅ icon-${size}.png`);
    }

    for (const size of MASKABLE_SIZES) {
      const svg = generateIconSVG(size, true);
      const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
      const pngData = resvg.render();
      const pngBuffer = pngData.asPng();
      await Bun.write(`${OUTPUT_DIR}/icon-maskable-${size}.png`, pngBuffer);
      console.log(`  ✅ icon-maskable-${size}.png`);
    }
  } catch (e) {
    console.log("  resvg-js not available, generating SVG icons...");
  }

  if (!hasResvg) {
    // Fallback: write SVG files (all modern browsers support SVG in manifests)
    for (const size of SIZES) {
      const svg = generateIconSVG(size);
      await Bun.write(`${OUTPUT_DIR}/icon-${size}.svg`, svg);
      console.log(`  ✅ icon-${size}.svg`);
    }
    for (const size of MASKABLE_SIZES) {
      const svg = generateIconSVG(size, true);
      await Bun.write(`${OUTPUT_DIR}/icon-maskable-${size}.svg`, svg);
      console.log(`  ✅ icon-maskable-${size}.svg`);
    }

    // Also write a single master SVG
    const masterSvg = generateIconSVG(512);
    await Bun.write(`${OUTPUT_DIR}/icon.svg`, masterSvg);
    console.log(`  ✅ icon.svg (master)`);
  }

  console.log("\nDone! Icons generated in web/icons/");
}

main();
