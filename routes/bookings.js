// File: routes/bookings.js
// Express router for bookings with IST defaults, compact weatherInfo (minimal), preview + autoConfirm support

const express = require("express");
const router = express.Router();
const moment = require("moment-timezone");
const Booking = require("../models/Booking");
const { randomUUID } = require("crypto");

// Default timezone = IST
const DEFAULT_TZ = "Asia/Kolkata";

// Try to load weatherService (optional)
let weatherService = null;
try {
    weatherService = require("../services/weatherService");
} catch (e) {
    console.warn("[bookings] weatherService not available:", e && e.message ? e.message : e);
    weatherService = null;
}

// Helper: coerce to safe string
function asString(x) {
    if (x === undefined || x === null) return "";
    if (typeof x === "string") return x.trim();
    if (typeof x === "number" || typeof x === "boolean" || typeof x === "bigint") return String(x);
    try { return JSON.stringify(x); } catch (e) { return String(x); }
}

// words -> number (small)
function wordsToNumber(s) {
    s = (s || "").toString().toLowerCase().replace(/[-,]/g, " ").replace(/\band\b/g, " ");
    const small = {
        zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
        ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
    };
    const tens = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
    const parts = s.split(/\s+/).filter(Boolean);
    let total = 0, cur = 0;
    for (const p of parts) {
        if (small[p] != null) cur += small[p];
        else if (tens[p] != null) cur += tens[p];
        else if (p === "hundred") cur *= 100;
        else if (p === "thousand") { cur *= 1000; total += cur; cur = 0; }
        else if (!isNaN(parseInt(p, 10))) cur += parseInt(p, 10);
    }
    return total + cur;
}

// Parse booking date: interpret input as IST by default and return a Date (UTC) for storage
function parseBookingDate(value) {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value)) return value;
    const raw = String(value).trim();
    // Try YYYY-MM-DD or ISO as IST
    const m = moment.tz(raw, ["YYYY-MM-DD", moment.ISO_8601], DEFAULT_TZ);
    if (m && m.isValid()) return m.toDate(); // Date object (UTC)
    // fallback to Date constructor
    const d = new Date(raw);
    if (!isNaN(d)) return d;
    return null;
}

// Summarize suggestion into compact category/text
function summarizeSuggestion(condition, rainProb) {
    const cond = (condition || "").toString().toLowerCase();
    const pop = Number(rainProb || 0);
    if (cond.includes("clear") || cond.includes("sun") || pop < 0.2) return { category: "good", text: "Good for outdoor dining" };
    if (cond.includes("rain") || pop >= 0.4) return { category: "bad", text: "Rain likely — indoor seating recommended" };
    return { category: "moderate", text: "Weather moderate — indoor recommended for safety" };
}

// Default minimal good weather (used when service unavailable or fails)
function defaultGoodWeather(/* targetDate not needed */) {
    return {
        category: "good",
        text: "Good for outdoor dining",
        note: "default"
    };
}

// ---------- Date filter helper for counts ----------
function buildDateFilter({ date, startDate, endDate }) {
    if (date) {
        const d = moment.tz(date, DEFAULT_TZ);
        if (!d.isValid()) return null;
        return {
            bookingDate: { $gte: d.clone().startOf("day").toDate(), $lte: d.clone().endOf("day").toDate() }
        };
    }
    if (startDate || endDate) {
        const filter = {};
        if (startDate) {
            const sd = moment.tz(startDate, DEFAULT_TZ);
            if (!sd.isValid()) return null;
            filter.$gte = sd.clone().startOf("day").toDate();
        }
        if (endDate) {
            const ed = moment.tz(endDate, DEFAULT_TZ);
            if (!ed.isValid()) return null;
            filter.$lte = ed.clone().endOf("day").toDate();
        }
        return { bookingDate: filter };
    }
    return {};
}

// ---------- Count endpoints ----------
router.get('/count', async (req, res) => {
    try {
        const { date, startDate, endDate, status, seatingPreference } = req.query;
        const dateFilter = buildDateFilter({ date, startDate, endDate });
        if (dateFilter === null) return res.status(400).json({ success: false, error: 'bad_date', message: 'Invalid date format' });

        const q = { ...dateFilter };
        if (status) q.status = status;
        if (seatingPreference) q.seatingPreference = seatingPreference;

        const total = await Booking.countDocuments(q);
        return res.json({ success: true, count: total, filter: q });
    } catch (err) {
        console.error('GET /api/bookings/count error', err);
        return res.status(500).json({ success: false, error: 'server_error', message: err.message });
    }
});

