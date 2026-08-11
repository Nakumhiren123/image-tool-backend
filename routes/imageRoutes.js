const express = require('express');
const router = express.Router();
const upload = require('../middleware/multer');
const imageController = require('../controllers/imageController');

router.post('/convert', upload.single('image'), imageController.convertImage);
router.post('/compress', upload.single('image'), imageController.compressImage);
router.post('/resize', upload.single('image'), imageController.resizeImage);

module.exports = router;
