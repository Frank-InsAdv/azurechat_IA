import { DefaultSession } from "next-auth";

// https://next-auth.js.org/getting-started/typescript#module-augmentation

declare module "next-auth" {
  interface Session {
    user: {
      isAdmin: boolean;
      tenantId?: string; 
    } & DefaultSession["user"];
  }

  interface Token {
    isAdmin: boolean;
    tenantId?: string; 
  }

  interface User {
    isAdmin: boolean;
    tenantId?: string; 
  }
}
