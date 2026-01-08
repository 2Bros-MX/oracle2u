import { copyFileSync, mkdirSync, existsSync, readdirSync, renameSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distDir = resolve(__dirname, 'dist');

// Copy manifest.json to dist
const manifestSrc = resolve(__dirname, 'public/manifest.json');
const manifestDest = resolve(__dirname, 'dist/manifest.json');
copyFileSync(manifestSrc, manifestDest);
console.log('✓ Copied manifest.json to dist/');

// Copy all icon files from public to dist
const publicDir = resolve(__dirname, 'public');
if (existsSync(publicDir)) {
  const files = readdirSync(publicDir);
  files.forEach(file => {
    if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.svg')) {
      const src = join(publicDir, file);
      const dest = join(distDir, file);
      copyFileSync(src, dest);
      console.log(`✓ Copied ${file} to dist/`);
    }
  });
}

// Move popup HTML to popup folder
const popupDir = join(distDir, 'popup');
if (!existsSync(popupDir)) {
  mkdirSync(popupDir, { recursive: true });
}

const srcPopupDir = join(distDir, 'src', 'popup');
if (existsSync(srcPopupDir)) {
  const htmlSrc = join(srcPopupDir, 'index.html');
  const htmlDest = join(popupDir, 'index.html');
  if (existsSync(htmlSrc)) {
    copyFileSync(htmlSrc, htmlDest);
    console.log('✓ Moved popup/index.html to correct location');
  }
  
  // Clean up the src directory
  rmSync(join(distDir, 'src'), { recursive: true, force: true });
}

console.log('\n✓ Build post-processing complete!');
console.log('\nTo load the extension:');
console.log('1. Open chrome://extensions/');
console.log('2. Enable "Developer mode"');
console.log('3. Click "Load unpacked"');
console.log('4. Select the "dist" folder\n');
