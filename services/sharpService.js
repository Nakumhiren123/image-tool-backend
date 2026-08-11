const sharp = require('sharp');

class SharpService {
  /**
   * Convert image to target format — returns a Buffer
   */
  async convertImage(inputBuffer, targetFormat = 'png', options = {}) {
    const quality = parseInt(options.quality) || 80;
    const format = targetFormat.toLowerCase();

    let pipeline = sharp(inputBuffer);

    switch (format) {
      case 'jpg':
      case 'jpeg':
        pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality });
        break;
      case 'png':
        pipeline = pipeline.png({ compressionLevel: Math.round((100 - quality) / 10) });
        break;
      case 'webp':
        pipeline = pipeline.webp({ quality });
        break;
      case 'avif':
        pipeline = pipeline.avif({ quality });
        break;
      case 'gif':
        pipeline = pipeline.resize({ width: 1000, withoutEnlargement: true }).gif({ colours: 128 });
        break;
      default:
        pipeline = pipeline.png();
        break;
    }

    return pipeline.toBuffer(); // ✅ return Buffer, no disk needed
  }

  /**
   * Compress image — returns a Buffer
   */
  async compressImage(inputBuffer, quality = 80, targetKB = null) {
    if (!targetKB) {
      return this.convertImage(inputBuffer, 'jpg', { quality });
    }

    const targetBytes = targetKB * 1024;
    let minQ = 5;
    let maxQ = 98;
    let bestBuffer = null;
    let iterations = 0;

    while (iterations < 7) {
      const midQ = Math.round((minQ + maxQ) / 2);
      iterations++;

      const buf = await sharp(inputBuffer)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: midQ })
        .toBuffer(); // ✅ no disk I/O

      bestBuffer = buf;

      if (buf.length > targetBytes) {
        maxQ = midQ - 1;
      } else {
        minQ = midQ + 1;
        if (targetBytes - buf.length < targetBytes * 0.05) break;
      }
    }

    return bestBuffer;
  }

  /**
   * Resize image — returns a Buffer
   */
  async resizeImage(inputBuffer, width, height, maintainAspect = true) {
    const w = parseInt(width) || null;
    const h = parseInt(height) || null;

    return sharp(inputBuffer)
      .resize({
        width: w,
        height: h,
        fit: maintainAspect ? sharp.fit.inside : sharp.fit.fill,
        withoutEnlargement: false
      })
      .toBuffer(); // ✅ no disk I/O
  }
}

module.exports = new SharpService();