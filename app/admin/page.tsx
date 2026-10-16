import { redirect } from "next/navigation";

/**
 * /admin itself (Task 8c, ruling R114): a staff member who types the bare path lands on the orders
 * (the frame's own link target). From there the orders page sends a visitor who is signed out to
 * the sign-in page, so this route decides nothing about access.
 */
export default function AdminIndexPage(): never {
  redirect("/admin/orders");
}
