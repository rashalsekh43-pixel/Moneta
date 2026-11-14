export const EXPENSE_CATEGORIES = ["Food", "Shopping", "Transportation", "Entertainment", "Education", "Bills & Utilities", "Healthcare", "Other"];
export const INCOME_CATEGORIES = ["Salary", "Freelancing", "Business", "Gift", "Other"];
export const CURRENCIES = ["INR", "USD", "EUR", "GBP"];

export function text(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

export function email(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export function validPassword(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}

export function amountCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 9_999_999_999.99) return null;
  const cents = Math.round(value * 100);
  return cents > 0 ? cents : null;
}

export function nonNegativeCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 9_999_999_999.99) return null;
  return Math.round(value * 100);
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validMonth(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year >= 1900 && year <= 9999 && month >= 1 && month <= 12;
}

export function validTransaction(data) {
  const title = text(data.title, 70);
  const notes = data.notes === undefined || data.notes === null ? "" : typeof data.notes === "string" && data.notes.length <= 120 ? data.notes.trim() : null;
  const cents = amountCents(data.amount);
  const categorySet = data.type === "income" ? INCOME_CATEGORIES : data.type === "expense" ? EXPENSE_CATEGORIES : [];
  if (!title || notes === null || cents === null || !categorySet.includes(data.category) || !validDate(data.date)) return null;
  return { title, amountCents: cents, type: data.type, category: data.category, date: data.date, notes };
}
