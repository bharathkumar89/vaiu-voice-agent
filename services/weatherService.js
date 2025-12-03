const axios = require("axios");
const moment = require("moment");

const KEY = process.env.OPENWEATHERMAP_API_KEY;
const DEFAULT_LOC = process.env.DEFAULT_LOCATION || "12.9716,77.5946";

async function getWeatherForDate(dateStr, location) {
    try {
        const target = moment(dateStr).startOf("day");
        const [lat, lon] = (location || DEFAULT_LOC).split(",").map(Number);

        // OpenWeather One Call (daily)
        const url = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,alerts&units=metric&appid=${KEY}`;
        const res = await axios.get(url);
        const daily = res.data.daily || [];

        if (!daily.length) return null;

        // pick the daily entry closest to booking date
        let closest = daily.reduce((best, cur) => {
            if (!best) return cur;
            const bestDiff = Math.abs(moment.unix(best.dt).startOf("day").diff(target));
            const curDiff = Math.abs(moment.unix(cur.dt).startOf("day").diff(target));
            return curDiff < bestDiff ? cur : best;
        }, null);

        const condition = (closest.weather && closest.weather[0] && closest.weather[0].main || "").toLowerCase();
        const rainProb = closest.pop || 0;

        let suggestion = "Indoor seating is recommended.";
        let suggestOutdoor = false;

        if (condition.includes("clear") || condition.includes("sun") || rainProb < 0.2) {
            suggestion = "Perfect weather for outdoor dining!";
            suggestOutdoor = true;
        } else if (condition.includes("rain") || rainProb >= 0.4) {
            suggestion = "It might rain on the selected date. Indoor seating would be better.";
        } else {
            suggestion = "Weather looks moderate. Indoor seating is safer.";
        }

        return {
            date: target.toISOString(),
            condition,
            rainProbability: rainProb,
            temp: closest.temp || {},
            suggestion,
            suggestOutdoor,
            raw: closest
        };
    } catch (err) {
        console.error("Weather API error:", err.message);
        return null;
    }
}

module.exports = { getWeatherForDate };
