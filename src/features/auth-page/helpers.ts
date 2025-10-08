import { createHash } from "crypto";
import { getServerSession } from "next-auth";
import { RedirectToPage } from "../common/navigation-helpers";
import { options } from "./auth-api";

export const userSession = async (): Promise<UserModel | null> => {
  const session = await getServerSession(options);
  if (session && session.user) {
    return {
      name: session.user.name || "",
      image: session.user.image || "",
      email: session.user.email || "",
      isAdmin: session.user.isAdmin || false,
      tenantId: session.user.tenantId || undefined,
    };
  }

  return null;
};

export const getCurrentUser = async (): Promise<UserModel> => {
  const user = await userSession();
  if (user) {
    return user;
  }
  throw new Error("User not found");
};

export const userHashedId = async (): Promise<string> => {
  const user = await userSession();
  if (user) {
    return hashValue(user.email);
  }

  throw new Error("User not found");
};

export const hashValue = (value: string): string => {
  const hash = createHash("sha256");
  hash.update(value);
  return hash.digest("hex");
};

/**
 * Redirects the user if already authenticated
 * @param targetUrl The URL to redirect to if user is logged in. Defaults to /chat
 */
export const redirectIfAuthenticated = async (targetUrl: string = "/chat") => {
  const user = await userSession();
  if (user) {
    RedirectToPage(targetUrl);
  }
};

export type UserModel = {
  name: string;
  image: string;
  email: string;
  isAdmin: boolean;
  tenantId?: string;
};
