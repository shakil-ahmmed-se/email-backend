const express = require("express");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Middleware to parse JSON
app.use(express.json());

// Configure Nodemailer transporter with pooling
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  pool: true, // Enables connection pooling
  maxConnections: 5, // Adjust based on your SMTP provider limits
  maxMessages: 100, // Max messages per connection
});

// Route to send bulk emails
app.post("/send-bulk-emails", async (req, res) => {
  const { emails, subject, text, html } = req.body;

  if (!emails || !Array.isArray(emails) || !subject || (!text && !html)) {
    return res.status(400).json({ message: "Invalid input data" });
  }

  let successCount = 0;
  let failedEmails = [];

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
          console.log(`Email sent to: ${email}`);
        } catch (error) {
          console.error(`Failed to send email to ${email}:`, error);
          failedEmails.push(email);
        }
      })
    );

    res.status(200).json({
      message: "Bulk email process completed",
      totalEmails: emails.length,
      sentSuccessfully: successCount,
      failedEmails,
    });
  } catch (error) {
    console.error("Error sending emails:", error);
    res.status(500).json({ message: "Failed to process bulk email sending" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
