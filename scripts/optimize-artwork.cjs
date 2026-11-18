const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');

// Keep original photographs/alpha layers unchanged. Next.js handles delivery sizes
// and compression; only prepare the blur that would otherwise run during motion.
const source = path.join(__dirname, '../public/images');
const output = path.join(source, 'optimized');
const softLayers = [
  ['distant-desert', 'distant-desert.png', 13],
  ['sky', 'sky.jpeg', 5],
  ['dunes', 'dunes_bg.jpeg', 3],
];

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const assets = [];
  for (const [name, file, blur] of softLayers) {
    const input = path.join(source, file);
    const { width } = await sharp(input).metadata();
    const target = path.join(output, `${name}-soft.webp`);
    await sharp(input).resize({ width: 1600, withoutEnlargement: true })
      .blur(blur * Math.min(1600, width) / width)
      .webp({ lossless: true, effort: 6 }).toFile(target);
    assets.push({ file: path.basename(target), bytes: fs.statSync(target).size });
  }
  // Remove only this generator's obsolete exports, never original source files.
  const obsolete = /^(distant-desert|foreground-dune|sky|dunes|camel|scene)(-soft)?-(800|1600|original)\.webp$/;
  for (const file of fs.readdirSync(output)) {
    if (obsolete.test(file)) fs.unlinkSync(path.join(output, file));
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ delivery: 'Next.js Image, WebP quality 80', assets }, null, 2) + '\n');
  console.log(JSON.stringify(assets));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
