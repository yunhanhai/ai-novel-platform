import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const algorithm = "scrypt";
const version = "v1";
const keyLength = 64;
const cost = 16_384;
const blockSize = 8;
const parallelization = 1;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt, cost, blockSize, parallelization, keyLength);

  return [
    algorithm,
    version,
    cost,
    blockSize,
    parallelization,
    salt.toString("base64url"),
    hash.toString("base64url")
  ].join(":");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash);

  if (!parsed) {
    return false;
  }

  const candidate = await deriveKey(
    password,
    parsed.salt,
    parsed.cost,
    parsed.blockSize,
    parsed.parallelization,
    parsed.hash.length
  );

  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

interface ParsedPasswordHash {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  hash: Buffer;
}

async function deriveKey(
  password: string,
  salt: Buffer,
  keyCost: number,
  keyBlockSize: number,
  keyParallelization: number,
  length: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      length,
      {
        N: keyCost,
        r: keyBlockSize,
        p: keyParallelization
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      }
    );
  });
}

function parsePasswordHash(encodedHash: string): ParsedPasswordHash | null {
  const [parsedAlgorithm, parsedVersion, costPart, blockSizePart, parallelizationPart, saltPart, hashPart] =
    encodedHash.split(":");

  if (
    parsedAlgorithm !== algorithm ||
    parsedVersion !== version ||
    !costPart ||
    !blockSizePart ||
    !parallelizationPart ||
    !saltPart ||
    !hashPart
  ) {
    return null;
  }

  const parsed = {
    cost: Number.parseInt(costPart, 10),
    blockSize: Number.parseInt(blockSizePart, 10),
    parallelization: Number.parseInt(parallelizationPart, 10),
    salt: Buffer.from(saltPart, "base64url"),
    hash: Buffer.from(hashPart, "base64url")
  };

  if (!isPositiveInteger(parsed.cost) || !isPositiveInteger(parsed.blockSize) || !isPositiveInteger(parsed.parallelization)) {
    return null;
  }

  if (parsed.salt.length === 0 || parsed.hash.length === 0) {
    return null;
  }

  return parsed;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
