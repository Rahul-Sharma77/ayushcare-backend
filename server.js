const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();

// =====================================================
// BASIC SERVER SETUP
// =====================================================

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// =====================================================
// DATABASE
// =====================================================

const MONGO_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGO_URI || '')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.log('❌ DB Error:', err.message));

// =====================================================
// DATABASE MODELS
// =====================================================

const Patient = mongoose.model(
  'Patient',
  new mongoose.Schema(
    {
      name: String,
      age: Number,
      gender: String,
      phone: {
        type: String,
        unique: true,
        index: true
      },
      address: String,
      language: String
    },
    { timestamps: true }
  )
);

const Report = mongoose.model(
  'Report',
  new mongoose.Schema(
    {
      reportId: {
        type: String,
        index: true
      },

      patientPhone: {
        type: String,
        index: true
      },

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

      redFlag: {
        type: String,
        default: 'NO'
      },

      status: {
        type: String,
        default: 'pending'
      },

      doctorNotes: {
        type: String,
        default: ''
      },

      doctorPrescription: {
        type: String,
        default: ''
      },

      reviewedBy: {
        type: String,
        default: ''
      },

      reviewedAt: Date,

      viewCount: {
        type: Number,
        default: 0
      }
    },
    { timestamps: true }
  )
);

// =====================================================
// GEMINI AI
// =====================================================

let ai = null;

if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  console.log('✅ Gemini API configured');
} else {
  console.log(
    '⚠️ GEMINI_API_KEY not set — /api/ai will return fallback responses'
  );
}

// =====================================================
// AI SYSTEM PROMPT
// =====================================================

const SYSTEM_PROMPT = (language) => `
You are "AyushMitra", an AI health information assistant for AyushCare.

IMPORTANT SAFETY RULES:

1. NEVER prescribe medicines.
2. NEVER provide exact medicine dosages.
3. NEVER provide chemical names as treatments.
4. If the user asks which medicine to take, say:
   "Only a registered doctor can prescribe medicine."
5. NEVER claim to diagnose a disease.
6. Do not say that the user definitely has a particular disease.
7. For serious symptoms, recommend professional medical care.
8. If the user mentions chest pain, severe breathing difficulty,
   sudden weakness/stroke symptoms, unconsciousness, or heavy bleeding,
   immediately say:
   "🚨 THIS MAY BE AN EMERGENCY! Please call 108 Ambulance immediately."
9. For mild everyday complaints, provide general health information
   and safe lifestyle suggestions.
10. AYUSH-related suggestions should remain general and low-risk,
    such as hydration, rest, light food, sleep hygiene, gentle yoga,
    and commonly used traditional wellness practices.
11. Do not present traditional remedies as guaranteed cures.
12. Tell the user to consult a qualified doctor when symptoms are
    severe, persistent, worsening, or concerning.
13. Answer in the EXACT requested language:
    ${language || 'Hindi/English'}.

RESPONSE STYLE:

- Be polite.
- Be simple and easy to understand.
- Give a COMPLETE answer.
- Do not stop in the middle of a sentence.
- Prefer short paragraphs or bullet points.
- Keep the response around 60-100 words.
- Avoid unnecessary technical language.
`;

// =====================================================
// GEMINI HELPER
// =====================================================

function isTemporaryGeminiError(error) {
  const message = String(error?.message || '').toLowerCase();

  return (
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('high demand') ||
    message.includes('429') ||
    message.includes('resource exhausted') ||
    message.includes('rate limit') ||
    message.includes('temporarily')
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =====================================================
// AI ROUTE
// =====================================================

app.post('/api/ai', async (req, res) => {
  const startTime = Date.now();

  try {
    const { prompt, language } = req.body;

    // ---------------------------------------------
    // Validate prompt
    // ---------------------------------------------

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Prompt required'
      });
    }

    // ---------------------------------------------
    // Check API key
    // ---------------------------------------------

    if (!ai) {
      return res.json({
        success: false,
        fallback: true,
        message:
          'GEMINI_API_KEY not configured in Render environment variables.'
      });
    }

    // ---------------------------------------------
    // Models
    //
    // Primary:
    // Gemini 3.6 Flash
    //
    // Fallback:
    // Gemini 3.5 Flash-Lite
    //
    // ---------------------------------------------

    const models = [
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite'
    ];

    let response = null;
    let lastError = null;

    // ---------------------------------------------
    // Try primary model, then fallback model
    // ---------------------------------------------

    for (const model of models) {
      let modelSucceeded = false;

      // Try each model up to 2 times for temporary errors
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          console.log(
            `🤖 Gemini request: ${model} | attempt ${attempt + 1}`
          );

          response = await ai.models.generateContent({
            model,
            contents: prompt,

            config: {
              systemInstruction: SYSTEM_PROMPT(language),

              // Low thinking = faster response
              thinkingConfig: {
                thinkingLevel: 'low'
              },

              // Enough room for a complete answer
              maxOutputTokens: 500
            }
          });

          modelSucceeded = true;

          console.log(
            `✅ Gemini response received from ${model} in ${
              Date.now() - startTime
            }ms`
          );

          break;
        } catch (error) {
          lastError = error;

          console.error(
            `❌ Gemini ${model} attempt ${attempt + 1}:`,
            error.message
          );

          // Only retry temporary errors.
          // Don't waste time retrying invalid API/model requests.
          if (!isTemporaryGeminiError(error)) {
            break;
          }

          // Retry after:
          // attempt 1 → 1 second
          // attempt 2 → model fallback
          if (attempt === 0) {
            await wait(1000);
          }
        }
      }

      if (modelSucceeded) {
        break;
      }

      console.log(`⚠️ Trying fallback model after ${model}`);
    }

    // ---------------------------------------------
    // No successful Gemini response
    // ---------------------------------------------

    if (!response) {
      console.error(
        '❌ All Gemini models failed:',
        lastError?.message
      );

      return res.json({
        success: false,
        fallback: true,
        message:
          'The AI service is temporarily busy. Please try again in a moment.',
        error: lastError?.message || 'Unknown Gemini error'
      });
    }

    // ---------------------------------------------
    // Extract answer
    // ---------------------------------------------

    const replyText = response.text;

    if (!replyText || !replyText.trim()) {
      return res.json({
        success: false,
        fallback: true,
        message: 'Gemini returned an empty response.'
      });
    }

    // ---------------------------------------------
    // Successful response
    // ---------------------------------------------

    return res.json({
      success: true,
      reply: replyText.trim()
    });
  } catch (err) {
    console.error('❌ AI Error:', err.message);

    return res.json({
      success: false,
      fallback: true,
      message:
        'The AI service is temporarily unavailable. Please try again.',
      error: err.message
    });
  }
});

