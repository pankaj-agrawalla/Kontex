import Redis from "ioredis";
import { config } from "./config";

export let isRedisReady = false;

export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: false,
  enableReadyCheck: true,
  maxRetriesPerRequest: 0,
});

redis.on("ready", () => {
  isRedisReady = true;
  console.log("[redis] connected");
});

redis.on("error", (err: Error) => {
  isRedisReady = false;
  console.warn("[redis] connection error:", err.message);
});

redis.on("close", () => {
  isRedisReady = false;
});
