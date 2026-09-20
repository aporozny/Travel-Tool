airports.json: airport lookup keyed by IATA code (timezone, ISO-2 country, city, name).

Source: mwgg/Airports, https://github.com/mwgg/Airports, MIT licence
(Copyright (c) 2016 mwgg). Reduced to the fields Drift needs by
scripts/build-airports.py; regenerate with `python3 scripts/build-airports.py`.

Used to turn the local flight times TripGic stores (no timezone) into exact
moments for trip reminders. Bali (DPS) is Asia/Makassar, UTC+8.
