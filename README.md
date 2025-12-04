This project is a voice-enabled restaurant booking assistant built using Node.js, Express, MongoDB, and the Web Speech API. The system allows users to speak naturally to provide their booking details, including name, number of guests, preferred date and time, cuisine preference, and special requests. It supports smart speech parsing, converting spoken numbers and natural date expressions (like “20 August 2025” or “August 20”) into accurate structured data. If the user does not specify a year, the system automatically assigns the current year. The application also integrates with the OpenWeather API to fetch real-time weather forecasts for the booking date and suggests indoor or outdoor seating accordingly.
The frontend, built in a single HTML file, includes voice prompts, text-to-speech responses, a microphone audio-level meter, and an editable booking summary before confirmation. Users can review, edit, preview, and finally confirm their booking, which is then stored in MongoDB along with weather details and seating recommendations. A stop and reset mechanism ensures that the voice flow can be restarted smoothly at any time.
This project demonstrates full-stack development, conversational AI logic, third-party API integration, and clean UI handling. It meets all core requirements of the Vaiu AI Software Developer Internship assignment, including voice interaction, weather-based reasoning, REST APIs, database storage, and a working demo video.
I used the Web Speech API to handle speech-to-text and text-to-speech, enabling a fully voice-driven booking flow. The backend was built using Node.js/Express with MongoDB Atlas for storing reservations. The system integrates the OpenWeather API and smart date parsing to provide accurate weather-based seating suggestions.
How the Voice Flow Works
steps:
Click Start Voice Flow
Agent speaks → asks question
User answers via microphone
UI updates each field in real time
After all fields → Preview step
Weather fetched + Indoor/Outdoor suggestion
User confirms via voice or button
Booking saved to MongoDB
