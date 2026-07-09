# Milestone 4 — Phase 2D Baseline Specification

This document freezes and registers the exact host environment, dependency toolchains, and initial workspace status before executing Android native runtime scenario verification.

---

## 1. System & Toolchain Specifications

- **Branch**: `feature/m4-pre-capacitor-remediation`
- **HEAD Commit**: `7451df654c674f95dfdb21a86f7aa562ef611b81`
- **Node.js version**: `v22.20.0`
- **npm version**: `10.9.3`
- **Java SDK version**: `Temurin openjdk version "17.0.18" 2026-01-20` (host default) / `OpenJDK 21.0.11` (explicit Gradle target)
- **Android Debug Bridge (adb)**: `1.0.41 (Version 37.0.0-14910828)`
- **Android Emulator**: `36.6.11.0 (build_id 15507667)`
- **Android minSdkVersion / targetSdkVersion**: `24` / `36`

---

## 2. Server Runtime Configuration

- **PORT**: `5001`
- **NODE_ENV**: `development`
- **Database Connection**: MongoDB Atlas cloud cluster (`Cluster5`)
- **Upload Storage**: Local disk fallback (Cloudinary credentials unconfigured)

---

## 3. Compilation & Test Verification Status

- **Client production build (`npm run build`)**: **PASS**
- **Client test execution (`npm test`)**: **PASS** (94 passed / 94 total)
- **Server production build (`npm run build`)**: **PASS**
- **Android clean debug compile (`./gradlew clean assembleDebug`)**: **PASS**

---

## 4. Current Authoritative Verdict

**CONDITIONAL PASS — AUTOMATED SECURITY VERIFICATION COMPLETE, NATIVE RUNTIME VERIFICATION REMAINS**

**All automated architectural, lifecycle, E2EE, and cookie validation tests pass. Direct verification in native WebView runtime environments remains uncompleted for the comprehensive scenario matrix.**
