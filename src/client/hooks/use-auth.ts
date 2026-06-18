import { authClient } from "../lib/auth-client.js";

export type AuthUser = {
  email?: string;
  id: string;
  name?: string;
};

export function useAuth() {
  const { data: session, isPending } = authClient.useSession();

  const signInWithGoogle = () => authClient.signIn.social({ provider: "google" });

  const signOut = () => authClient.signOut();

  return {
    isAuthLoading: isPending,
    signInWithGoogle,
    signOut,
    user: session?.user as AuthUser | undefined
  };
}
