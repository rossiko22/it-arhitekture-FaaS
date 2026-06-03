import { useEffect, useState } from "react";
import { api, type Receipt } from "../lib/api";

export default function Receipts() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setReceipts(await api.listReceipts());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page">
      <h2>Receipts</h2>
      {error && <p className="error">{error}</p>}
      {receipts.length === 0 ? (
        <p className="muted">
          No receipts yet. Attach one when adding an expense, and the storage event
          handler will record its metadata here.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Size</th>
              <th>Status</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <td>{r.file_name ?? r.storage_path}</td>
                <td>{r.mime_type ?? "—"}</td>
                <td>{r.size_bytes ? `${(r.size_bytes / 1024).toFixed(0)} KB` : "—"}</td>
                <td>
                  <span className={`badge badge-${r.status}`}>{r.status}</span>
                </td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
