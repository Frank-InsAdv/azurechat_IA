import NextAuth, { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { Provider } from "next-auth/providers/index";
import { hashValue } from "./helpers";

// --- CHANGE 1: New optional ALLOWED_TENANT_IDS env var (comma-separated)
const allowedTenants = process.env.ALLOWED_TENANT_IDS?.split(",").map(t => t.trim().toLowerCase()) || [];

// ------------------------------------------------------------
// Helper: Configure Identity Providers
// ------------------------------------------------------------
const configureIdentityProvider = () => {
  const providers: Array<Provider> = [];

  const adminEmails = process.env.ADMIN_EMAIL_ADDRESS?.split(",").map((email) =>
    email.toLowerCase().trim()
  );

  // --------------------------
  // GitHub Provider (unchanged)
  // --------------------------
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    providers.push(
      GitHubProvider({
        clientId: process.env.AUTH_GITHUB_ID!,
        clientSecret: process.env.AUTH_GITHUB_SECRET!,
        async profile(profile) {
          const image = await fetchProfilePicture(profile.avatar_url, null);
          const newProfile = {
            ...profile,
            isAdmin: adminEmails?.includes(profile.email.toLowerCase()),
            image,
          };
          console.log("GitHub profile:", newProfile);
          return newProfile;
        },
      })
    );
  }

  // --------------------------
  // Azure AD Provider (UPDATED)
  // --------------------------
  if (
    process.env.AZURE_AD_CLIENT_ID &&
    process.env.AZURE_AD_CLIENT_SECRET &&
    process.env.AZURE_AD_TENANT_ID
  ) {
    providers.push(
      AzureADProvider({
        clientId: process.env.AZURE_AD_CLIENT_ID!,
        clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
        tenantId: process.env.AZURE_AD_TENANT_ID!, // can be "organizations"
        authorization: {
          params: {
            scope: "openid profile User.Read email",
          },
        },
        async profile(profile, tokens) {
          const email = profile.email || profile.preferred_username || "";
          const tenantId = profile.tid?.toLowerCase() || tokens.id_token?.tid?.toLowerCase();

          // --- CHANGE 2: Restrict to only approved tenants
          if (allowedTenants.length && tenantId && !allowedTenants.includes(tenantId)) {
            console.warn("Login blocked: tenant not allowed:", tenantId);
            throw new Error("Unauthorized tenant");
          }

          const image = await fetchProfilePicture(
            `https://graph.microsoft.com/v1.0/me/photos/48x48/$value`,
            tokens.access_token
          );

          const newProfile = {
            ...profile,
            email,
            id: profile.sub,
            tenantId,
            isAdmin:
              adminEmails?.includes(email.toLowerCase()) ||
              adminEmails?.includes(profile.preferred_username?.toLowerCase()),
            image,
          };

          console.log("Azure AD profile:", newProfile);
          return newProfile;
        },
      })
    );
  }

  // --------------------------
  // Local Dev Provider (unchanged)
  // --------------------------
  if (process.env.NODE_ENV === "development") {
    providers.push(
      CredentialsProvider({
        name: "localdev",
        credentials: {
          username: { label: "Username", type: "text", placeholder: "dev" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials): Promise<any> {
          const username = credentials?.username || "dev";
          const email = username + "@localhost";
          const user = {
            id: hashValue(email),
            name: username,
            email,
            isAdmin: adminEmails?.includes(email),
            image: "",
          };
          console.log("=== DEV USER LOGGED IN ===\n", JSON.stringify(user, null, 2));
          return user;
        },
      })
    );
  }

  return providers;
};

// ------------------------------------------------------------
// Helper: Fetch profile photo
// ------------------------------------------------------------
export const fetchProfilePicture = async (
  profilePictureUrl: string,
  accessToken: any
): Promise<any> => {
  console.log("Fetching profile picture...");
  let image = null;
  const profilePicture = await fetch(
    profilePictureUrl,
    accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined
  );
  if (profilePicture.ok) {
    console.log("Profile picture fetched successfully.");
    const pictureBuffer = await profilePicture.arrayBuffer();
    const pictureBase64 = Buffer.from(pictureBuffer).toString("base64");
    image = `data:image/jpeg;base64,${pictureBase64}`;
  } else {
    console.error("Failed to fetch profile picture:", profilePictureUrl, profilePicture.statusText);
  }
  return image;
};

// ------------------------------------------------------------
// NextAuth Config
// ------------------------------------------------------------
export const options: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [...configureIdentityProvider()],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.isAdmin) token.isAdmin = user.isAdmin;
      if (user?.tenantId) token.tenantId = user.tenantId;
      return token;
    },
    async session({ session, token }) {
      session.user.isAdmin = token.isAdmin as boolean;
      session.user.tenantId = token.tenantId;
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
};

export const handlers = NextAuth(options);
