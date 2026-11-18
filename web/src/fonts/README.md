# Self-hosted fonts

- **DM Sans** (variable, weights 400 to 700) and **DM Serif Display**, from the
  Google Fonts project (github.com/googlefonts/dm-fonts and
  github.com/googlefonts/dm-serif-display). Downloaded 18 Nov 2026 as woff2, Latin and
  Latin Extended subsets only.
- Licence: SIL Open Font License 1.1 (openfontlicense.org). Free to use, embed and
  redistribute with the app; the fonts must not be sold on their own.
- `fonts.css` is imported by `src/index.web.tsx`. webpack hashes and copies the files into
  `dist`, so nginx serves them from our own domain.
