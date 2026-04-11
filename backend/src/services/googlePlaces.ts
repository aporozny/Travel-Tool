import axios from 'axios';

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

const TYPE_MAP: Record<string, string> = {
  restaurant: 'food', food: 'food', cafe: 'food', bar: 'food',
  meal_takeaway: 'food', bakery: 'food',
  lodging: 'accommodation', hotel: 'accommodation',
  tourist_attraction: 'activity', amusement_park: 'activity',
  aquarium: 'activity', museum: 'activity', park: 'activity',
  spa: 'activity', gym: 'activity', travel_agency: 'activity',
  car_rental: 'transport', taxi_stand: 'transport',
};

function mapCategory(types: string[]): string {
  for (const t of types) {
    if (TYPE_MAP[t]) return TYPE_MAP[t];
  }
  return 'activity';
}

export interface PlaceResult {
  external_id: string;
  source: 'google';
  name: string;
  category: string;
  description: string | null;
  address: string | null;
  region: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number;
  price_level: number | null;
  photos: string[]; // photo references only, not full URLs
  opening_hours: any;
  tags: string[];
  raw_data: any;
}

export async function searchPlaces(query: string, region: string): Promise<PlaceResult[]> {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const { data } = await axios.get(
    'https://maps.googleapis.com/maps/api/place/textsearch/json',
    {
      params: {
        query: `${query} ${region} Bali Indonesia`,
        key: GOOGLE_API_KEY,
        language: 'en',
        region: 'id',
      },
    }
  );

  if (data.status === 'ZERO_RESULTS') return [];
  if (data.status !== 'OK') {
    throw new Error(`Google Places API error: ${data.status} - ${data.error_message || ''}`);
  }

  return (data.results || []).map((place: any): PlaceResult => ({
    external_id: place.place_id,
    source: 'google',
    name: place.name,
    category: mapCategory(place.types || []),
    description: null,
    address: place.formatted_address || null,
    region,
    country: 'Indonesia',
    latitude: place.geometry?.location?.lat || null,
    longitude: place.geometry?.location?.lng || null,
    phone: null,
    website: null,
    rating: place.rating || null,
    review_count: place.user_ratings_total || 0,
    price_level: place.price_level || null,
    // Store only photo references, not full URLs with API key
    photos: (place.photos || []).slice(0, 5).map((p: any) => p.photo_reference),
    opening_hours: place.opening_hours || null,
    tags: (place.types || []).filter((t: string) =>
      !['point_of_interest', 'establishment'].includes(t)
    ),
    raw_data: {
      place_id: place.place_id,
      types: place.types,
      name: place.name,
    }, // stripped raw_data - no need to store full response
  }));
}

export async function getPlaceDetails(placeId: string): Promise<Partial<PlaceResult>> {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const { data } = await axios.get(
    'https://maps.googleapis.com/maps/api/place/details/json',
    {
      params: {
        place_id: placeId,
        fields: 'formatted_phone_number,website,opening_hours,editorial_summary,address_components',
        key: GOOGLE_API_KEY,
        language: 'en',
      },
    }
  );

  if (data.status !== 'OK') throw new Error(`Google Place Details error: ${data.status}`);

  const r = data.result;
  const sublocality = (r.address_components || []).find((c: any) =>
    c.types.includes('sublocality') || c.types.includes('locality')
  );

  return {
    phone: r.formatted_phone_number || null,
    website: r.website || null,
    description: r.editorial_summary?.overview || null,
    opening_hours: r.opening_hours || null,
    region: sublocality?.long_name || null,
  };
}

// Proxy: fetch photo from Google using reference, return buffer
export async function fetchPhotoBuffer(
  photoReference: string,
  maxWidth = 800
): Promise<{ data: Buffer; contentType: string }> {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const response = await axios.get(
    'https://maps.googleapis.com/maps/api/place/photo',
    {
      params: { maxwidth: maxWidth, photo_reference: photoReference, key: GOOGLE_API_KEY },
      responseType: 'arraybuffer',
    }
  );

  return {
    data: Buffer.from(response.data),
    contentType: response.headers['content-type'] || 'image/jpeg',
  };
}
