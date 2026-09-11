const sharp = require('sharp');
const sharpService = require('../services/sharpService');
const logger = require('../utils/logger');

const mimeMap = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};

const MAX_IMAGE_WIDTH = 20000;
const MAX_IMAGE_HEIGHT = 20000;
const MAX_IMAGE_PIXELS = 100_000_000; // 100 megapixels

const ALLOWED_CONVERT_FIELDS = new Set([
  'format',
  'quality',
]);

const ALLOWED_COMPRESS_FIELDS = new Set([
  'quality',
  'targetKB',
]);

const ALLOWED_RESIZE_FIELDS = new Set([
  'width',
  'height',
  'maintainAspect',
]);

function hasOnlyAllowedFields(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  return Object.keys(body).every((key) => allowedFields.has(key));
}

const validateImageBuffer = async (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid image data.');
  }

  const metadata = await sharp(buffer, {
    limitInputPixels: MAX_IMAGE_PIXELS,
  }).metadata();

  if (!metadata.format) {
    throw new Error('Invalid or unsupported image file.');
  }

  const allowedFormats = new Set([
    'jpeg',
    'png',
    'webp',
    'gif',
    'avif',
    'bmp',
    'tiff',
    'heif',
  ]);

  if (!allowedFormats.has(metadata.format)) {
    throw new Error('Unsupported image format.');
  }

  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (!width || !height) {
    throw new Error('Unable to determine image dimensions.');
  }

  if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
    throw new Error(
      `Image dimensions are too large. Maximum allowed dimensions are ${MAX_IMAGE_WIDTH} × ${MAX_IMAGE_HEIGHT} pixels.`
    );
  }

  const totalPixels = width * height;

  if (totalPixels > MAX_IMAGE_PIXELS) {
    throw new Error(
      'Image contains too many pixels and cannot be processed safely.'
    );
  }

  return metadata;
};

const getSafeImageError = (err) => {
  const message = err?.message || '';

  if (message === 'Invalid image data.') {
    return 'Invalid image data.';
  }

  if (message === 'Invalid or unsupported image file.') {
    return 'Invalid or unsupported image file.';
  }

  if (message === 'Unsupported image format.') {
    return 'Unsupported image format.';
  }

  if (message === 'Unable to determine image dimensions.') {
    return 'Unable to determine image dimensions.';
  }

  if (message.startsWith('Image dimensions are too large')) {
    return 'Image dimensions are too large. Maximum allowed dimensions are 20000 × 20000 pixels.';
  }

  if (message === 'Image contains too many pixels and cannot be processed safely.') {
    return 'Image contains too many pixels and cannot be processed safely.';
  }

  return null;
};

exports.convertImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    await validateImageBuffer(req.file.buffer);

    if (!hasOnlyAllowedFields(req.body, ALLOWED_CONVERT_FIELDS)) {
      return res.status(400).json({
        success: false,
        error: 'Unexpected request fields.',
      });
    }

    const {
      format: requestedFormat = 'png',
      quality: requestedQuality = 80,
    } = req.body;

    const format = String(requestedFormat).trim().toLowerCase();
    const quality = Number(requestedQuality);

    if (!Object.prototype.hasOwnProperty.call(mimeMap, format)) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported output image format.',
      });
    }

    if (
      !Number.isInteger(quality) ||
      quality < 1 ||
      quality > 100
    ) {
      return res.status(400).json({
        success: false,
        error: 'Quality must be an integer between 1 and 100.',
      });
    }

    // ✅ Pass buffer instead of file path
    const outputBuffer = await sharpService.convertImage(req.file.buffer, format, { quality });

    // ✅ Send buffer directly, no disk needed
    res.set('Content-Type', mimeMap[format] || 'image/png');
    res.set('Content-Disposition', `attachment; filename="converted.${format}"`);
    res.send(outputBuffer);

  } catch (err) {
    logger.error('Image conversion failed', {
      requestId: req.requestId,
      errorCategory: 'IMAGE_PROCESSING',
      error: err,
    });

    const safeError = getSafeImageError(err);

    return res.status(safeError ? 400 : 500).json({
      success: false,
      error: safeError || 'Image conversion failed.',
    });
  }
};

