const INVALID_AMOUNT = "请输入大于 0 且最多两位小数的金额";

export function dollarsToCents(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(INVALID_AMOUNT);
  const [dollars, fraction = ""] = text.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 2_147_483_647) throw new Error(INVALID_AMOUNT);
  return cents;
}
