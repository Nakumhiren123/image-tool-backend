const multer = require('multer');
const path = require('path');

// Use memory storage for Vercel — disk storage not allowed on serverless
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|gif|avif|bmp|tiff|heic/;
  const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimeType = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('image/');

  if (extName || mimeType) {
    return cb(null, true);
  }
  cb(new Error('Only image files (JPG, PNG, WEBP, GIF, AVIF, HEIC, TIFF) are allowed!'));
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter
});

module.exports = upload;

// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');

// const uploadsDir = path.join(__dirname, '../uploads');
// if (!fs.existsSync(uploadsDir)) {
//   fs.mkdirSync(uploadsDir, { recursive: true });
// }

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     cb(null, uploadsDir);
//   },
//   filename: (req, file, cb) => {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
//     const ext = path.extname(file.originalname);
//     cb(null, file.fieldname + '-' + uniqueSuffix + ext);
//   }
// });

// const fileFilter = (req, file, cb) => {
//   const allowedTypes = /jpeg|jpg|png|webp|gif|avif|bmp|tiff|heic/;
//   const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
//   const mimeType = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('image/');

//   if (extName || mimeType) {
//     return cb(null, true);
//   }
//   cb(new Error('Only image files (JPG, PNG, WEBP, GIF, AVIF, HEIC, TIFF) are allowed!'));
// };

// const upload = multer({
//   storage,
//   limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
//   fileFilter
// });

// module.exports = upload;
