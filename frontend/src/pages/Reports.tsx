import { useEffect, useState } from "react";
import { api, type Report } from "../lib/api";

export default function Reports() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(m: string) {
    setError(null);
    try {
      setReport(await api.report(m));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load(month);
  }, [month]);

  return (
    <div className="page">
      <h2>Monthly report</h2>
      <label>
        Month{" "}
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}

      {report && (
        <>
          <div className="cards">
            <div className="card">
              <span className="label">Total</span>
              <span className="value">
                {report.total.toFixed(2)} {report.budget.currency}
              </span>
            </div>
            <div className="card">
              <span className="label">Expenses</span>
              <span className="value">{report.count}</span>
            </div>
            <div className={`card ${report.budget.exceeded ? "danger" : "ok"}`}>
              <span className="label">Budget status</span>
              <span className="value">{report.budget.exceeded ? "Over" : "Within"}</span>
            </div>
          </div>

          <h3>By category</h3>
          {Object.keys(report.by_category).length === 0 ? (
            <p className="muted">No spending this month.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.by_category)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amt]) => (
                    <tr key={cat}>
                      <td>{cat}</td>
                      <td className="right">
                        {amt.toFixed(2)} {report.budget.currency}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
