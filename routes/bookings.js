// routes/bookings.js
const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const { randomUUID } = require("crypto");
const moment = require("moment-timezone");

const weatherService = require("../services/weatherService"); // keep your existing service

/**
 * Inline parser: parse booking date and time (natural-ish) into a UTC Date.
 * Returns { utcDate, localISO, debug } or null if invalid.
 */
function parseBookingDateTime(dateStr, timeStr, tz = "Asia/Kolkata") {
    if (!dateStr || !timeStr) return null;

    // capture hints like 'morning', 'afternoon', 'evening', 'night'
    const hintMatch = timeStr.match(/\b(morning|afternoon|evening|night)\b/i);
    const hint = hintMatch ? hintMatch[0].toLowerCase() : null;

    // normalize: remove hint words and punctuation like dots in "p.m."
    let timeNormalized = timeStr.replace(/\b(morning|afternoon|evening|night)\b/ig, "").trim();
    timeNormalized = timeNormalized.replace(/\./g, "").replace(/\s+/g, " ").trim();

    // if no numeric time present, set defaults based on hint
    if (!/[0-9]/.test(timeNormalized)) {
        if (hint === "evening") timeNormalized = "6:00 PM";
        else if (hint === "afternoon") timeNormalized = "2:00 PM";
        else if (hint === "morning") timeNormalized = "9:00 AM";
        else timeNormalized = "6:00 PM";
    }

    // time formats to attempt
    const timeFormats = ["h:mm a", "hh:mm a", "H:mm", "HH:mm", "h a"];

    // parse date: prefer ISO, then common formats, then relaxed fallback
    let parsedDate = null;
    const isoLike = moment(dateStr, moment.ISO_8601, true);
    if (isoLike.isValid()) parsedDate = isoLike;
    else {
        const dateFormats = ["MMMM D YYYY", "MMMM D", "D MMMM YYYY", "D MMMM", "YYYY-MM-DD", "DD-MM-YYYY", "MM-DD-YYYY"];
        for (const fmt of dateFormats) {
            const m = moment(dateStr, fmt, true);
            if (m.isValid()) { parsedDate = m; break; }
        }
    }
    if (!parsedDate) {
        const relaxed = moment(dateStr);
        if (relaxed.isValid()) parsedDate = relaxed;
    }
    if (!parsedDate || !parsedDate.isValid()) return null;

    // handle bogus fallback years (e.g., 2001) by setting to current year and bumping if passed
    const currentYear = moment().year();
    if (parsedDate.year() < currentYear - 10 || parsedDate.year() < 1900) {
        parsedDate.year(currentYear);
        if (parsedDate.isBefore(moment().startOf("day"))) parsedDate.add(1, "year");
    }

    // combine date + time using first matching format
    let timeMoment = null;
    for (const tf of timeFormats) {
        const comb = moment.tz(`${parsedDate.format("YYYY-MM-DD")} ${timeNormalized}`, `YYYY-MM-DD ${tf}`, tz, true);
        if (comb.isValid()) { timeMoment = comb; break; }
    }
    // forgiving fallback
    if (!timeMoment) timeMoment = moment.tz(`${parsedDate.format("YYYY-MM-DD")} ${timeNormalized}`, tz);

    if (!timeMoment || !timeMoment.isValid()) return null;

    const utcDate = timeMoment.clone().utc().toDate();

    return {
        utcDate,
        localISO: timeMoment.format(),
        debug: {
            input: { dateStr, timeStr, hint, timeNormalized },
            parsedLocal: timeMoment.format(),
            parsedUTC: timeMoment.clone().utc().format()
        }
    };
}

/**
 * POST /api/bookings
 * Body:
 * {
 *   customerName,
 *   numberOfGuests,
 *   bookingDate, // e.g. "August 20" or "2025-08-20"
 *   bookingTime, // e.g. "evening 6:00 p.m." or "18:00"
 *   cuisinePreference,
 *   specialRequests,
 *   location, // optional "City,COUNTRY" or "lat,lon"
 *   preview // optional boolean -> if true, return weather+suggestion without saving
 * }
 */
