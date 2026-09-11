const multer = require('multer');
const path = require('path');

// Use memory storage for Vercel/serverless
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/bmp',
    'image/tiff',
    'image/heic',
    'image/heif',
  ]);

  const allowedExtensions = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.avif',
    '.bmp',
    '.tif',
    '.tiff',
    '.heic',
    '.heif',
  ]);

  const extension = path
    .extname(file.originalname || '')
    .toLowerCase();

  const mimeType = (file.mimetype || '').toLowerCase();

  const extensionAllowed = allowedExtensions.has(extension);
  const mimeAllowed = allowedMimeTypes.has(mimeType);

  // Both extension AND MIME type must be valid.
  if (extensionAllowed && mimeAllowed) {
    return cb(null, true);
  }

  const error = new Error(
    'Only supported image files (JPG, PNG, WEBP, GIF, AVIF, BMP, TIFF, HEIC) are allowed.'
  );

  error.code = 'INVALID_FILE_TYPE';

  return cb(error);
};

const maxUploadMB = Number.parseInt(
  process.env.MAX_UPLOAD_MB || '10',
  10
);

const safeMaxUploadMB =
  Number.isFinite(maxUploadMB) && maxUploadMB > 0
    ? maxUploadMB
    : 10;

const upload = multer({
  storage,
  limits: {
    fileSize: safeMaxUploadMB * 1024 * 1024,
    files: 1,
  },
  fileFilter,
});

module.exports = upload;
