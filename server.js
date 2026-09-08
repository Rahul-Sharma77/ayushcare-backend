const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ===== DB CONNECT =====
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI || '')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.log('❌ DB Error:', err.message));

// ===== MODELS =====
const Patient = mongoose.model('Patient', new mongoose.Schema({
  name: String, age: Number, gender: String,
  phone: { type: String, unique: true, index: true },
  address: String, language: String
}, { timestamps: true }));

const Report = mongoose.model('Report', new mongoose.Schema({
  reportId: { type: String, index: true },
  patientPhone: { type: String, index: true },
  patientName: String, patientAge: Number, patientGender: String,
  mainComplaint: String, location: String, duration: String, severity: String,
  problemDetails: String, worseBy: String, betterBy: String,
  otherSymptoms: String, existingConditions: String, allergies: String,
  currentMedicines: String, familyHistory: String, appetite: String,
  digestion: String, sleep: String, stress: String, exercise: String,
  habits: String, extraNotes: String, redFlag: { type: String, default: 'NO' },
  status: { type: String, default: 'pending' },
  doctorNotes: { type: String, default: '' },
  doctorPrescription: { type: String, default: '' },
  reviewedBy: { type: String, default: '' },
  reviewedAt: Date, viewCount: { type: Number, default: 0 }
}, { timestamps: true }));

// ===== GEMINI AI WITH STRICT RULES =====
let ai = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
  console.log('⚠️ GEMINI_API_KEY not set — /api/ai will return fallback responses');
}

const SYSTEM_PROMPT = (language) => `You are "AyushMitra", an AI health assistant for AyushCare (Ministry of AYUSH software).

STRICT RULES:
1. NEVER prescribe medicines, chemical names, or exact dosages. If asked for medicine, say: "Only a registered doctor can prescribe medicine."
2. NEVER give a diagnosis.
3. EMERGENCY TRIAGE: If the user mentions chest pain, severe breathlessness, sudden weakness/stroke, unconsciousness, or heavy bleeding, IMMEDIATELY reply in BOLD: "🚨 THIS MAY BE AN EMERGENCY! Please call 108 Ambulance immediately."
4. AYUSH GUIDANCE: For mild complaints, suggest safe traditional AYUSH lifestyle tips (warm water, ginger/tulsi tea, light diet/Pathya, sleep hygiene, gentle Yoga/Pranayama).
5. LANGUAGE: Answer in the EXACT language requested: "${language || 'Hindi/English'}".
6. LENGTH: Keep responses under 80 words. Be polite, simple, and rural-user friendly.`;

app.post('/api/ai', async (req, res) => {
  try {
    const { prompt, language } = req.body;

    if (!prompt) return res.status(400).json({ success: false, message: 'Prompt required' });
    if (!ai) {
      return res.json({
        success: false,
        fallback: true,
        message: 'GEMINI_API_KEY not configured in Render environment variables.'
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT(language),
        temperature: 0.3,      // lower = more consistent adherence to the strict rules
        maxOutputTokens: 300
      }
    });

    const replyText = response.text;

    if (replyText) {
      res.json({ success: true, reply: replyText.trim() });
    } else {
      res.json({ success: false, fallback: true, message: 'Empty response from Gemini' });
    }
  } catch (err) {
    console.error('AI Error:', err.message);
    res.json({ success: false, fallback: true, error: err.message });
  }
});

// ===== OTHER ROUTES =====
app.get('/', (req, res) => {
  res.json({ status: '🌿 AyushCare API Running', db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected' });
});

app.post('/api/register', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ success: false, message: 'Phone required' });
    const patient = await Patient.findOneAndUpdate({ phone }, { ...req.body, phone }, { upsert: true, new: true });
    res.json({ success: true, patient });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/report', async (req, res) => {
  try {
    const body = req.body || {};
    const phone = String(body.patientPhone || '').replace(/\D/g, '');
    const report = await Report.create({ ...body, patientPhone: phone, status: 'pending' });
    res.json({ success: true, reportId: report.reportId, report });
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
    const reports = await Report.find(filter).sort({ redFlag: -1, createdAt: -1 }).limit(300);
    const pending = await Report.countDocuments({ status: 'pending' });
    const reviewed = await Report.countDocuments({ status: 'reviewed' });
    const urgent = await Report.countDocuments({ redFlag: 'YES', status: 'pending' });
    const patients = await Patient.countDocuments();
    res.json({ reports, stats: { pending, reviewed, urgent, patients } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/doctor/review', async (req, res) => {
  try {
    const { reportId, doctorNotes, doctorPrescription, reviewedBy } = req.body;
    const report = await Report.findOneAndUpdate({ reportId }, { status: 'reviewed', doctorNotes, doctorPrescription, reviewedBy: reviewedBy || 'Doctor', reviewedAt: new Date() }, { new: true });
    res.json({ success: true, report });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/doctor/unmark', async (req, res) => {
  try {
    const { reportId } = req.body;
    const report = await Report.findOneAndUpdate({ reportId }, { status: 'pending', reviewedAt: null }, { new: true });
    res.json({ success: true, report });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Server running on', PORT));
