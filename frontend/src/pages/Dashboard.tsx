import { useEffect, useState } from "react";
import { api, type Expense, type Report } from "../lib/api";
import ExpenseList from "../components/ExpenseList";

const thisMonth = new Date().toISOString().slice(0, 7);

export default function Dashboard() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [{ expenses }, rep] = await Promise.all([
        api.listExpenses(thisMonth),
        api.report(thisMonth),
      ]);
      setExpenses(expenses);
      setReport(rep);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string) {
    await api.deleteExpense(id);
    load();
  }

  return (
    <div className="page">
      <h2>This month ({thisMonth})</h2>
      {error && <p className="error">{error}</p>}

      {report && (
        <div className="cards">
          <div className="card">
            <span className="label">Total spent</span>
            <span className="value">
              {report.total.toFixed(2)} {report.budget.currency}
            </span>
          </div>
          <div className="card">
            <span className="label">Budget</span>
            <span className="value">
              {report.budget.monthly_limit?.toFixed(2) ?? "—"} {report.budget.currency}
            </span>
          </div>
          <div className={`card ${report.budget.exceeded ? "danger" : "ok"}`}>
            <span className="label">Remaining</span>
            <span className="value">
              {report.budget.remaining?.toFixed(2) ?? "—"} {report.budget.currency}
            </span>
          </div>
        </div>
      )}

      {report?.budget.exceeded && (
        <p className="error">⚠️ You've exceeded your monthly budget. An alert was queued.</p>
      )}

      <h3>Expenses</h3>
      <ExpenseList expenses={expenses} onDelete={handleDelete} />
    </div>
  );
}