// =====================================================
// HOME / HEALTH CHECK
// =====================================================

app.get('/', (req, res) => {
  res.json({
    status: '🌿 AyushCare API Running',
    db:
      mongoose.connection.readyState === 1
        ? 'Connected'
        : 'Disconnected',
    ai: process.env.GEMINI_API_KEY
      ? 'Configured'
      : 'Not configured'
  });
});

// =====================================================
// REGISTER PATIENT
// =====================================================

app.post('/api/register', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '');

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone required'
      });
    }

    const patient = await Patient.findOneAndUpdate(
      { phone },
      {
        ...req.body,
        phone
      },
      {
        upsert: true,
        new: true
      }
    );

    res.json({
      success: true,
      patient
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

// =====================================================
// CREATE PATIENT REPORT
// =====================================================

app.post('/api/report', async (req, res) => {
  try {
    const body = req.body || {};

    const phone = String(
      body.patientPhone || ''
    ).replace(/\D/g, '');

    const report = await Report.create({
      ...body,
      patientPhone: phone,
      status: 'pending'
    });

    res.json({
      success: true,
      reportId: report.reportId,
      report
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

// =====================================================
// SEARCH PATIENT
// =====================================================

app.get('/api/search', async (req, res) => {
  try {
    const phone = String(
      req.query.phone || ''
    ).replace(/\D/g, '');

    const patient = await Patient.findOne({
      phone
    });

    const reports = await Report.find({
      patientPhone: phone
    }).sort({
      createdAt: -1
    });

    res.json({
      patient,
      reports
    });
  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

// =====================================================
// DOCTOR REPORTS
// =====================================================

app.get('/api/doctor/reports', async (req, res) => {
  try {
    const status = req.query.status;

    const filter = status
      ? { status }
      : {};

    const reports = await Report.find(filter)
      .sort({
        redFlag: -1,
        createdAt: -1
      })
      .limit(300);

    const pending = await Report.countDocuments({
      status: 'pending'
    });

    const reviewed = await Report.countDocuments({
      status: 'reviewed'
    });

    const urgent = await Report.countDocuments({
      redFlag: 'YES',
      status: 'pending'
    });

    const patients = await Patient.countDocuments();

    res.json({
      reports,
      stats: {
        pending,
        reviewed,
        urgent,
        patients
      }
    });
  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

// =====================================================
// DOCTOR REVIEW
// =====================================================

app.post('/api/doctor/review', async (req, res) => {
  try {
    const {
      reportId,
      doctorNotes,
      doctorPrescription,
      reviewedBy
    } = req.body;

    const report = await Report.findOneAndUpdate(
      { reportId },
      {
        status: 'reviewed',
        doctorNotes,
        doctorPrescription,
        reviewedBy: reviewedBy || 'Doctor',
        reviewedAt: new Date()
      },
      {
        new: true
      }
    );

    res.json({
      success: true,
      report
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

// =====================================================
// UNMARK REPORT
// =====================================================

app.post('/api/doctor/unmark', async (req, res) => {
  try {
    const { reportId } = req.body;

    const report = await Report.findOneAndUpdate(
      { reportId },
      {
        status: 'pending',
        reviewedAt: null
      },
      {
        new: true
      }
    );

    res.json({
      success: true,
      report
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