router.get('/count/daily', async (req, res) => {
    try {
        let { startDate, endDate } = req.query;
        const end = endDate ? moment.tz(endDate, DEFAULT_TZ).endOf('day') : moment.tz(DEFAULT_TZ).endOf('day');
        const start = startDate ? moment.tz(startDate, DEFAULT_TZ).startOf('day') : moment(end).utc().subtract(6, 'days').startOf('day');

        if (!start.isValid() || !end.isValid()) return res.status(400).json({ success: false, error: 'bad_date', message: 'Invalid startDate or endDate' });
        if (start.isAfter(end)) return res.status(400).json({ success: false, error: 'bad_range', message: 'startDate must be <= endDate' });

        const pipeline = [
            { $match: { bookingDate: { $gte: start.toDate(), $lte: end.toDate() } } },
            { $project: { day: { $dateToString: { format: "%Y-%m-%d", date: "$bookingDate", timezone: "UTC" } } } },
            { $group: { _id: "$day", count: { $sum: 1 } } },
            { $project: { _id: 0, date: "$_id", count: 1 } },
            { $sort: { date: 1 } }
        ];

        const agg = await Booking.aggregate(pipeline);
        const aggMap = agg.reduce((m, item) => { m[item.date] = item.count; return m; }, {});
        const days = [];
        const cur = start.clone();
        while (cur.isSameOrBefore(end)) {
            const key = cur.format('YYYY-MM-DD');
            days.push({ date: key, count: aggMap[key] || 0 });
            cur.add(1, 'day');
        }

        return res.json({ success: true, start: start.toISOString(), end: end.toISOString(), daily: days });
    } catch (err) {
        console.error('GET /api/bookings/count/daily error', err);
        return res.status(500).json({ success: false, error: 'server_error', message: err.message });
    }
});

router.get('/list', async (req, res) => {
    try {
        const { startDate, endDate, status, seatingPreference, limit = 50, skip = 0 } = req.query;
        const dateFilter = buildDateFilter({ startDate, endDate });
        if (dateFilter === null) return res.status(400).json({ success: false, error: 'bad_date', message: 'Invalid date format' });

        const q = { ...dateFilter };
        if (status) q.status = status;
        if (seatingPreference) q.seatingPreference = seatingPreference;

        const list = await Booking.find(q).sort({ bookingDate: -1 }).skip(parseInt(skip, 10)).limit(Math.min(1000, parseInt(limit, 10)));
        const total = await Booking.countDocuments(q);
        return res.json({ success: true, count: list.length, total, bookings: list });
    } catch (err) {
        console.error('GET /api/bookings/list error', err);
        return res.status(500).json({ success: false, error: 'server_error', message: err.message });
    }
});

