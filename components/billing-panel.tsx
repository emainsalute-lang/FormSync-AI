"use client";

import { useEffect, useState } from "react";

type BillingData = {
  configured: boolean;
  prices: { pro: boolean; team: boolean };
  subscription: {
    plan: string;
    status: string;
    currentPeriodEnd: string | null;
  };
  usage: {
    usedBytes: number;
    reservedBytes: number;
    quotaBytes: number;
    sessionsLimit: number;
    analysesLimit: number;
    workoutsLimit: number;
    plan: string;
  } | null;
  invoices: {
    id: string;
    amount_paid: number;
    currency: string;
    status: string;
    created: number;
    hosted_invoice_url: string | null;
    invoice_pdf: string | null;
  }[];
};
export default function BillingPanel() {
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/billing", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Billing unavailable.");
    setData(result);
  }
  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Billing unavailable."),
    );
  }, []);
  async function action(action: string, plan?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, plan }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Billing action failed.");
      window.location.assign(result.url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Billing action failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  return (
    <section className="panel hub-panel">
      <h2>Subscription & invoices</h2>
      {!data && !error && <p role="status">Loading billing…</p>}
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
      {data && (
        <>
          <p>
            Current plan: <strong>{data.subscription.plan}</strong> ·{" "}
            {data.subscription.status}
          </p>
          {data.subscription.currentPeriodEnd && (
            <p className="muted">
              Current period ends{" "}
              {new Date(
                data.subscription.currentPeriodEnd,
              ).toLocaleDateString()}
              .
            </p>
          )}
          {data.usage && (
            <p className="muted">
              Plan limits: {data.usage.sessionsLimit.toLocaleString()} sessions,{" "}
              {data.usage.analysesLimit} movement analyses,{" "}
              {data.usage.workoutsLimit} workouts,{" "}
              {(data.usage.quotaBytes / 1024 ** 3).toFixed(0)} GB storage.
            </p>
          )}
          {!data.configured && (
            <p className="muted">
              Billing is unavailable until the server administrator configures
              Stripe API, webhook, and plan price settings.
            </p>
          )}
          <div className="hub-controls">
            {(["pro", "team"] as const).map((plan) => (
              <button
                key={plan}
                type="button"
                className="button-primary"
                disabled={busy || !data.configured || !data.prices[plan]}
                onClick={() => void action("checkout", plan)}
              >
                {busy ? "Opening…" : `Choose ${plan} plan`}
              </button>
            ))}
            <button
              type="button"
              className="button-ghost"
              disabled={
                busy ||
                !data.subscription.plan ||
                data.subscription.plan === "free"
              }
              onClick={() => void action("portal")}
            >
              Manage billing
            </button>
          </div>
          <h3>Invoices</h3>
          <ul className="hub-list">
            {data.invoices.map((invoice) => (
              <li key={invoice.id}>
                <span>
                  {new Date(invoice.created * 1000).toLocaleDateString()} ·{" "}
                  {money(invoice.amount_paid, invoice.currency)} ·{" "}
                  {invoice.status}
                </span>
                {invoice.hosted_invoice_url && (
                  <a
                    className="text-link"
                    href={invoice.hosted_invoice_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                )}
                {invoice.invoice_pdf && (
                  <a
                    className="text-link"
                    href={invoice.invoice_pdf}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PDF
                  </a>
                )}
              </li>
            ))}
            {!data.invoices.length && <li>No invoices yet.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
