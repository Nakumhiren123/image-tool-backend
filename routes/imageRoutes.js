const express = require('express');
const router = express.Router();
const upload = require('../middleware/multer');
const imageController = require('../controllers/imageController');

const { authenticate } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrfProtection');

router.post(
    '/convert',
    authenticate,
    csrfProtection,
    upload.single('image'),
    imageController.convertImage
);

router.post(
    '/compress',
    authenticate,
    csrfProtection,
    upload.single('image'),
    imageController.compressImage
);

router.post(
    '/resize',
    authenticate,
    csrfProtection,
    upload.single('image'),
    imageController.resizeImage
);

module.exports = router;