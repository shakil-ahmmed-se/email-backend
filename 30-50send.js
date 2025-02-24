const express = require("express");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const cors = require("cors");
const multer = require("multer"); // For handling file uploads
const path = require("path");

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
    cb(null, "uploads/"); // Save files in the "uploads" folder
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname); // Unique filename
  },
});

const upload = multer({ storage });

let smtpCredentials = [];
let smtpUsageCount = {}; 
let currentSmtpIndex = 0;

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
    maxConnections: 20,
    maxMessages: 50000,
  });
};

const getNextTransporter = () => {
  if (smtpCredentials.length === 0) {
    throw new Error("No SMTP credentials available.");
  }
  while (true) {
    currentSmtpIndex = (currentSmtpIndex + 1) % smtpCredentials.length;
    let smtp = smtpCredentials[currentSmtpIndex];
    if (smtpUsageCount[smtp.user] < 490) {
      return { transporter: createTransporter(smtp), smtp };
    }
  }
};

app.post("/send-emails", upload.single("attachment"), async (req, res) => {
  let smtp_credentials, emails;

  try {
    // Parse smtp_credentials and emails from the request body
    smtp_credentials = JSON.parse(req.body.smtp_credentials);
    emails = JSON.parse(req.body.emails);
  } catch (error) {
    return res.status(400).json({ message: "Invalid JSON format for smtp_credentials or emails." });
  }

  const { subject, text, html } = req.body;
  const attachment = req.file; // Uploaded file

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
    for (let email of emails) {
      let { transporter, smtp } = getNextTransporter();
      const mailOptions = {
        from: smtp.user,
        to: email,
        subject,
        text: text || "",
        html: html || "",
        attachments: attachment
          ? [
              {
                filename: attachment.originalname, // Use the original filename
                path: attachment.path, // Path to the uploaded file
              },
            ]
          : [],
      };

      try {
        await transporter.sendMail(mailOptions);
        successCount++;
        smtpUsageCount[smtp.user]++;
        logs.push(`✅ Sent to: ${email} using ${smtp.user}`);
        console.log(`✅ Sent to: ${email} using ${smtp.user}`);
      } catch (error) {
        failedEmails.push(email);
        logs.push(`❌ Failed: ${email} - ${error.message}`);
      }
    }

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