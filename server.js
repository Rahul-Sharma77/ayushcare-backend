const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI || '')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.log('❌ DB Error:', err.message));

const patientSchema = new mongoose.Schema({
  name: String, age: Number, gender: String,
  phone: { type: String, unique: true }, address: String, language: String
}, { timestamps: true });

const reportSchema = new mongoose.Schema({
  reportId: String, patientPhone: String, patientName: String,
  patientAge: Number, patientGender: String, mainComplaint: String,
  location: String, duration: String, severity: String,
  problemDetails: String, worseBy: String, betterBy: String,
  otherSymptoms: String, existingConditions: String, allergies: String,
  currentMedicines: String, familyHistory: String, appetite: String,
  digestion: String, sleep: String, stress: String, exercise: String,
  habits: String, extraNotes: String, redFlag: String, status: { type: String, default: 'pending' },
  doctorNotes: String, doctorPrescription: String, reviewedAt: Date
}, { timestamps: true });

const Patient = mongoose.model('Patient', patientSchema);
const Report = mongoose.model('Report', reportSchema);

app.get('/', (req, res) => {
  res.json({
    status: '🌿 AyushCare API Running',
    db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

app.post('/api/register', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    const patient = await Patient.findOneAndUpdate({ phone }, { ...req.body, phone }, { upsert: true, new: true });
    res.json({ success: true, patient });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/report', async (req, res) => {
  try {
    const report = await Report.create(req.body);
    res.json({ success: true, reportId: report.reportId });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/search', async (req, res) => {
  try {
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    const patient = await Patient.findOne({ phone });
    const reports = await Report.find({ patientPhone: phone }).sort({ createdAt: -1 });
    res.json({ patient, reports });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/doctor/reports', async (req, res) => {
  try {
    const status = req.query.status;
    const filter = status ? { status } : {};
    const reports = await Report.find(filter).sort({ createdAt: -1 });
    const pending = await Report.countDocuments({ status: 'pending' });
    const reviewed = await Report.countDocuments({ status: 'reviewed' });
    res.json({ reports, stats: { pending, reviewed, urgent: 0, patients: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/doctor/review', async (req, res) => {
  try {
    const { reportId, doctorNotes, doctorPrescription } = req.body;
    const report = await Report.findOneAndUpdate({ reportId }, { status: 'reviewed', doctorNotes, doctorPrescription, reviewedAt: new Date() }, { new: true });
    res.json({ success: true, report });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Server running on port', PORT));
