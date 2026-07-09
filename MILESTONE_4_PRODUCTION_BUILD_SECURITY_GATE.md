# Milestone 4 — Production Build Security Gate (Gate A & B)

This document details the configuration and validation logic for the Vite build security gate and the Capacitor sync wrapper.

## Gate A: Vite Production Build Gate (`security-gate.cjs`)

The `security-gate.cjs` script executes synchronously during `npm run build` or `npm run build:test`.

### Policy Enforcements
1. **APP_BUILD_PROFILE validation**: Ensures `APP_BUILD_PROFILE` is set to a recognized profile.
2. **Production constraints**:
   - Requires `VITE_API_URL` and `VITE_SOCKET_URL` to be HTTPS/WSS.
   - Ensures no loopback origins (`localhost`, `127.0.0.1`, `10.0.2.2`, `::1`) are used.
   - Ensures `TEST_HARNESS` is disabled (`false`).

---

## Gate B: Capacitor Sync Wrapper Gate (`cap-gate.cjs`)

The `cap-gate.cjs` script executes before `npx cap sync` or `npx cap copy` in production build pipelines.

### Verification Flow
1. Runs the security gate validator to confirm the current directory asset state conforms to the production profile.
2. Generates the compile-time metadata validation file `sync-attestation.json` containing hashes of the build configuration, compiled policy, and assets.
3. Fails the build early if any files are missing or mismatch the local Git workspace signature.
