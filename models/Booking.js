// models/Booking.js
const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema({
    bookingId: { type: String, required: true, unique: true },
    customerName: String,
    numberOfGuests: Number,
    bookingDate: Date,
    bookingTime: String,
    cuisinePreference: String,
    specialRequests: String,
    weatherInfo: Object,
    seatingPreference: String,
    status: { type: String, default: "confirmed" },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Booking", BookingSchema);
