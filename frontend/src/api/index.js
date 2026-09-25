// ============================================================
// The integration seam. Every screen imports { api } from here.
// Mock vs live is decided in one place: src/api/config.js
// ============================================================
import { USE_MOCK_API } from "./config.js";
import { mockApi } from "../mock/api.js";
import { liveApi } from "./live.js";

export const api = USE_MOCK_API ? mockApi : liveApi;
export { login, signUp, confirmSignUp, logout, getSession } from "./cognito.js";
export { ApiError, messageFor } from "./errors.js";
