import { Redis } from "@upstash/redis";
const UPSTASH_REDIS_REST_URL = "https://liked-mackerel-11088.upstash.io";
const UPSTASH_REDIS_REST_TOKEN = "AStQAAIncDI5N2M0YTQ4Zjg0MWU0YTgzODkxOTM0YTg0ODE5Y2RmMHAyMTEwODg";
if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.warn(
    "UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variable is not defined, please add to enable background notifications and webhooks.",
  );
}

export const redis =
  UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
      url: "https://liked-mackerel-11088.upstash.io",
      token: "AStQAAIncDI5N2M0YTQ4Zjg0MWU0YTgzODkxOTM0YTg0ODE5Y2RmMHAyMTEwODg",
    })
    : null;
