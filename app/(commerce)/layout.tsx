import type { ReactNode } from "react";

import { OrderPadMount } from "@/components/shop/OrderPadMount";

/**
 * The commerce pages (the shop now; the order page in Task 7c). A route group, so the addresses stay
 * /shop and /order, and only these pages download the order pad's code: the root layout would put
 * it into every page's scripts. OrderPadMount mounts the pad from the server only while commerce
 * is on (spec §10 "Server gating").
 */
export default function CommerceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <OrderPadMount>{children}</OrderPadMount>;
}
