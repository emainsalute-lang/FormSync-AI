import AdminOperations from "@/components/admin-operations";
export const dynamic = "force-dynamic";
export default function AdminPage() {
  return (
    <div className="hub-shell">
      <header className="hub-header">
        <a className="wordmark" href="/">
          FormSync AI
        </a>
      </header>
      <AdminOperations />
    </div>
  );
}
