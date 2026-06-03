import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

// The budgets table is edited directly via supabase-js (RLS scopes it to the
// current user), demonstrating both Edge-Function and direct-DB access paths.
export default function Budget() {
  const { user } = useAuth();
  const [limit, setLimit] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("budgets")
      .select("monthly_limit, currency")
      .maybeSingle();
    if (error) {
      setError(error.message);
      return;
    }
    if (data) {
      setLimit(String(data.monthly_limit));
      setCurrency(data.currency);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const { error } = await supabase
      .from("budgets")
      .upsert(
        { user_id: user!.id, monthly_limit: Number(limit), currency },
        { onConflict: "user_id" },
      );
    if (error) setError(error.message);
    else setMsg("Budget saved.");
  }

  return (
    <div className="page narrow">
      <h2>Monthly budget</h2>
      <form onSubmit={onSubmit} className="stack">
        <label>
          Monthly limit
          <input
            type="number"
            step="0.01"
            min="0"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
          />
        </label>
        <label>
          Currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />
        </label>
        {error && <p className="error">{error}</p>}
        {msg && <p className="ok-text">{msg}</p>}
        <button>Save</button>
      </form>
    </div>
  );
}
