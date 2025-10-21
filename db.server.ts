import { PrismaClient } from "@prisma/client";
import { getAddress } from "ethers/lib/utils";

let prisma: PrismaClient;

declare global {
  var __db__: PrismaClient;
}

// this is needed because in development we don't want to restart
// the server with every change, but we want to make sure we don't
// create a new connection to the DB with every change either.
// in production we'll have a single connection to the DB.
if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  if (!global.__db__) {
    global.__db__ = new PrismaClient();
  }
  prisma = global.__db__;
  prisma.$connect();
}

// Middleware to normalize Ethereum addresses and remove mode: insensitive
prisma.$use(async (params, next) => {
  const normalizeAddress = (value: any): any => {
    if (typeof value === 'string') {
      // Only normalize if it looks like an Ethereum address (0x + 40 hex chars)
      if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
        try {
          return getAddress(value); // Returns checksummed address
        } catch (e) {
          // If invalid address, return as-is
          return value;
        }
      }
    }
    return value;
  };

  const processFilters = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;

    for (const key in obj) {
      const value = obj[key];

      // For Attestation table: only normalize recipient and attester fields
      if (['recipient', 'attester'].includes(key) && value && typeof value === 'object') {
        // Handle equals
        if (value.equals) {
          value.equals = normalizeAddress(value.equals);
          delete value.mode; // Remove mode to prevent ILIKE
        }
        // Handle in (array of addresses)
        if (value.in && Array.isArray(value.in)) {
          value.in = value.in.map(normalizeAddress);
          delete value.mode;
        }
        // Handle other comparison operators if needed
        if (value.not) {
          if (typeof value.not === 'string') {
            value.not = normalizeAddress(value.not);
          } else if (typeof value.not === 'object') {
            processFilters(value.not);
          }
        }
      }

      // Recurse into nested objects/arrays (AND, OR, NOT, etc.)
      if (typeof value === 'object') {
        if (Array.isArray(value)) {
          value.forEach(processFilters);
        } else {
          processFilters(value);
        }
      }
    }
  };

  // Apply to all query operations
  if (['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'count', 'aggregate'].includes(params.action)) {
    if (params.args?.where) {
      processFilters(params.args.where);
    }
  }

  return next(params);
});

export { prisma };