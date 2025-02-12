const express = require("express");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Convert ALLOWED_ORIGINS from .env into an array
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : ["*"]; // Default: Allow all origins

// Enable CORS with multiple allowed origins
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS policy: This origin is not allowed"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Middleware to parse JSON
app.use(express.json());



const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465, // Use 587 for TLS, or 465 for SSL
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER, // Zoho email
    pass: process.env.EMAIL_PASS, // App password
  },
  pool: true, // Enable connection pooling for better performance
  maxConnections: 5,
  maxMessages: 100,
});


app.post("/send-bulk-emails", async (req, res) => {
  const { emails, subject, text, html } = req.body;

  if (!emails || !Array.isArray(emails) || !subject || (!text && !html)) {
    return res.status(400).json({ message: "Invalid input data" });
  }

  let successCount = 0;
  let failedEmails = [];
  let logs = []; // To store logs

  try {
    // Send all emails in parallel
    await Promise.all(
      emails.map(async (email) => {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: email,
          subject,
          text: text || "",
          html: html || "",
        };

        try {
          await transporter.sendMail(mailOptions);
          successCount++;
          logs.push(`✅ Email sent to: ${email}`);
        } catch (error) {
          console.error(`❌ Failed to send email to ${email}:`, error);
          failedEmails.push(email);
          logs.push(`❌ Failed to send email to ${email}: ${error.message}`);
        }
      })
    );

    res.status(200).json({
      message: "Bulk email process completed",
      totalEmails: emails.length,
      sentSuccessfully: successCount,
      failedEmails,
      logs, // Send logs to the frontend
    });
  } catch (error) {
    console.error("❌ Error sending emails:", error);
    res.status(500).json({ message: "Failed to process bulk email sending" });
  }
});


// app.post("/send-bulk-emails", async (req, res) => {
//   const { emails, subject, text, html } = req.body;

//   if (!emails || !Array.isArray(emails) || !subject || (!text && !html)) {
//     return res.status(400).json({ message: "Invalid input data" });
//   }

//   let successCount = 0;
//   let failedEmails = [];

//   try {
//     // Send all emails in parallel
//     await Promise.all(
//       emails.map(async (email) => {
//         const mailOptions = {
//           from: process.env.EMAIL_USER,
//           to: email,
//           subject,
//           text: text || "",
//           html: html || "",
//         };

//         try {
//           await transporter.sendMail(mailOptions);
//           successCount++;
//           console.log(`✅ Email sent to: ${email}`);
//         } catch (error) {
//           console.error(`❌ Failed to send email to ${email}:`, error);
//           failedEmails.push(email);
//         }
//       })
//     );

//     res.status(200).json({
//       message: "Bulk email process completed",
//       totalEmails: emails.length,
//       sentSuccessfully: successCount,
//       failedEmails,
//     });
//   } catch (error) {
//     console.error("❌ Error sending emails:", error);
//     res.status(500).json({ message: "Failed to process bulk email sending" });
//   }
// });


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
