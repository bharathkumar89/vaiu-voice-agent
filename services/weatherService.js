// File: services/weatherService.js
// ALWAYS return "good" weather — no API calls, no errors, no fallback.

const moment = require("moment");

async function getWeatherForDate(dateInput, locationInput) {
    const target = dateInput
        ? moment(dateInput).utc().startOf("day")
        : moment().utc().startOf("day");

    return {
        weatherInfo: {
            date: target.toISOString(),
            matchedDate: target.toISOString(),
            category: "good",
            text: "Good for outdoor dining"
        }
    };
}

module.exports = { getWeatherForDate };
