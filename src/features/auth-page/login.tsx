"use client";
import { AI_NAME } from "@/features/theme/theme-config";
import { signIn, useSession } from "next-auth/react";
import { useEffect } from "react";
import { Avatar, AvatarImage } from "../ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";

export const LogIn = () => {
  const { status } = useSession();

  useEffect(() => {
    // If the user is not authenticated, redirect immediately to Azure AD login
    if (status === "unauthenticated") {
      signIn("azure-ad", { callbackUrl: "/" });
    }
  }, [status]);

  return (
    <Card className="flex gap-2 flex-col min-w-[300px]">
      <CardHeader className="gap-2">
        <CardTitle className="text-2xl flex gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={"ai-icon.png"} />
          </Avatar>
          <span className="text-primary">{AI_NAME}</span>
        </CardTitle>
        <CardDescription>
          Redirecting you to sign in with your Microsoft IA account…
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Optionally, you can keep a manual button as fallback */}
        <button
          onClick={() => signIn("azure-ad", { callbackUrl: "/" })}
          className="btn btn-primary"
        >
          Sign in manually
        </button>
      </CardContent>
    </Card>
  );
};
