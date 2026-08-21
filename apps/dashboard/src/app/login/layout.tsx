/**
 * Login has its own layout — no sidebar, no header, no shell.
 * The root layout still wraps this (providers + fonts), but the Shell
 * component is bypassed.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
