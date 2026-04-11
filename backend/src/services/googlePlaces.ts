import axios from 'axios';

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

const TYPE_MAP: Record<string, string> = {
  restaurant: 'food', food: 'food', cafe: 'food', bar: 'food',
  meal_takeaway: 'food', bakery: 'food',
  lodging: 'accommodation', hotel: 'accommodation',
  tourist_attraction: 'activity', amusement_park: 'activity',
  aquarium: 'activity', museum: 'activity', park: 'activity',
  spa: 'activity', gym: 'activity', travel_agency: 'activity',
  scuba_diving: 'activity', surfing: 'activity',
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
  photos: string[];
  opening_hours: any;
  tags: string[];
  raw_data: any;
}

// Use Text Search API (works with standard Places API key)
export async function searchPlaces(query: string, region: string): Promise<PlaceResult[]> {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const searchQuery = `${query} ${region} Bali Indonesia`;

  const { data } = await axios.get(
    'https://maps.googleapis.com/maps/api/place/textsearch/json',
    {
      params: {
        query: searchQuery,
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
    region: region,
    country: 'Indonesia',
    latitude: place.geometry?.location?.lat || null,
    longitude: place.geometry?.location?.lng || null,
    phone: null,
    website: null,
    rating: place.rating || null,
    review_count: place.user_ratings_total || 0,
    price_level: place.price_level || null,
    photos: (place.photos || []).slice(0, 5).map((p: any) =>
      `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${p.photo_reference}&key=${GOOGLE_API_KEY}`
    ),
    opening_hours: place.opening_hours || null,
    tags: (place.types || []).filter((t: string) =>
      !['point_of_interest', 'establishment'].includes(t)
    ),
    raw_data: place,
  }));
}

// Get full details for a single place
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

  if (data.status !== 'OK') {
    throw new Error(`Google Place Details error: ${data.status}`);
  }

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
