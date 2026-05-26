const express = require('express');
const multer = require('multer');
const { parseExcelBuffer } = require('../services/parser');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls');
    cb(null, ok);
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or invalid file type.' });
  }

  try {
    const entities = parseExcelBuffer(req.file.buffer);

    if (entities.length === 0) {
      return res.status(422).json({ error: 'No valid entities found. Check that sheets have Employee ID and CTC Hexa columns with data.' });
    }

    const totalConsultants = entities.reduce((s, e) => s + e.employees.length, 0);
    const totalCTC = entities.reduce((s, e) => s + e.totalCTC, 0);

    res.json({
      entities,
      summary: {
        entityCount: entities.length,
        consultantCount: totalConsultants,
        totalCTC: Math.round(totalCTC * 100) / 100,
      },
    });
  } catch (err) {
    console.error('Parse error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse file.' });
  }
});

module.exports = router;
