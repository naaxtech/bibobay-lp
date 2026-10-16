import { redirect } from "next/navigation";

import { LoginForm } from "@/components/admin/LoginForm";
import { staffMetadata } from "@/components/admin/metadata";
import { PAGE_COPY } from "@/components/admin/page-copy";
import { staffPageAccess } from "@/lib/admin/access";

/**
 * Staff sign-in (Task 8c, rulings R100 and R105). Always renders the form: the API answers every
 * refusal, an unconfigured deployment and an outage with its own message, so the page does not
 * guess. Only an active staff member who is already signed in goes straight on to the orders.
 * There is no `next` parameter: after sign-in the destination is always /admin/orders.
 */
export const metadata = staffMetadata(PAGE_COPY.login.pageTitle);

export default async function LoginPage() {
  const access = await staffPageAccess();
  if (access.kind === "staff") redirect("/admin/orders");
  return (
    <div className="admin-login">
      <h1 className="admin-login__title">{PAGE_COPY.login.heading}</h1>
      <p className="admin-login__lead">{PAGE_COPY.login.lead}</p>
      <LoginForm />
    </div>
  );
}