router.post("/", async (req, res) => {
    try {
        const {
            customerName,
            numberOfGuests,
            bookingDate,
            bookingTime,
            cuisinePreference,
            specialRequests,
            location,
            preview
        } = req.body;

        if (!customerName || !numberOfGuests || !bookingDate || !bookingTime) {
            return res.status(400).json({ success: false, error: "Missing required fields: customerName, numberOfGuests, bookingDate, bookingTime" });
        }

        // parse date/time into UTC Date
        const parsed = parseBookingDateTime(bookingDate, bookingTime, "Asia/Kolkata");
        if (!parsed) {
            return res.status(400).json({ success: false, error: "Could not parse bookingDate/bookingTime" });
        }
        const utcDate = parsed.utcDate;
        console.log("Parsed booking date/time:", parsed.debug);

        // fetch weather for the specific booking date/time
        // weatherService.getWeatherForDate should accept a Date and location
        let weatherInfo = null;
        try {
            weatherInfo = await weatherService.getWeatherForDate(utcDate, location);
        } catch (werr) {
            console.warn("Weather fetch failed:", werr && werr.message ? werr.message : werr);
            weatherInfo = null;
        }

        // derive seating suggestion
        let seatingPreference = "unspecified";
        if (weatherInfo && typeof weatherInfo.suggestOutdoor === "boolean") {
            seatingPreference = weatherInfo.suggestOutdoor ? "outdoor" : "indoor";
        } else if (weatherInfo && weatherInfo.main) {
            const cond = String(weatherInfo.main).toLowerCase();
            if (cond.includes("rain") || cond.includes("thunder") || cond.includes("drizzle") || cond.includes("snow")) seatingPreference = "indoor";
            else if (cond.includes("clear") || cond.includes("sun")) seatingPreference = "outdoor";
            else seatingPreference = "unspecified";
        }

        // If preview requested, return weather + suggestion without saving
        if (req.query.preview === "true" || preview === true) {
            return res.json({
                success: true,
                preview: {
                    bookingDate: parsed.localISO,
                    bookingDateUTC: utcDate.toISOString(),
                    weatherInfo,
                    seatingPreference
                }
            });
        }

        // create booking document
        const booking = new Booking({
            bookingId: randomUUID(),
            customerName,
            numberOfGuests,
            bookingDate: utcDate, // store UTC Date in DB
            bookingTime: moment.tz(utcDate, "Asia/Kolkata").format("h:mm A"),
            cuisinePreference,
            specialRequests,
            weatherInfo,
            seatingPreference,
            status: "confirmed",
            createdAt: new Date()
        });

        await booking.save();

        return res.status(201).json({ success: true, booking });
    } catch (err) {
        console.error("Create booking error:", err);
        return res.status(500).json({ success: false, error: err.message || "Server error" });
    }
});

// GET /api/bookings
router.get("/", async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ createdAt: -1 });
        res.json({ success: true, bookings });
    } catch (err) {
        console.error("Fetch bookings error:", err);
        res.status(500).json({ success: false, error: err.message || "Server error" });
    }
});

// GET /api/bookings/:id
router.get("/:id", async (req, res) => {
    try {
        const booking = await Booking.findOne({ bookingId: req.params.id });
        if (!booking) return res.status(404).json({ success: false, error: "Not found" });
        res.json({ success: true, booking });
    } catch (err) {
        console.error("Get booking error:", err);
        res.status(500).json({ success: false, error: err.message || "Server error" });
    }
});

// DELETE /api/bookings/:id
router.delete("/:id", async (req, res) => {
    try {
        const result = await Booking.findOneAndDelete({ bookingId: req.params.id });
        if (!result) return res.status(404).json({ success: false, error: "Not found" });
        res.json({ success: true });
    } catch (err) {
        console.error("Delete booking error:", err);
        res.status(500).json({ success: false, error: err.message || "Server error" });
    }
});

module.exports = router;
