<meta name='viewport' content='width=device-width, initial-scale=1'/>const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ===== DB CONNECT =====
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.log('❌ MONGO_URI missing. Add it in Railway Variables.');
}

mongoose
  .connect(MONGO_URI || '')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.log('❌ MongoDB Error:', err.message));

// ===== MODELS =====
const patientSchema = new mongoose.Schema(
  {
    name: String,
    age: Number,
    gender: String,
    phone: { type: String, unique: true, index: true },
    address: String,
    language: { type: String, default: 'hi' }
  },
  { timestamps: true }
);

const reportSchema = new mongoose.Schema(
  {
    reportId: { type: String, index: true },
    patientPhone: { type: String, index: true },
    patientName: String,
    patientAge: Number,
    patientGender: String,
    mainComplaint: String,
    location: String,
    duration: String,
    severity: String,
    problemDetails: String,
    worseBy: String,
    betterBy: String,
    otherSymptoms: String,
    existingConditions: String,
    allergies: String,
    currentMedicines: String,
    familyHistory: String,
    appetite: String,
    digestion: String,
    sleep: String,
    stress: String,
    exercise: String,
    habits: String,
    extraNotes: String,
    redFlag: { type: String, default: 'NO' },
    status: { type: String, default: 'pending' }, // pending | reviewed
    doctorNotes: { type: String, default: '' },
    doctorPrescription: { type: String, default: '' },
    reviewedAt: Date,
    viewCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const Patient = mongoose.model('Patient', patientSchema);
const Report = mongoose.model('Report', reportSchema);

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({
    status: '🌿 AyushCare API Running',
    db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    time: new Date().toISOString()
  });
});

// ===== REGISTER / UPDATE PATIENT =====
app.post('/api/register', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone required' });
    }

    const payload = {
      name: req.body.name || '',
      age: Number(req.body.age) || 0,
      gender: req.body.gender || 'Other',
      phone,
      address: req.body.address || '',
      language: req.body.language || 'hi'
    };

    const patient = await Patient.findOneAndUpdate(
      { phone },
      payload,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, message: 'Patient saved', patient });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== SUBMIT REPORT =====
app.post('/api/report', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.patientPhone || !body.mainComplaint) {
      return res.status(400).json({
        success: false,
        message: 'patientPhone and mainComplaint are required'
      });
    }

    const report = await Report.create({
      reportId: body.reportId || `AYU-${Date.now()}`,
      patientPhone: String(body.patientPhone).replace(/\D/g, ''),
      patientName: body.patientName || '',
      patientAge: Number(body.patientAge) || 0,
      patientGender: body.patientGender || '',
      mainComplaint: body.mainComplaint || '',
      location: body.location || '',
      duration: body.duration || '',
      severity: body.severity || '',
      problemDetails: body.problemDetails || '',
      worseBy: body.worseBy || '',
      betterBy: body.betterBy || '',
      otherSymptoms: body.otherSymptoms || '',
      existingConditions: body.existingConditions || '',
      allergies: body.allergies || '',
      currentMedicines: body.currentMedicines || '',
      familyHistory: body.familyHistory || '',
      appetite: body.appetite || '',
      digestion: body.digestion || '',
      sleep: body.sleep || '',
      stress: body.stress || '',
      exercise: body.exercise || '',
      habits: body.habits || '',
      extraNotes: body.extraNotes || '',
      redFlag: body.redFlag || 'NO',
      status: 'pending'
    });

    res.json({
      success: true,
      message: 'Report saved',
      reportId: report.reportId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== SEARCH BY PHONE =====
app.get('/api/search', async (req, res) => {
  try {
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    if (!phone) {
      return res.json({ patient: null, reports: [] });
    }

    const patient = await Patient.findOne({ phone });
    const reports = await Report.find({ patientPhone: phone }).sort({ createdAt: -1 });

    res.json({ patient, reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== DOCTOR INBOX =====
app.get('/api/doctor/reports', async (req, res) => {
  try {
    const status = req.query.status; // pending | reviewed | empty
    const filter = status ? { status } : {};

    const reports = await Report.find(filter)
      .sort({ redFlag: -1, createdAt: -1 })
      .limit(200);

    const [pending, reviewed, urgent, patients] = await Promise.all([
      Report.countDocuments({ status: 'pending' }),
      Report.countDocuments({ status: 'reviewed' }),
      Report.countDocuments({ redFlag: 'YES', status: 'pending' }),
      Patient.countDocuments()
    ]);

    res.json({
      reports,
      stats: { pending, reviewed, urgent, patients }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== MARK REVIEWED =====
app.post('/api/doctor/review', async (req, res) => {
  try {
    const { reportId, doctorNotes, doctorPrescription } = req.body;
    if (!reportId) {
      return res.status(400).json({ success: false, message: 'reportId required' });
    }

    const report = await Report.findOneAndUpdate(
      { reportId },
      {
        status: 'reviewed',
        doctorNotes: doctorNotes || '',
        doctorPrescription: doctorPrescription || '',
        reviewedAt: new Date()
      },
      { new: true }
    );

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== UNMARK REVIEW =====
app.post('/api/doctor/unmark', async (req, res) => {
  try {
    const { reportId } = req.body;
    if (!reportId) {
      return res.status(400).json({ success: false, message: 'reportId required' });
    }

    const report = await Report.findOneAndUpdate(
      { reportId },
      { status: 'pending', reviewedAt: null },
      { new: true }
    );

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 AyushCare API running on port ${PORT}`);
});