// ---------- Create booking (preview + autoConfirm) ----------
router.post("/", async (req, res) => {
    try {
        const raw = req.body || {};

        // normalize fields
        const customerName = asString(raw.customerName || raw.name || "");
        const numberOfGuests = (typeof raw.numberOfGuests === "number")
            ? raw.numberOfGuests
            : (() => {
                const s = asString(raw.numberOfGuests || raw.guests || raw.number || "");
                const m = s.match(/\d+/);
                if (m) return parseInt(m[0], 10);
                const wn = wordsToNumber(s);
                return wn || undefined;
            })();

        const bookingDateRaw = raw.bookingDate || raw.date || "";
        const bookingDate = parseBookingDate(bookingDateRaw) || null; // stored as UTC Date
        const bookingTime = asString(raw.bookingTime || raw.time || "");
        const cuisinePreference = asString(raw.cuisinePreference || raw.cuisine || "");
        const specialRequests = asString(raw.specialRequests || raw.notes || "");
        const location = raw.location || process.env.DEFAULT_LOCATION || null;

        const previewOnly = (req.query.preview === "true" || req.query.preview === true || raw.preview === true);
        const autoConfirmQuery = (req.query.autoConfirm === "true" || req.query.autoConfirm === true);
        const autoConfirmBody = (raw.autoConfirm === true);
        const autoConfirm = previewOnly && (autoConfirmQuery || autoConfirmBody);

        // validate required fields for non-preview or autoConfirm
        if (!previewOnly || autoConfirm) {
            if (!customerName || !numberOfGuests || !bookingDate || !bookingTime) {
                return res.status(400).json({ success: false, error: "missing_fields", message: "Required: customerName, numberOfGuests, bookingDate, bookingTime" });
            }
        }

        // ---------- Weather lookup (compact minimal) ----------
        let compactWeather = null;
        let weatherError = null;

        const hasWeatherService = !!weatherService;
        const hasApiKey = !!process.env.OPENWEATHERMAP_API_KEY;
        const clientProvidedDate = !!(raw.bookingDate || raw.date);

        if (!hasWeatherService || !hasApiKey || !clientProvidedDate) {
            compactWeather = defaultGoodWeather();
            weatherError = { code: "skipped", message: "weather service not used; default suggestion returned" };
        } else {
            try {
                const w = await weatherService.getWeatherForDate(bookingDate, location);
                // if service returns error shape
                if (!w || w.error) {
                    compactWeather = defaultGoodWeather();
                    weatherError = { code: w && w.error ? w.error : "no_data", message: w && w.message ? w.message : "no usable weather data" };
                } else {
                    // w may already be compact; unify shapes
                    const wi = w.weatherInfo ? w.weatherInfo : w;
                    const summary = summarizeSuggestion(wi.condition || wi.category || (wi.suggestion || ""), wi.rainProbability || wi.pop || 0);
                    compactWeather = {
                        category: summary.category,
                        text: summary.text,
                        note: wi.note || (wi.source ? wi.source : null)
                    };
                    weatherError = null;
                }
            } catch (we) {
                console.error("[bookings] weatherService threw:", we && we.message ? we.message : we);
                compactWeather = defaultGoodWeather();
                weatherError = { code: "exception", message: we && we.message ? we.message : String(we) };
            }
        }

        // seating preference
        let seatingPreference = (compactWeather && compactWeather.category === "good") ? "outdoor" : "indoor";

        // build preview object (use local IST for display)
        const bookingDateLocal = bookingDate ? moment.utc(bookingDate).tz(DEFAULT_TZ).format() : null;
        const preview = {
            customerName,
            numberOfGuests,
            bookingDate: bookingDate ? bookingDate.toISOString() : null, // UTC stored ISO
            bookingDateLocal,
            bookingTime,
            cuisinePreference,
            specialRequests,
            weatherInfo: compactWeather, // now minimal: { category, text, note? }
            seatingPreference
        };

        // if preview only and not autoConfirm -> return preview
        if (previewOnly && !autoConfirm) {
            return res.json({ success: true, preview });
        }

        // Save booking (autoConfirm or normal save)
        const booking = new Booking({
            bookingId: randomUUID(),
            customerName,
            numberOfGuests,
            bookingDate,
            bookingTime,
            cuisinePreference,
            specialRequests,
            weatherInfo: compactWeather,
            seatingPreference,
            status: "confirmed",
            createdAt: new Date()
        });

        await booking.save();

        const saved = booking.toObject();
        saved.bookingDateLocal = booking.bookingDate ? moment.utc(booking.bookingDate).tz(DEFAULT_TZ).format() : null;

        return res.status(201).json({ success: true, booking: saved });

    } catch (err) {
        console.error("Create booking error:", err && err.stack ? err.stack : err);
        return res.status(500).json({ success: false, error: "server_error", message: err && err.message ? err.message : "Server error" });
    }
});

// GET all bookings (existing root GET, returns all bookings)
// Note: to fetch with pagination/filters use /list or /all (added below)
router.get("/", async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ createdAt: -1 });
        const out = bookings.map(b => {
            const o = b.toObject();
            o.bookingDateLocal = o.bookingDate ? moment.utc(o.bookingDate).tz(DEFAULT_TZ).format() : null;
            return o;
        });
        res.json({ success: true, bookings: out });
    } catch (err) {
        console.error("Get bookings error:", err && err.stack ? err.stack : err);
        res.status(500).json({ success: false, error: err && err.message ? err.message : "Server error" });
    }
});

// ---------- Additional admin endpoints ----------

// GET /api/bookings/all
// Explicit listing (filtering + paging). Query: startDate, endDate, status, seatingPreference, limit, skip, sort
router.get('/all', async (req, res) => {
    try {
        const { startDate, endDate, status, seatingPreference, limit = 100, skip = 0, sort = '-createdAt' } = req.query;
        const dateFilter = buildDateFilter({ startDate, endDate });
        if (dateFilter === null) return res.status(400).json({ success: false, error: 'bad_date', message: 'Invalid date format' });

        const q = { ...dateFilter };
        if (status) q.status = status;
        if (seatingPreference) q.seatingPreference = seatingPreference;

        const list = await Booking.find(q).sort(sort).skip(parseInt(skip, 10)).limit(Math.min(5000, parseInt(limit, 10)));
        const total = await Booking.countDocuments(q);
        const out = list.map(b => {
            const o = b.toObject();
            o.bookingDateLocal = o.bookingDate ? moment.utc(o.bookingDate).tz(DEFAULT_TZ).format() : null;
            return o;
        });
        return res.json({ success: true, total, count: out.length, bookings: out });
    } catch (err) {
        console.error('GET /all error', err);
        return res.status(500).json({ success: false, error: 'server_error', message: err.message });
    }
});

