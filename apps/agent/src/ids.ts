import { randomBytes } from "node:crypto";

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomHex(8)}`;
}

export function syntheticEventId(): string {
  return randomHex(32);
}
