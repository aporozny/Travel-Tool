# Travel Tool - Mobile App

React Native app for iOS and Android.

## Setup

### Prerequisites
- Node.js 18+
- Xcode (iOS)
- Android Studio (Android)
- Ruby 2.7+ and Bundler (iOS pods)

### Install
```bash
npm install

# iOS
cd ios && pod install && cd ..

# Android - no extra step needed
```

### Run
```bash
# Start Metro bundler
npm start

# iOS (separate terminal)
npm run ios

# Android (separate terminal)
npm run android
```

### Environment
The API base URL is set in `src/services/api.ts`:
- Development (Android emulator): `http://10.0.2.2:5000/api/v1`
- Development (iOS simulator): `http://localhost:5000/api/v1`
- Production: update to your public API URL

For iOS simulator change `10.0.2.2` to `localhost`.

## Structure

```
src/
├── screens/
│   ├── Auth/         Login, Register
│   ├── Home/         Operator discovery
│   ├── Safety/       SOS, location, contacts
│   ├── Bookings/     Booking management
│   ├── Operators/    Operator detail
│   └── Profile/      Traveler profile
├── navigation/       React Navigation setup
├── store/            Redux Toolkit (auth slice)
├── services/         Axios API client (auto refresh)
├── types/            TypeScript interfaces
├── hooks/            Custom hooks
├── components/       Shared UI components
└── utils/            Helpers
```

## Key libraries
- Navigation: React Navigation v6
- State: Redux Toolkit
- HTTP: Axios with JWT interceptor + auto-refresh
- Secure storage: react-native-keychain
- Maps: react-native-maps
- Location: react-native-geolocation-service