exports.compressImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file uploaded',
      });
    }

    await validateImageBuffer(req.file.buffer);

    // Only allow fields that this endpoint actually uses.
    if (!hasOnlyAllowedFields(req.body, ALLOWED_COMPRESS_FIELDS)) {
      return res.status(400).json({
        success: false,
        error: 'Unexpected request fields.',
      });
    }

    const {
      quality: requestedQuality = 80,
      targetKB: requestedTargetKB = null,
    } = req.body;

    // Validate quality.
    const quality = Number(requestedQuality);

    if (
      !Number.isInteger(quality) ||
      quality < 1 ||
      quality > 100
    ) {
      return res.status(400).json({
        success: false,
        error: 'Quality must be an integer between 1 and 100.',
      });
    }

    // Validate optional target size.
    let targetKB = null;

    if (
      requestedTargetKB !== null &&
      requestedTargetKB !== undefined &&
      requestedTargetKB !== ''
    ) {
      targetKB = Number(requestedTargetKB);

      if (
        !Number.isFinite(targetKB) ||
        targetKB <= 0 ||
        targetKB > 10240
      ) {
        return res.status(400).json({
          success: false,
          error: 'Target size must be between 1 KB and 10240 KB.',
        });
      }
    }

    // Process image using validated values only.
    const outputBuffer = await sharpService.compressImage(
      req.file.buffer,
      quality,
      targetKB
    );

    res.set('Content-Type', 'image/jpeg');
    res.set(
      'Content-Disposition',
      'attachment; filename="compressed.jpg"'
    );

    return res.send(outputBuffer);

  } catch (err) {
    logger.error('Image compression failed', {
      requestId: req.requestId,
      errorCategory: 'IMAGE_PROCESSING',
      error: err,
    });

    const safeError = getSafeImageError(err);

    return res.status(safeError ? 400 : 500).json({
      success: false,
      error: safeError || 'Image compression failed.',
    });
  }
};
exports.resizeImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    await validateImageBuffer(req.file.buffer);

    if (!hasOnlyAllowedFields(req.body, ALLOWED_RESIZE_FIELDS)) {
      return res.status(400).json({
        success: false,
        error: 'Unexpected request fields.',
      });
    }

    const {
      width,
      height,
      maintainAspect = true,
    } = req.body;

    if (
      maintainAspect !== undefined &&
      maintainAspect !== null &&
      maintainAspect !== true &&
      maintainAspect !== false &&
      maintainAspect !== 'true' &&
      maintainAspect !== 'false'
    ) {
      return res.status(400).json({
        success: false,
        error: 'maintainAspect must be true or false.',
      });
    }

    const requestedWidth =
      width !== undefined && width !== null && width !== ''
        ? Number(width)
        : null;

    const requestedHeight =
      height !== undefined && height !== null && height !== ''
        ? Number(height)
        : null;
    if (
      requestedWidth !== null &&
      (!Number.isInteger(requestedWidth) ||
        requestedWidth < 1 ||
        requestedWidth > MAX_IMAGE_WIDTH)
    ) {
      return res.status(400).json({
        error: `Width must be between 1 and ${MAX_IMAGE_WIDTH}px.`,
      });
    }

    if (
      requestedHeight !== null &&
      (!Number.isInteger(requestedHeight) ||
        requestedHeight < 1 ||
        requestedHeight > MAX_IMAGE_HEIGHT)
    ) {
      return res.status(400).json({
        error: `Height must be between 1 and ${MAX_IMAGE_HEIGHT}px.`,
      });
    }

    const outputBuffer = await sharpService.resizeImage(
      req.file.buffer,
      requestedWidth,
      requestedHeight,
      maintainAspect === 'true' || maintainAspect === true
    );

    // ✅ Send buffer directly
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="resized.png"');
    res.send(outputBuffer);

  } catch (err) {
    logger.error('Image resize failed', {
      requestId: req.requestId,
      errorCategory: 'IMAGE_PROCESSING',
      error: err,
    });

    const safeError = getSafeImageError(err);

    return res.status(safeError ? 400 : 500).json({
      success: false,
      error: safeError || 'Image resize failed.',
    });
  }
};