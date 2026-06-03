// Typed fetch wrappers for the Edge Functions. Every call attaches the
// logged-in user's access token as a Bearer header.
import { supabase } from "./supabase";

const BASE = import.meta.env.VITE_FUNCTIONS_URL as string;

export interface Expense {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  spent_at: string;
  created_at: string;
  updated_at: string;
}

export interface Report {
  month: string;
  total: number;
  count: number;
  by_category: Record<string, number>;
  budget: {
    monthly_limit: number | null;
    currency: string;
    remaining: number | null;
    exceeded: boolean;
  };
}

export interface Receipt {
  id: string;
  expense_id: string | null;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  created_at: string;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${BASE}/${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

// ---- expenses-api ---------------------------------------------------------
export const api = {
  listExpenses: (month?: string) =>
    call<{ expenses: Expense[] }>(`expenses-api${month ? `?month=${month}` : ""}`),

  createExpense: (body: Partial<Expense>) =>
    call<{ expense: Expense }>("expenses-api", { method: "POST", body: JSON.stringify(body) }),

  updateExpense: (id: string, body: Partial<Expense>) =>
    call<{ expense: Expense }>(`expenses-api?id=${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteExpense: (id: string) =>
    call<{ deleted: string }>(`expenses-api?id=${id}`, { method: "DELETE" }),

  // ---- reports-api --------------------------------------------------------
  report: (month?: string) =>
    call<Report>(`reports-api${month ? `?month=${month}` : ""}`),

  // ---- upload-url + Storage upload ---------------------------------------
  async uploadReceipt(file: File, expenseId?: string): Promise<Receipt | null> {
    const { path, token } = await call<{ path: string; token: string }>("upload-url", {
      method: "POST",
      body: JSON.stringify({ file_name: file.name, expense_id: expenseId }),
    });

    const { error } = await supabase.storage
      .from("receipts")
      .uploadToSignedUrl(path, token, file);
    if (error) throw error;

    // The on-receipt-uploaded function records metadata asynchronously; we
    // return the row we can read back (may be null until the event runs).
    const { data } = await supabase
      .from("receipts")
      .select("*")
      .eq("storage_path", path)
      .maybeSingle();
    return (data as Receipt) ?? null;
  },

  listReceipts: async (): Promise<Receipt[]> => {
    const { data, error } = await supabase
      .from("receipts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as Receipt[]) ?? [];
  },
};
