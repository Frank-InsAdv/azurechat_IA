"use client";
import { AI_NAME } from "@/features/theme/theme-config";
import { signIn, useSession } from "next-auth/react";
import { FC, useEffect } from "react";
import { Avatar, AvatarImage } from "../ui/avatar";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";

interface LoginProps {
  isDevMode: boolean;
  githubEnabled: boolean;
  entraIdEnabled: boolean;
}

export const LogIn: FC<LoginProps> = (props) => {
  const sessionData = useSession();
  const status = sessionData?.status ?? "loading";

  // ✅ Automatic redirect for unauthenticated Azure AD users
  useEffect(() => {
    if (status === "unauthenticated" && props.entraIdEnabled) {
      const timer = setTimeout(
        () => signIn("azure-ad", { callbackUrl: "/chat" }),
        100
      );
      return () => clearTimeout(timer);
    }
  }, [status, props.entraIdEnabled]);

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
          Start using IA-GPT with your Microsoft IA account now!
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.githubEnabled && (
          <Button onClick={() => signIn("github", { callbackUrl: "/chat" })}>
            GitHub
          </Button>
        )}
        {props.entraIdEnabled && (
          <Button onClick={() => signIn("azure-ad", { callbackUrl: "/chat" })}>
            Microsoft IA Account
          </Button>
        )}
        {props.isDevMode && (
          <Button onClick={() => signIn("localdev", { callbackUrl: "/chat" })}>
            Basic Auth (DEV ONLY)
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
