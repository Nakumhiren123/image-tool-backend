const express = require('express');
const router = express.Router();
const upload = require('../middleware/multer');
const imageController = require('../controllers/imageController');

const { authenticate } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrfProtection');
const { checkPlanLimits } = require('../middleware/planLimits');

router.post(
    '/convert',
    authenticate,
    csrfProtection,
    checkPlanLimits,
    upload.single('image'),
    imageController.convertImage
);

router.post(
    '/compress',
    authenticate,
    csrfProtection,
    checkPlanLimits,
    upload.single('image'),
    imageController.compressImage
);

router.post(
    '/resize',
    authenticate,
    csrfProtection,
    checkPlanLimits,
    upload.single('image'),
    imageController.resizeImage
);

module.exports = router;