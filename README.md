# Ottawa Painters React Native App

A cross-platform React Native app for Ottawa Painters employee clock-ins, project sync, CompanyCam photos, timesheets, and backend-created employee accounts.

## Stack
- React Native
- Expo
- Supabase Auth, tables, RLS, and Edge Functions
- CompanyCam project/photo sync

## Local setup
1. Install dependencies
   - `npm install`
2. Start Metro
   - `npm start`
3. Open on:
   - iOS: scan with Expo Go or run `npm run ios` (requires Xcode + simulator)
   - Android: scan with Expo Go or run `npm run android` (requires Android Studio + emulator)

## Office workflow
Employee accounts and project assignments are managed from the backend, not from sign-up inside the app.

Required env values:
- `ASSIGNMENT_ADMIN_TOKEN`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` or `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Commands:
- `npm run office -- list`
- `npm run office -- create-employee --email painter@example.com --name "Painter Name"`
- `npm run office -- assign --email painter@example.com --project "Tyler Duncan"`
- `npm run office -- remove --email painter@example.com --project "Tyler Duncan"`
- `npm run office -- projects --search "Duncan"`

## Important files
- `App.js` app shell, tabs, and shared tracking state
- `src/lib/timeTracking.js` clock-in, active shift, location status, offline queue, and Supabase writes
- `src/screens` app screens
- `supabase/migrations` database schema
- `supabase/functions` CompanyCam sync, photo sync, geocoding, and project assignment functions
- `scripts/office.cjs` backend/office employee and assignment CLI