// GET /api/bookings/today
router.get('/today', async (req, res) => {
    try {
        const start = moment.tz(DEFAULT_TZ).startOf('day').toDate();
        const end = moment.tz(DEFAULT_TZ).endOf('day').toDate();
        const bookings = await Booking.find({ bookingDate: { $gte: start, $lte: end } }).sort({ bookingTime: 1 });
        const out = bookings.map(b => {
            const o = b.toObject();
            o.bookingDateLocal = o.bookingDate ? moment.utc(o.bookingDate).tz(DEFAULT_TZ).format() : null;
            return o;
        });
        return res.json({ success: true, date: moment.tz(DEFAULT_TZ).format('YYYY-MM-DD'), count: out.length, bookings: out });
    } catch (err) {
        console.error('GET /today error', err);
        return res.status(500).json({ success: false, error: 'server_error', message: err.message });
    }
});

// PATCH /api/bookings/:id/status
// Body: { status: "cancelled" } etc.
router.patch('/:id/status', async (req, res) => {
    try {
        const { status } = req.body || {};
        if (!status) return res.status(400).json({ success: false, error: 'missing_status', message: 'Provide status in request body' });
        const updated = await Booking.findOneAndUpdate({ bookingId: req.params.id }, { $set: { status } }, { new: true });
        if (!updated) return res.status(404).json({ success: false, error: 'not_found' });
        const o = updated.toObject();
        o.bookingDateLocal = o.bookingDate ? moment.utc(o.bookingDate).tz(DEFAULT_TZ).format() : null;
        return res.json({ success: true, booking: o });
    } catch (err) {
        console.error('PATCH /:id/status error', err);
        return res.status(500).json({ success: false, error: 'server_error', message: err.message });
    }
});

// PATCH /api/bookings/:id/cancel (shortcut)
router.patch('/:id/cancel', async (req, res) => {
    try {
        const updated = await Booking.findOneAndUpdate({ bookingId: req.params.id }, { $set: { status: 'cancelled' } }, { new: true });
        if (!updated) return res.status(404).json({ success: false, error: 'not_found' });
        const o = updated.toObject();
        o.bookingDateLocal = o.bookingDate ? moment.utc(o.bookingDate).tz(DEFAULT_TZ).format() : null;
        return res.json({ success: true, booking: o });
    } catch (err) {
        console.error('PATCH /:id/cancel error', err);
        return res.status(500).json({ success: false, error: 'server_error', message: err.message });
    }
});

// DELETE /api/bookings/bulk
// Body: { ids: ["bookingId1","bookingId2", ...] }
router.delete('/bulk', async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ success: false, error: 'missing_ids', message: 'Provide array of bookingIds in body.ids' });
        const result = await Booking.deleteMany({ bookingId: { $in: ids } });
        return res.json({ success: true, deletedCount: result.deletedCount || 0 });
    } catch (err) {
        console.error('DELETE /bulk error', err);
        return res.status(500).json({ success: false, error: 'server_error', message: err.message });
    }
});

// Get booking by bookingId
router.get("/:id", async (req, res) => {
    try {
        const booking = await Booking.findOne({ bookingId: req.params.id });
        if (!booking) return res.status(404).json({ success: false, error: "Not found" });
        const o = booking.toObject();
        o.bookingDateLocal = o.bookingDate ? moment.utc(o.bookingDate).tz(DEFAULT_TZ).format() : null;
        res.json({ success: true, booking: o });
    } catch (err) {
        console.error("Get booking error:", err && err.stack ? err.stack : err);
        res.status(500).json({ success: false, error: err && err.message ? err.message : "Server error" });
    }
});

// Delete booking (existing)
router.delete("/:id", async (req, res) => {
    try {
        const result = await Booking.findOneAndDelete({ bookingId: req.params.id });
        if (!result) return res.status(404).json({ success: false, error: "Not found" });
        res.json({ success: true });
    } catch (err) {
        console.error("Delete booking error:", err && err.stack ? err.stack : err);
        res.status(500).json({ success: false, error: err && err.message ? err.message : "Server error" });
    }
});

module.exports = router;
