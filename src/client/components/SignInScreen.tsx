import { ActionButton } from "./ActionButton.js";

type SignInScreenProps = {
  onSignIn: () => void;
};

export function SignInScreen({ onSignIn }: SignInScreenProps) {
  return (
    <main className="sign-in-screen">
      <div className="sign-in-card">
        <span className="brand-mark brand-mark-lg" aria-hidden="true" />
        <h1>AI Tutor</h1>
        <p>Voice study room</p>
        <ActionButton variant="primary" onClick={onSignIn}>
          Sign in with Google
        </ActionButton>
      </div>
    </main>
  );
}
