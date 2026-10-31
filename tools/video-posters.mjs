// Gera o poster AVIF de cada vídeo a partir do primeiro frame.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const dir = `${ROOT}/public/video`;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.mp4'))) {
  const frame = execFileSync('ffmpeg', ['-v', 'error', '-i', `${dir}/${file}`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 28 });
  await sharp(frame).resize({ width: 1100, withoutEnlargement: true }).avif({ quality: 66, effort: 6 }).toFile(`${dir}/${file.replace('.mp4', '.avif')}`);
}
