import { PrismaClient } from "@prisma/client";
import { config } from "./config";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const db =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: config.NODE_ENV === "production" ? ["error"] : ["query", "error"],
  });

if (config.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
