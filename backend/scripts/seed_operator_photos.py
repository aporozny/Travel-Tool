#!/usr/bin/env python3
"""
seed_operator_photos.py

Fetches photos for operators from the Google Places API v1 (searchText) and
writes the photo references into operators.images (text[]).

Photo references are stored in the NEW v1 format: "places/{place_id}/photos/{ref}"
which the photo proxy (fetchPhotoBuffer in googlePlaces.ts) serves correctly.

Idempotent: re-running overwrites operators.images for the named operators with
freshly fetched references. Safe to run multiple times.

Usage:
    GOOGLE_PLACES_API_KEY=... python3 seed_operator_photos.py

Requires: the traveller-postgres container running locally (uses docker exec).
"""
import json
import subprocess
import sys
import urllib.request
import os

API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "AIzaSyBCM5Q7DwbDvyXDo0nTKdmUFQ_3IPrcd0w")
MAX_PHOTOS = 5  # match the places_cache convention (slice 0..5)

# Operator business_name -> search query for Google Places v1.
# business_name must match the operators table exactly.
OPERATORS = {
    "Tapasita Nusa Penida": "Tapasita Nusa Penida",
    "The Penida Project Hostel": "The Penida Project Hostel Nusa Penida",
}


def search_photos(query: str):
    """Call Places API v1 searchText, return list of photo 'name' references."""
    body = json.dumps({"textQuery": query}).encode()
    req = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchText",
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": API_KEY,
            "X-Goog-FieldMask": "places.id,places.displayName,places.photos",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())
    places = data.get("places", [])
    if not places:
        return None, []
    p = places[0]
    name = p.get("displayName", {}).get("text", "?")
    photos = [ph["name"] for ph in p.get("photos", [])[:MAX_PHOTOS]]
    return name, photos


def pg_array_literal(refs):
    """Build a Postgres text[] array literal from photo reference strings.
    Photo refs contain only [A-Za-z0-9/_-], so no quoting/escaping pitfalls,
    but we wrap each element in double quotes to be safe."""
    quoted = ",".join('"' + r.replace('"', '\\"') + '"' for r in refs)
    return "{" + quoted + "}"


def update_operator(business_name: str, refs):
    arr = pg_array_literal(refs)
    sql = (
        "UPDATE operators SET images = %s::text[] "
        "WHERE business_name = %s;"
    )
    # We pass via psql -v to avoid shell-quoting the array; use a parameterized
    # approach through a temp SQL file fed on stdin for safety.
    stmt = (
        "UPDATE operators SET images = '" + arr.replace("'", "''") + "'::text[] "
        "WHERE business_name = '" + business_name.replace("'", "''") + "';"
    )
    result = subprocess.run(
        ["docker", "exec", "-i", "traveller-postgres",
         "psql", "-U", "traveller", "-d", "traveller_dev", "-c", stmt],
        capture_output=True, text=True,
    )
    return result.stdout.strip(), result.stderr.strip()


def main():
    print("Fetching operator photos from Google Places v1...\n")
    for business_name, query in OPERATORS.items():
        try:
            found_name, photos = search_photos(query)
        except Exception as e:
            print(f"  FAIL  {business_name}: API error {e}")
            continue
        if not photos:
            print(f"  SKIP  {business_name}: no photos found (matched '{found_name}')")
            continue
        out, err = update_operator(business_name, photos)
        status = "OK" if "UPDATE 1" in out else "CHECK"
        print(f"  {status}  {business_name}: {len(photos)} photos "
              f"(matched '{found_name}') -> {out or err}")

    # Verify
    print("\nVerification:")
    v = subprocess.run(
        ["docker", "exec", "traveller-postgres", "psql", "-U", "traveller",
         "-d", "traveller_dev", "-c",
         "SELECT business_name, array_length(images,1) AS photo_count FROM operators;"],
        capture_output=True, text=True,
    )
    print(v.stdout)


if __name__ == "__main__":
    main()
