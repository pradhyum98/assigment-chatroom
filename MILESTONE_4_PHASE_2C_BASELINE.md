# Milestone 4 — Phase 2C Baseline Specification

This document freezes and registers the exact host environment, dependency toolchains, and initial workspace status before executing Android native runtime enablement.

---

## 1. System & Toolchain Specifications

- **Branch**: `feature/m4-pre-capacitor-remediation`
- **HEAD Commit**: `7451df654c674f95dfdb21a86f7aa562ef611b81`
- **Node.js version**: `v22.20.0`
- **npm version**: `10.9.3`
- **Initial JVM version**: `Adoptium OpenJDK 17.0.18` (Active JVM on host startup)
- **Target JDK version required**: `JDK 21` (Required by Capacitor 6/8 compileSdk 36 build targets)
- **Gradle wrapper version**: `8.14.3` (Defined in `gradle-wrapper.properties`)
- **Android Gradle Plugin (AGP) version**: `8.13.0`
- **Capacitor Core/Android versions**: `8.4.1`
- **Android SDK Path**: `/Users/pradhyumupadhyay/Library/Android/sdk`
- **Android minSdkVersion / targetSdkVersion**: `24` / `36`
- **Configured Android AVDs**: `Pixel_8`, `Pixel_API_34`
- **iOS deployment target**: `15.0`
- **Xcode version**: **NOT EXECUTED — TOOLCHAIN/XCODE UNAVAILABLE** (Xcode developer toolchain is not active on this host).

---

## 2. Server Runtime Configuration

- **PORT**: `5001`
- **NODE_ENV**: `development`
- **Database Connection**: MongoDB Atlas cloud cluster (`Cluster5`)
- **Upload Storage**: Local disk fallback (Cloudinary credentials unconfigured)

---

## 3. Compilation & Test Verification Status

- **Client production build (`npm run build`)**: **PASS**
- **Server production build (`npm run build`)**: **PASS**
- **Client test execution (`npm test`)**: **PASS** (91 passed / 91 total)
- **Server test execution (`npm test`)**: **PASS** (79 passed / 79 total)

**Baseline Status: GREEN. Ready to proceed to toolchain environment correction.**
