import { writeFileSync, mkdirSync } from 'fs';
import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const outDir = join(__dirname, '..', 'public', 'icons');

mkdirSync(outDir, { recursive: true });

const svg = `\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n  <rect width="512" height="512" rx="128" fill="#3B82F6"/>\n  <text x="256" y="350" font-family="Arial, Helvetica, sans-serif" font-size="280" font-weight="bold" fill="white" text-anchor="middle">R</text>\n</svg>\n`;

async function generate() {
  for (const size of sizes) {
    const file = join(outDir, `icon-${size}x${size}.png`);
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
    console.log('Generated', file);
  }

  const maskableSvg = `\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n  <rect width="512" height="512" fill="#3B82F6"/>\n  <text x="256" y="350" font-family="Arial, Helvetica, sans-serif" font-size="220" font-weight="bold" fill="white" text-anchor="middle">R</text>\n</svg>\n`;
  const maskableFile = join(outDir, 'icon-maskable-192x192.png');
  await sharp(Buffer.from(maskableSvg)).resize(192, 192).png().toFile(maskableFile);
  console.log('Generated', maskableFile);

  console.log('Done.');
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
