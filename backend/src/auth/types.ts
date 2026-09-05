export const authRoles = ["ORGANIZER", "PARTICIPANT"] as const;

export type AuthRole = (typeof authRoles)[number];

export type AuthSession = {
  accountId: string;
  role: AuthRole;
  sessionVersion: number;
};

export function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === "string" && authRoles.includes(value as AuthRole);
}
