const express = require("express");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const Bottleneck = require("bottleneck");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : ["*"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS policy: This origin is not allowed"));
      }
    },
    methods: ["POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

let smtpCredentials = [];
let smtpUsageCount = {};
let currentSmtpIndex = 0;

// Optimized transporter configuration with increased limits
const createTransporter = (smtp) => {
  return nodemailer.createTransport({
    host: smtp.host || "smtp.gmail.com",
    port: smtp.port || 587,
    secure: false,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    pool: true,
    maxConnections: 50, // Increased from 20
    maxMessages: 100000, // Increased from 50000
    rateDelta: 1000, // Time between rate limit windows (1 second)
    rateLimit: 50, // Messages per rate limit window
  });
};

// Optimized rate limiter configuration
const limiter = new Bottleneck({
  minTime: 20, // Decreased from 100ms to 20ms between tasks
  maxConcurrent: 25, // Increased from 10 to 25 concurrent tasks
  reservoir: 500, // Maximum number of tasks that can be executed in a given timeframe
  reservoirRefreshAmount: 500, // Number of tasks to reload
  reservoirRefreshInterval: 60 * 1000, // Refresh interval in milliseconds (1 minute)
});

// Improved retry mechanism with exponential backoff
const sendWithRetry = async (email, transporter, mailOptions, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      await transporter.sendMail(mailOptions);
      return { success: true, email };
    } catch (error) {
      if (i === retries - 1) {
        return { success: false, email, error: error.message };
      }
      // Exponential backoff: 200ms, 400ms, 800ms
      await new Promise((resolve) => setTimeout(resolve, 200 * Math.pow(2, i)));
    }
  }
};

// Batch processing for improved performance
const processBatch = async (batch, smtp) => {
  const transporter = createTransporter(smtp);
  return Promise.all(
    batch.map((email) => {
      const mailOptions = {
        from: smtp.user,
        to: email.to,
        subject: email.subject,
        text: email.text || "",
        html: email.html || "",
        attachments: email.attachments || [],
      };
      return sendEmailLimited(email.to, transporter, mailOptions);
    })
  );
};

const sendEmailLimited = limiter.wrap(async (email, transporter, mailOptions) => {
  return await sendWithRetry(email, transporter, mailOptions);
});

app.post("/send-emails", upload.single("attachment"), async (req, res) => {
  let smtp_credentials, emails;

  try {
    smtp_credentials = JSON.parse(req.body.smtp_credentials);
    emails = JSON.parse(req.body.emails);
  } catch (error) {
    return res.status(400).json({ message: "Invalid JSON format for smtp_credentials or emails." });
  }

  const { subject, text, html } = req.body;
  const attachment = req.file;

  if (!smtp_credentials || !Array.isArray(smtp_credentials) || smtp_credentials.length === 0) {
    return res.status(400).json({ message: "Invalid SMTP credentials." });
  }
  if (!emails || !Array.isArray(emails) || emails.length === 0 || !subject || (!text && !html)) {
    return res.status(400).json({ message: "Invalid email data." });
  }

  smtpCredentials = smtp_credentials;
  smtpUsageCount = {};
  smtp_credentials.forEach((cred) => {
    smtpUsageCount[cred.user] = 0;
  });

  let successCount = 0;
  let failedEmails = [];
  let logs = [];

  try {
    // Process emails in batches of 50
    const BATCH_SIZE = 50;
    const batches = [];
    
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE).map(email => ({
        to: email,
        subject,
        text,
        html,
        attachments: attachment ? [{
          filename: attachment.originalname,
          path: attachment.path,
        }] : [],
      }));
      batches.push(batch);
    }

    // Process batches concurrently with different SMTP credentials
    const batchResults = await Promise.all(
      batches.map((batch, index) => {
        const smtpIndex = index % smtp_credentials.length;
        return processBatch(batch, smtp_credentials[smtpIndex]);
      })
    );

    // Aggregate results
    batchResults.flat().forEach(result => {
      if (result.success) {
        successCount++;
        logs.push(`✅ Sent to: ${result.email}`);
      } else {
        failedEmails.push(result.email);
        logs.push(`❌ Failed: ${result.email} - ${result.error}`);
      }
    });

    res.status(200).json({
      message: "Bulk email process completed",
      totalEmails: emails.length,
      sentSuccessfully: successCount,
      failedEmails,
      logs,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to process bulk email sending", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});