"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseOrder = void 0;
const https_1 = require("firebase-functions/v2/https");
// Milestone 10 will replace this stub with the real Anthropic call + fallback.
// Kept here so the callable name is stable and the client can be wired ahead of time.
exports.parseOrder = (0, https_1.onCall)({ region: 'us-central1' }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    return { fallback: true, lines: [] };
});
