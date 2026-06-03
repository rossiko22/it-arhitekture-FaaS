// Top navigation bar shown on authenticated pages.
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <nav className="nav">
      <span className="brand">🧾 ReceiptVault</span>
      <Link to="/">Dashboard</Link>
      <Link to="/add">Add expense</Link>
      <Link to="/receipts">Receipts</Link>
      <Link to="/budget">Budget</Link>
      <Link to="/reports">Reports</Link>
      <span className="spacer" />
      <span className="email">{user?.email}</span>
      <button onClick={handleLogout}>Log out</button>
    </nav>
  );
}
