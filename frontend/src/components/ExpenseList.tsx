// Reusable list of expenses with delete.
import type { Expense } from "../lib/api";

interface Props {
  expenses: Expense[];
  onDelete?: (id: string) => void;
}

export default function ExpenseList({ expenses, onDelete }: Props) {
  if (expenses.length === 0) return <p className="muted">No expenses yet.</p>;

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Category</th>
          <th>Description</th>
          <th className="right">Amount</th>
          {onDelete && <th></th>}
        </tr>
      </thead>
      <tbody>
        {expenses.map((e) => (
          <tr key={e.id}>
            <td>{e.spent_at}</td>
            <td>{e.category}</td>
            <td>{e.description ?? "—"}</td>
            <td className="right">
              {Number(e.amount).toFixed(2)} {e.currency}
            </td>
            {onDelete && (
              <td>
                <button className="link-danger" onClick={() => onDelete(e.id)}>
                  delete
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
