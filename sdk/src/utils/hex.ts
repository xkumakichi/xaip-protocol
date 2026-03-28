/**
 * Hex encoding utilities for XRPL transactions
 * XRPL stores DID data as hex-encoded strings
 */

export function stringToHex(str: string): string {
  return Buffer.from(str, "utf-8").toString("hex").toUpperCase();
}

export function hexToString(hex: string): string {
  return Buffer.from(hex, "hex").toString("utf-8");
}

export function isValidHex(str: string): boolean {
  return /^[0-9A-Fa-f]*$/.test(str) && str.length % 2 === 0;
}
