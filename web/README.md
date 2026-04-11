# Travel Tool - Web App

Browser interface built with React + TypeScript. Shares types and API logic with the mobile app.

## Structure

```
web/
├── public/index.html       Entry HTML
├── src/
│   ├── index.web.tsx       React root
│   ├── App.web.tsx         Auth gate
│   ├── store/              Redux store (localStorage tokens)
│   ├── services/           Axios client
│   └── screens/            Web-specific screens
│       ├── LoginScreen.web.tsx
│       ├── AppShell.web.tsx   (sidebar nav)
│       ├── ExploreScreen.web.tsx
│       ├── BookingsScreen.web.tsx
│       ├── SafetyScreen.web.tsx
│       └── ProfileScreen.web.tsx
├── webpack.config.js
├── babel.config.js
└── tsconfig.json
```

## Dev setup

```bash
cd web
npm install
npm start          # http://localhost:3000
```

## Build for production

```bash
npm run build      # outputs to web/dist/
```

## Notes

- Shares TypeScript types from mobile/app/src/types/
- API client uses localStorage (not Keychain like mobile)
- No React Native Web dependency needed - web screens use plain React + HTML/CSS
- Mobile screens use React Native components, web screens use HTML elements
- Both hit the same backend API at localhost:5000 (dev) or api.travel-tool.com (prod)
