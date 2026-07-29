/**
 * PermissionGate — conditionally renders children based on the user's role.
 *
 * Usage:
 *   <PermissionGate require="admin">
 *     <AdminActions />
 *   </PermissionGate>
 *
 *   <PermissionGate require="verifier" fallback={<p>KYC verifiers only.</p>}>
 *     <ApproveForm />
 *   </PermissionGate>
 *
 * Issue #434 — Role-Based Navigation and Permission Gating in the UI
 */

import type { ReactNode } from "react";
import { useRoleStore, canAdmin, canVerify, type UserRole } from "../lib/roleStore";

interface PermissionGateProps {
  /**
   * Minimum role required:
   *   - "admin"    : only admins pass
   *   - "verifier" : admins and verifiers pass
   *   - "user"     : any connected wallet passes
   */
  require: UserRole;
  /** Rendered when the user does not have the required role. Defaults to null. */
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({ require: required, fallback = null, children }: PermissionGateProps) {
  const role = useRoleStore((s) => s.role);

  const allowed =
    required === "user"
      ? role !== null
      : required === "verifier"
        ? canVerify(role)
        : canAdmin(role);

  return allowed ? <>{children}</> : <>{fallback}</>;
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/** Renders children only for admins. */
export function AdminOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  return <PermissionGate require="admin" fallback={fallback}>{children}</PermissionGate>;
}

/** Renders children for admins and verifiers. */
export function VerifierOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  return <PermissionGate require="verifier" fallback={fallback}>{children}</PermissionGate>;
}
