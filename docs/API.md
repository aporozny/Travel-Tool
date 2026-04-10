# Traveller API Reference

Base URL: `http://localhost:5000/api/v1`

## Auth

### POST /auth/register
Register a new user.

Body:
```json
{
  "email": "user@example.com",
  "password": "min8chars",
  "role": "traveler" | "operator"
}
```

Response: `201 Created`
```json
{
  "user": { "id": "uuid", "email": "...", "role": "..." },
  "accessToken": "jwt...",
  "refreshToken": "jwt..."
}
```

### POST /auth/login
Body: `{ "email": "...", "password": "..." }`
Response: Same as register.

### POST /auth/refresh
Body: `{ "refreshToken": "..." }`
Response: `{ "accessToken": "..." }`

### POST /auth/logout
Header: `Authorization: Bearer <token>`
Body: `{ "refreshToken": "..." }`
Response: `204 No Content`

---

## Travelers

All routes require `Authorization: Bearer <token>`.

### GET /travelers/me
Returns the authenticated traveler's profile.

### PATCH /travelers/me
Update profile fields.

### GET /travelers/me/preferences
### PUT /travelers/me/preferences

---

## Operators

### GET /operators
Query params: `region`, `category`, `tier`, `lat`, `lng`, `radius`

### GET /operators/:id
### POST /operators (auth required, role: operator)
### PATCH /operators/:id (auth required, own record)

---

## Bookings

### POST /bookings
```json
{
  "operatorId": "uuid",
  "startDate": "2026-05-01",
  "endDate": "2026-05-03",
  "guests": 2,
  "notes": "optional"
}
```

### GET /bookings/:id
### PATCH /bookings/:id/status
Body: `{ "status": "confirmed" | "cancelled" | "completed" }`

---

## Safety

### POST /safety/location
```json
{
  "latitude": -8.7278,
  "longitude": 115.1699,
  "accuracy": 10,
  "timestamp": 1744300000
}
```

### GET /safety/location/history
Query: `from`, `to` (ISO dates)

### POST /safety/contacts
```json
{
  "name": "Mum",
  "email": "mum@example.com",
  "phone": "+61400000000",
  "relationship": "mother"
}
```

### GET /safety/contacts

### POST /safety/sos
```json
{
  "message": "optional context"
}
```
