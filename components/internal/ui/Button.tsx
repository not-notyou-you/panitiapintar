import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger";

const CLASS: Record<Variant, string> = { primary: "btn", ghost: "btn btn-ghost", danger: "btn btn-danger" };

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${CLASS[variant]} ${className}`} {...rest} />;
}
