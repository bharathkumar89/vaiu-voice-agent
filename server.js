require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const bookingsRoute = require("./routes/bookings");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves public/index.html

// Routes
app.use("/api/bookings", bookingsRoute);

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/vaiu";

mongoose.set('strictQuery', false);
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("MongoDB Connected");
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch(err => {
        console.error("DB connection error:", err.message);
        process.exit(1);
    });
