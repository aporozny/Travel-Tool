
## Database schema notes

### operators table
- `user_id` has a UNIQUE constraint — one user per operator listing
- To add operator listings programmatically, create a dedicated system user first
- System users use `password_hash = 'system'` and role = 'operator'
- Pre-created system users: tapasita@drifttravel.app, penidaproject@drifttravel.app, operators@drifttravel.app

### places_cache table
- Primary key is `id` (UUID), unique constraint is on `(external_id, source)`
- `source = 'google_places_v2'` = new Places API (has working photos)
- `source = 'google'` or `'google_places'` = old format (photos broken, filtered out of recommendations)
- Recommendations query filters to `source = 'google_places_v2'` only
- `expires_at` must be > NOW() or places won't appear — run UPDATE if all expired
- `country` defaults to 'Indonesia' — Albania places set to 'Albania'

### users table  
- Roles: traveler, operator, admin
- sarah.chen@drifttest.com is the admin test account
- operators@drifttravel.app is a system operator account (user_id: 2f08328d-8f50-4615-8224-1d6c8d1b5950)
