import multer from 'multer';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import sharp from 'sharp';
import { createHash } from 'crypto';

const UPLOAD_MAX_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE) || 5242880;
const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';

if (!existsSync(UPLOAD_PATH)) {
  mkdirSync(UPLOAD_PATH, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_PATH);
  },
  filename: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo di file non supportato. Usa JPG, PNG o WEBP.'), false);
  }
}

const upload = multer({
  storage,
  limits: { fileSize: UPLOAD_MAX_SIZE, files: 5 },
  fileFilter,
});

// Middleware post-upload per processare con Sharp e calcolare SHA256
export async function processUpload(req, res, next) {
  if (!req.files || req.files.length === 0) return next();

  for (const file of req.files) {
    try {
      const inputPath = join(UPLOAD_PATH, file.filename);
      const outputPath = join(UPLOAD_PATH, `proc_${file.filename}`);

      await sharp(inputPath)
        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .withMetadata({ exif: {} }) // strip EXIF
        .toFile(outputPath);

      // Replace original with processed
      const fs = await import('fs/promises');
      await fs.unlink(inputPath);
      await fs.rename(outputPath, inputPath);

      // Calculate SHA256
      const content = await fs.readFile(inputPath);
      file.sha256 = createHash('sha256').update(content).digest('hex');
      file.mimetype = 'image/jpeg';
    } catch (err) {
      return next(err);
    }
  }

  next();
}

export default upload;
