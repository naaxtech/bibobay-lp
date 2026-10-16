/**
 * A page-sized notice on the staff pages (Task 8c, ruling R100): Supabase is not set up, sign-in
 * cannot be checked right now, or the orders could not be read. A server component. It is the
 * page's one `<h1>`, so a page showing it shows nothing else.
 */
export function AdminNotice({ title, body }: { title: string; body: string }) {
  return (
    <section className="admin-notice" aria-labelledby="admin-notice-title">
      <h1 id="admin-notice-title" className="admin-page-title">
        {title}
      </h1>
      <p className="admin-notice__body">{body}</p>
    </section>
  );
}
