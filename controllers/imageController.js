const sharpService = require('../services/sharpService');

const mimeMap = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};

exports.convertImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const { format = 'png', quality = 80 } = req.body;

    // ✅ Pass buffer instead of file path
    const outputBuffer = await sharpService.convertImage(req.file.buffer, format, { quality });

    // ✅ Send buffer directly, no disk needed
    res.set('Content-Type', mimeMap[format] || 'image/png');
    res.set('Content-Disposition', `attachment; filename="converted.${format}"`);
    res.send(outputBuffer);

  } catch (err) {
    console.error('Convert controller error:', err);
    res.status(500).json({ error: 'Image conversion failed', details: err.message });
  }
};

exports.compressImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const { quality = 80, targetKB = null } = req.body;

    // ✅ Pass buffer instead of file path
    const outputBuffer = await sharpService.compressImage(
      req.file.buffer,
      parseInt(quality),
      targetKB ? parseInt(targetKB) : null
    );

    // ✅ Send buffer directly
    res.set('Content-Type', 'image/jpeg');
    res.set('Content-Disposition', 'attachment; filename="compressed.jpg"');
    res.send(outputBuffer);

  } catch (err) {
    console.error('Compress controller error:', err);
    res.status(500).json({ error: 'Image compression failed', details: err.message });
  }
};

exports.resizeImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const { width, height, maintainAspect = true } = req.body;

    // ✅ Pass buffer instead of file path
    const outputBuffer = await sharpService.resizeImage(
      req.file.buffer,
      width,
      height,
      maintainAspect === 'true' || maintainAspect === true
    );

    // ✅ Send buffer directly
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="resized.png"');
    res.send(outputBuffer);

  } catch (err) {
    console.error('Resize controller error:', err);
    res.status(500).json({ error: 'Image resize failed', details: err.message });
  }
};