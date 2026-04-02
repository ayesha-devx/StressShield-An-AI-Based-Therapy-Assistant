const express = require("express");
const path = require("path");
const session = require("express-session");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ✅ FIX: load .env and .env.local from ROOT folder
require("dotenv").config();
require("dotenv").config({
  path: path.join(__dirname, ".env.local"),
  override: true,
});

const app = express();
const port = process.env.PORT || 3000;

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected..."))
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err.message);
    process.exit(1);
  });

// Define User Schema and Model
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  averageScores: { type: [Number], default: [] },
});

const User = mongoose.model("User", userSchema);

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret:
      "33748627154566784e46033718acdb8eb87c0e4438e768787c1be48908446fbe37ed346373c2eca4f044f0b917bc397bf12ccef7ce1884b5d3cb93492425c4e1",
    resave: false,
    saveUninitialized: true,
  }),
);

// Debug: log session user
app.use((req, res, next) => {
  console.log("Session Username:", req.session.username || "Not logged in");
  next();
});

// === Authentication Middleware ===
function authenticate(req, res, next) {
  if (req.session && req.session.username) {
    return next();
  } else {
    return res.status(401).json({ message: "Unauthorized: Please log in." });
  }
}

// ✅ Signup
app.post("/signup", async (req, res) => {
  const { name, password, confirmPassword } = req.body;

  console.log("Received data:", req.body);

  if (!name || !password || !confirmPassword) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }

  try {
    const existingUser = await User.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
    });

    if (existingUser) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const newUser = new User({ name, password });
    await newUser.save();

    return res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error registering user:", error);
    return res.status(500).json({ message: "Error registering user" });
  }
});

// ✅ Login
app.post("/login", async (req, res) => {
  try {
    const check = await User.findOne({
      name: new RegExp(`^${req.body.name}$`, "i"),
    });

    if (!check) {
      return res.status(404).json({ message: "User not found" });
    }

    if (check.password === req.body.password) {
      req.session.username = req.body.name;
      return res
        .status(200)
        .json({ message: "Login successful", redirect: "/home.html" });
    } else {
      return res.status(401).json({ message: "Incorrect password" });
    }
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Server error during login" });
  }
});

// ✅ Logout
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

// ✅ Auth check
app.get("/authUser", (req, res) => {
  if (req.session.username) {
    res.status(200).json({ username: req.session.username });
  } else {
    res.status(401).json({ message: "Not authenticated" });
  }
});

// ✅ Dashboard score retrieval
app.get("/averageScores", authenticate, async (req, res) => {
  try {
    const user = await User.findOne({
      name: new RegExp(`^${req.session.username}$`, "i"),
    });
    if (!user || !user.averageScores) {
      return res.json({ averageScores: [] });
    }
    res.json({ averageScores: user.averageScores });
  } catch (err) {
    console.error("Error fetching scores:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Quiz submission
app.post("/submitQuiz", authenticate, async (req, res) => {
  const { totalScore } = req.body;

  if (typeof totalScore !== "number" || isNaN(totalScore)) {
    return res.status(400).json({ message: "Invalid score submission." });
  }

  try {
    const user = await User.findOne({
      name: new RegExp(`^${req.session.username}$`, "i"),
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    const averageScore = totalScore / 30;
    user.averageScores.push(averageScore);
    await user.save();

    res
      .status(200)
      .json({
        message: "Quiz submitted successfully",
        averageScore,
        allScores: user.averageScores,
      });
  } catch (error) {
    console.error("Error submitting quiz:", error);
    res.status(500).json({ message: "Error submitting quiz" });
  }
});

// ✅ Gemini AI Chat SDK Setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

app.post("/AI_Chat", async (req, res) => {
  try {
    const { messages } = req.body;
    const api_key = process.env.GEMINI_API_KEY;

    console.log("🔥 /AI_Chat HIT (SDK):", messages);

    if (!api_key) {
      console.error("❌ GEMINI_API_KEY is missing");
      return res
        .status(500)
        .json({ error: "AI Configuration error: API Key missing" });
    }

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages format" });
    }

    // Format history for Gemini SDK
    // The SDK expects 'user' and 'model' (not 'assistant')
    const history = messages.slice(0, -1).map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    const userMessage = messages[messages.length - 1].content;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const chat = model.startChat({
      history: history,
    });

    const result = await chat.sendMessage(userMessage);
    const response = await result.response;
    const botText = response.text();

    res.json({ text: botText });
  } catch (err) {
    console.error("❌ Gemini SDK Error:", err);

    // Handle Quota/Rate Limit specifically if possible
    if (err.message?.includes("429") || err.status === 429) {
      return res
        .status(429)
        .json({
          error:
            "AI Quota exceeded. Please try again later or check your billing.",
        });
    }

    res.status(500).json({ error: "Server error with AI" });
  }
});

// Static Pages
app.get("/signup", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "signup.html")),
);
app.get("/login", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "login.html")),
);
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "home.html")),
);

app.get("/home", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "home.html")),
);
app.get("/about", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "about.html")),
);
// Identify page
app.get("/Identify", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Identify.html"));
});

// Manage page
app.get("/Manage", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Manage.html"));
});

// Dashboard page (protected)
app.get("/Dashboard", authenticate, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Dashboard.html"));
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
