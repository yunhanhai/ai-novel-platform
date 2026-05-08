export type QueueDriver = "postgres" | "redis";

export interface AppEnv {
  databaseUrl: string;
  queueDriver: QueueDriver;
}

type EnvSource = Record<string, string | undefined>;

const queueDrivers = ["postgres", "redis"] as const;

export function parseEnv(source: EnvSource): AppEnv {
  const databaseUrl = source.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const queueDriver = parseQueueDriver(source.QUEUE_DRIVER);

  return {
    databaseUrl,
    queueDriver
  };
}

function parseQueueDriver(value: string | undefined): QueueDriver {
  const queueDriver = value?.trim() || "postgres";

  if (isQueueDriver(queueDriver)) {
    return queueDriver;
  }

  throw new Error(`QUEUE_DRIVER must be one of: ${queueDrivers.join(", ")}`);
}

function isQueueDriver(value: string): value is QueueDriver {
  return queueDrivers.includes(value as QueueDriver);
}
