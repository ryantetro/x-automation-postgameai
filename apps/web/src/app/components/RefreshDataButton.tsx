"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export default function RefreshDataButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={`refresh-button${isPending ? " is-pending" : ""}`}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      disabled={isPending}
    >
      <span className="refresh-button-icon" aria-hidden="true">
        {isPending ? "..." : "↻"}
      </span>
      {isPending ? "Refreshing..." : "Refresh Data"}
    </button>
  );
}
