---
name: Raven project overview
description: Tech decisions, phase status, and key file locations for the Raven chat app.
---

## Status
- Phase 1 (backend): complete and verified
- Phase 2 (mobile app + real-time): complete

## Tech stack
- Backend: Express 5 + Node 24 + TypeScript (ESM), PostgreSQL + Drizzle ORM
- Mobile: Expo Router (file-based routing), React Query, expo-secure-store, react-native-keyboard-controller
- Real-time: WebSocket via `ws` package on same HTTP server as REST API (`/ws` path)
- Auth: JWT (HS256, 24h), stored in expo-secure-store under key `raven_auth_token`
- API base: `https://${EXPO_PUBLIC_DOMAIN}/api` — EXPO_PUBLIC_DOMAIN injected from $REPLIT_DEV_DOMAIN in dev script

## Key decisions
- Expo Router chosen over React Navigation (brief said RN but Expo Router is the standard)
- Auth redirect handled by AuthGate component inside AuthProvider in root _layout.tsx
- Token storage: expo-secure-store (not AsyncStorage) — per brief requirement
- No EAS builds yet — BUILD_SETUP.md documents the steps when user gets Apple Dev account

## Mobile app screens
- (auth)/invite.tsx — invite token entry
- (auth)/otp.tsx — OTP request + 6-digit verify
- (tabs)/index.tsx — group list (React Query)
- (tabs)/profile.tsx — member info + logout
- group/[id]/index.tsx — chat screen (inverted FlatList + WebSocket)
- group/[id]/members.tsx — member list

## Brand colors
Background #1A1A3C, primary #F87920, alert #EC5837, text #F2F2F2
