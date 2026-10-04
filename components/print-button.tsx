"use client";
export default function PrintButton() {
  return (
    <button
      className="button-primary print-button"
      onClick={() => window.print()}
    >
      Print / Save PDF
    </button>
  );
}
