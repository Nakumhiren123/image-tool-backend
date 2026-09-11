const sharp = require('sharp');

const MAX_IMAGE_PIXELS = 100_000_000;

const createSharp = (inputBuffer) => {
  return sharp(inputBuffer, {
    limitInputPixels: MAX_IMAGE_PIXELS,
  });
};

class SharpService {
  /**
   * Convert image to target format — returns a Buffer
   */
  async convertImage(inputBuffer, targetFormat = 'png', options = {}) {
    const quality = Number(options.quality ?? 80);

    if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
      throw new Error('Invalid image quality.');
    }
    const format = targetFormat.toLowerCase();

    let pipeline = createSharp(inputBuffer);

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

    const targetBytes = Number(targetKB) * 1024;

    if (
      !Number.isFinite(targetBytes) ||
      targetBytes <= 0
    ) {
      throw new Error('Invalid target size.');
    }

    let minQ = 5;
    let maxQ = 98;
    let bestBuffer = null;

    for (let iterations = 0; iterations < 8; iterations++) {
      const midQ = Math.round((minQ + maxQ) / 2);

      const buf = await createSharp(inputBuffer)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: midQ })
        .toBuffer();

      if (buf.length <= targetBytes) {
        // Keep the largest buffer that is still within the target.
        bestBuffer = buf;
        minQ = midQ + 1;
      } else {
        maxQ = midQ - 1;
      }

      if (minQ > maxQ) {
        break;
      }
    }

    if (bestBuffer) {
      return bestBuffer;
    }

    const smallestBuffer = await createSharp(inputBuffer)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 5 })
      .toBuffer();

    if (smallestBuffer.length <= targetBytes) {
      return smallestBuffer;
    }

    throw new Error(
      `Unable to compress image below the requested target size of ${targetKB} KB.`
    );
  }

  /**
   * Resize image — returns a Buffer
   */
  async resizeImage(inputBuffer, width, height, maintainAspect = true) {

    const w =
      width !== undefined && width !== null && width !== ''
        ? Number(width)
        : null;

    const h =
      height !== undefined && height !== null && height !== ''
        ? Number(height)
        : null;

    if (
      (w !== null &&
        (!Number.isInteger(w) || w < 1 || w > 20000)) ||
      (h !== null &&
        (!Number.isInteger(h) || h < 1 || h > 20000))
    ) {
      throw new Error('Invalid resize dimensions.');
    }

    return createSharp(inputBuffer)
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